// =============================================================================
// Edge Function : fathom-webhook
//
// Réception des réunions Fathom → matching → analyse Claude Haiku → stockage.
// Pipeline 6 étapes (SPECS F6) repris de Lina_fathom_CRM :
//   1. Déduplication (fathom_recording_id)
//   2. Extraction des invités externes (hors domaines internes)
//   3. Réunion interne ? → skip
//   4. Matching deal — règle stricte revue Codex :
//        1 match  → rattachement automatique
//        0 match  → classification Haiku (prospect ?) → « À rattacher »
//        2+ matchs → JAMAIS de rattachement auto → « À rattacher » (ambigu)
//   5. Extraction Haiku : 3 scores (résumé + transcript en mémoire uniquement)
//   6. Stockage meetings (payload SANS transcript) + deal_events si rattachée
//
// Sécurité : signature svix (webhook-id / webhook-timestamp / webhook-signature)
// Le transcript n'est JAMAIS stocké (décision D6) — il n'existe qu'en mémoire.
//
// Secrets : FATHOM_WEBHOOK_SECRET, ANTHROPIC_API_KEY
// =============================================================================

import { createClient } from "npm:@supabase/supabase-js@2";
import { reponseJson } from "../_shared/cors.ts";
import { fetchAvecRetry } from "../_shared/retry.ts";

function comparaisonConstante(a: string, b: string): boolean {
  const aa = new TextEncoder().encode(a);
  const bb = new TextEncoder().encode(b);
  if (aa.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < aa.length; i++) diff |= aa[i] ^ bb[i];
  return diff === 0;
}

// ── Constantes métier ─────────────────────────────────────────────────────────

// Domaines internes Lina Capital : jamais des prospects (CLAUDE.md §7)
const DOMAINES_INTERNES = ["lina.finance", "prouesse.vc", "leveo.fr"];

// Modèle épinglé — revue Codex : jamais d'alias, pour que les scores restent stables
const MODELE_CLAUDE = "claude-haiku-4-5-20251001";

// Tolérance de rejeu du webhook (anti-replay, recommandation svix)
const TOLERANCE_TIMESTAMP_SECONDES = 5 * 60;

// ── Prompts Claude (logique Lina_fathom_CRM) ──────────────────────────────────
// ⚠ À comparer avec Lina_fathom_CRM/classifier.py au déploiement (HANDOFF Q5) :
// les pondérations ci-dessous reprennent CLAUDE.md §5 (source de vérité du repo).

const PROMPT_CLASSIFICATION = `Tu es l'assistant de qualification de Lina Capital, un fonds d'investissement en finance islamique (PSFP, financement participatif).

Ta tâche : à partir du titre, des participants et du résumé d'une réunion enregistrée, déterminer s'il s'agit :
- d'une réunion PROSPECT : un porteur de projet qui cherche un financement auprès de Lina Capital
- ou d'une réunion AUTRE : réunion d'équipe interne, partenaire, prestataire, investisseur du fonds, démo d'outil, etc.

Réponds UNIQUEMENT avec un objet JSON valide, sans texte autour :
{"type": "prospect"} ou {"type": "autre"}`;

const PROMPT_EXTRACTION = `Tu es l'analyste de Lina Capital, un fonds d'investissement en finance islamique (PSFP). Tu analyses le compte-rendu d'une réunion avec un porteur de projet qui cherche un financement.

Produis une analyse structurée avec trois scores de 1 à 5 (1 = très faible, 5 = excellent) :

1. INTÉRÊT DU PROJET POUR LINA CAPITAL
   Pondération : profil du dirigeant 30 %, solidité financière 35 %, potentiel de revenus 20 %, risques 15 %.

2. INTÉRÊT DU PORTEUR POUR LINA CAPITAL
   Pondération : réaction aux contraintes de la finance islamique 40 %, urgence et motivation 30 %, alignement avec la vision de Lina 30 %.

3. CONFORMITÉ FINANCE ISLAMIQUE
   Pondération : screening halal de l'activité 30 %, ratios Shariah 25 %, structure de financement envisageable 25 %, engagement éthique 20 %.

Ajoute :
- la structure de financement islamique recommandée (Mourabaha, Moudaraba, Moucharaka, Ijara, autre, ou aucune)
- les alertes charia éventuelles (activités ou pratiques non conformes détectées)
- la prochaine étape concrète et sa date si elle a été évoquée

Réponds UNIQUEMENT avec un objet JSON valide, sans texte autour :
{
  "score_interet_lina": {"note": <1-5>, "explication": "<2 phrases max>"},
  "score_interet_porteur": {"note": <1-5>, "explication": "<2 phrases max>"},
  "score_conformite": {"note": <1-5>, "explication": "<2 phrases max>"},
  "score_global": <moyenne pondérée sur 5, 1 décimale>,
  "structure_recommandee": "<structure ou 'aucune'>",
  "alertes_charia": "<alertes ou 'Aucune alerte'>",
  "prochaine_etape": "<prochaine étape ou null>",
  "date_prochaine_etape": "<YYYY-MM-DD ou null>"
}`;

// ── Vérification de signature svix ────────────────────────────────────────────

async function verifierSignatureSvix(
  webhookId: string,
  webhookTimestamp: string,
  webhookSignature: string,
  corps: string,
  secret: string,
): Promise<boolean> {
  // Anti-replay : le timestamp doit être récent
  const maintenant = Math.floor(Date.now() / 1000);
  const timestamp = parseInt(webhookTimestamp, 10);
  if (isNaN(timestamp) || Math.abs(maintenant - timestamp) > TOLERANCE_TIMESTAMP_SECONDES) {
    return false;
  }

  // Le secret svix est préfixé `whsec_` et encodé en base64
  const cleBrute = Uint8Array.from(
    atob(secret.replace(/^whsec_/, "")),
    (c) => c.charCodeAt(0),
  );

  const contenuSigne = `${webhookId}.${webhookTimestamp}.${corps}`;
  const cle = await crypto.subtle.importKey(
    "raw",
    cleBrute,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    cle,
    new TextEncoder().encode(contenuSigne),
  );
  const signatureAttendue = btoa(String.fromCharCode(...new Uint8Array(signature)));

  // L'en-tête peut contenir plusieurs signatures : "v1,xxx v1,yyy"
  const signaturesRecues = webhookSignature
    .split(" ")
    .map((s) => (s.includes(",") ? s.split(",")[1] : s));

  return signaturesRecues.some((sig) => comparaisonConstante(sig, signatureAttendue));
}

// ── Parsing défensif du payload Fathom ────────────────────────────────────────
// Les champs exacts sont à re-vérifier sur https://developers.fathom.ai/webhooks
// (HANDOFF Q5) — ce parsing accepte les variantes connues du format.

interface Invite {
  email: string;
  nom: string;
}

interface ReunionExtraite {
  recordingId: string;
  titre: string;
  shareUrl: string | null;
  debut: string | null;
  fin: string | null;
  dureeMinutes: number | null;
  enregistrePar: string | null;
  invites: Invite[];
  resume: string;
  actionItems: unknown[];
  transcriptTexte: string;     // utilisé en mémoire uniquement, JAMAIS stocké
}

// deno-lint-ignore no-explicit-any
function extraireReunion(p: any): ReunionExtraite | null {
  const recordingId = String(
    p.recording_id ?? p.id ?? p.recording?.id ?? "",
  );
  if (!recordingId) return null;

  // Invités du calendrier (formats : [{email, name}] ou [string])
  // deno-lint-ignore no-explicit-any
  const invitesBruts: any[] = p.calendar_invitees ?? p.invitees ?? [];
  const invites: Invite[] = invitesBruts
    .map((i) => {
      if (typeof i === "string") return { email: i.toLowerCase(), nom: i };
      return {
        email: String(i.email ?? "").toLowerCase(),
        nom: String(i.name ?? i.email ?? ""),
      };
    })
    .filter((i) => i.email.includes("@"));

  // Résumé (formats : string ou {markdown_formatted} ou {markdown})
  const resumeBrut = p.default_summary ?? p.summary ?? "";
  const resume = typeof resumeBrut === "string"
    ? resumeBrut
    : String(resumeBrut.markdown_formatted ?? resumeBrut.markdown ?? "");

  // Transcript (formats : string ou [{speaker, text}]) — en mémoire uniquement
  const transcriptBrut = p.transcript ?? "";
  let transcriptTexte = "";
  if (typeof transcriptBrut === "string") {
    transcriptTexte = transcriptBrut;
  } else if (Array.isArray(transcriptBrut)) {
    transcriptTexte = transcriptBrut
      // deno-lint-ignore no-explicit-any
      .map((seg: any) => {
        const locuteur = seg.speaker?.display_name ?? seg.speaker?.name ?? seg.speaker ?? "";
        return `${locuteur}: ${seg.text ?? ""}`;
      })
      .join("\n");
  }

  // Qui a enregistré
  const enregistreParBrut = p.recorded_by ?? p.recorder ?? null;
  const enregistrePar = enregistreParBrut
    ? String(enregistreParBrut.email ?? enregistreParBrut.name ?? enregistreParBrut)
    : null;

  // Horaires et durée
  const debut = p.recording_start_time ?? p.started_at ?? p.scheduled_start_time ?? null;
  const fin = p.recording_end_time ?? p.ended_at ?? p.scheduled_end_time ?? null;
  let dureeMinutes: number | null = null;
  if (debut && fin) {
    const ms = new Date(fin).getTime() - new Date(debut).getTime();
    if (!isNaN(ms) && ms > 0) dureeMinutes = Math.round(ms / 60000);
  }

  return {
    recordingId,
    titre: String(p.title ?? p.meeting_title ?? "Réunion sans titre"),
    shareUrl: p.share_url ?? p.url ?? p.recording_url ?? null,
    debut,
    fin,
    dureeMinutes,
    enregistrePar,
    invites,
    resume,
    actionItems: Array.isArray(p.action_items) ? p.action_items : [],
    transcriptTexte,
  };
}

// ── Appel Claude (API Anthropic, retry 3x) ────────────────────────────────────

async function appelerClaude(
  systemPrompt: string,
  messageUtilisateur: string,
  apiKey: string,
): Promise<string> {
  const res = await fetchAvecRetry("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODELE_CLAUDE,
      max_tokens: 1500,
      system: systemPrompt,
      messages: [{ role: "user", content: messageUtilisateur }],
    }),
  });

  if (!res.ok) {
    const corps = await res.text();
    throw new Error(`Anthropic ${res.status} : ${corps.slice(0, 300)}`);
  }

  const donnees = await res.json();
  return donnees.content?.[0]?.text ?? "";
}

// Extraction du JSON d'une réponse Claude (tolère du texte autour)
// deno-lint-ignore no-explicit-any
function parserJsonClaude(texte: string): any | null {
  try {
    return JSON.parse(texte);
  } catch (_e) {
    const match = texte.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch (_e2) {
        return null;
      }
    }
    return null;
  }
}

// ── Pipeline principal ────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  try {
    // ── Configuration ──────────────────────────────────────────────────────────
    const secretWebhook = Deno.env.get("FATHOM_WEBHOOK_SECRET");
    const cleAnthropic = Deno.env.get("ANTHROPIC_API_KEY");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!secretWebhook || !supabaseUrl || !serviceRoleKey) {
      return reponseJson({ erreur: "Configuration serveur incomplète" }, 500);
    }

    // ── Lecture + vérification de signature ────────────────────────────────────
    const corps = await req.text();
    const webhookId = req.headers.get("webhook-id") ?? "";
    const webhookTimestamp = req.headers.get("webhook-timestamp") ?? "";
    const webhookSignature = req.headers.get("webhook-signature") ?? "";

    const signatureValide = await verifierSignatureSvix(
      webhookId,
      webhookTimestamp,
      webhookSignature,
      corps,
      secretWebhook,
    );
    if (!signatureValide) {
      return reponseJson({ erreur: "Signature invalide" }, 401);
    }

    const payload = JSON.parse(corps);
    const reunion = extraireReunion(payload);
    if (!reunion) {
      return reponseJson({ erreur: "Payload sans recording_id" }, 400);
    }

    const sb = createClient(supabaseUrl, serviceRoleKey);

    // ── 1. Déduplication ────────────────────────────────────────────────────────
    const { data: existante } = await sb
      .from("meetings")
      .select("id")
      .eq("fathom_recording_id", reunion.recordingId)
      .maybeSingle();

    if (existante) {
      return reponseJson({ statut: "deja_traitee", meeting_id: existante.id });
    }

    // ── 2. Invités externes (hors domaines internes) ───────────────────────────
    const emailsExternes = reunion.invites
      .map((i) => i.email)
      .filter((e) => !DOMAINES_INTERNES.some((d) => e.endsWith("@" + d)));

    // ── 3. Réunion interne ? → skip ────────────────────────────────────────────
    if (emailsExternes.length === 0) {
      return reponseJson({ statut: "ignoree_interne" });
    }

    // ── 4. Matching deal — règle stricte (revue Codex) ─────────────────────────
    const { data: tousDeals, error: erreurDeals } = await sb
      .from("deals")
      .select("id, email, prenom, nom")
      .not("email", "is", null);

    if (erreurDeals) {
      console.error("fathom-webhook lecture deals:", erreurDeals.message);
      return reponseJson({ erreur: "lecture_deals", message: "Erreur interne" }, 500);
    }

    const correspondances = (tousDeals ?? []).filter((d) =>
      emailsExternes.includes(String(d.email).toLowerCase())
    );

    let dealId: string | null = null;
    let statutMatch = "non_rattache";
    let matchedEmail: string | null = null;
    let matchsCandidats: Array<Record<string, string>> = [];

    if (correspondances.length === 1) {
      // Exactement 1 match → rattachement automatique
      dealId = correspondances[0].id;
      matchedEmail = correspondances[0].email;
      statutMatch = "auto";
    } else if (correspondances.length > 1) {
      // Plusieurs matchs → JAMAIS de rattachement automatique (ambigu)
      statutMatch = "ambigu";
      matchsCandidats = correspondances.map((d) => ({
        deal_id: d.id,
        email: d.email,
        prenom: d.prenom,
        nom: d.nom,
      }));
    } else {
      // 0 match → classification Haiku : prospect ou autre ?
      if (cleAnthropic) {
        try {
          const contexte = [
            `Titre : ${reunion.titre}`,
            `Participants externes : ${emailsExternes.join(", ")}`,
            `Résumé :\n${reunion.resume.slice(0, 3000)}`,
          ].join("\n\n");
          const reponse = await appelerClaude(PROMPT_CLASSIFICATION, contexte, cleAnthropic);
          const classification = parserJsonClaude(reponse);
          if (classification?.type !== "prospect") {
            // Réunion identifiée comme non-prospect → on ne la stocke pas
            return reponseJson({ statut: "ignoree_non_prospect" });
          }
        } catch (e) {
          // En cas d'échec de classification, on garde la réunion (mieux vaut un
          // faux positif dans « À rattacher » qu'une réunion prospect perdue)
          console.error("Classification Haiku échouée :", e instanceof Error ? e.message : e);
        }
      }
      statutMatch = "non_rattache";
    }

    // ── 5. Extraction Haiku : 3 scores ──────────────────────────────────────────
    // Entrée : résumé + transcript complet (en mémoire uniquement — décision D11)
    // deno-lint-ignore no-explicit-any
    let extraction: any = null;
    if (cleAnthropic && (reunion.resume || reunion.transcriptTexte)) {
      try {
        const contexteAnalyse = [
          `Titre de la réunion : ${reunion.titre}`,
          `Participants externes : ${emailsExternes.join(", ")}`,
          `RÉSUMÉ FATHOM :\n${reunion.resume || "(absent)"}`,
          `TRANSCRIPT COMPLET :\n${reunion.transcriptTexte || "(absent)"}`,
        ].join("\n\n");
        const reponse = await appelerClaude(PROMPT_EXTRACTION, contexteAnalyse, cleAnthropic);
        extraction = parserJsonClaude(reponse);
      } catch (e) {
        // Non bloquant : la réunion est stockée sans scores
        console.error("Extraction Haiku échouée :", e instanceof Error ? e.message : e);
      }
    }

    // ── 6. Stockage : payload EXPURGÉ du transcript + deal_events ──────────────
    // Le transcript ne quitte jamais la mémoire de cette fonction (décision D6).
    const payloadSansTranscript = { ...payload };
    delete payloadSansTranscript.transcript;

    const ligneMeeting = {
      fathom_recording_id: reunion.recordingId,
      deal_id: dealId,
      titre: reunion.titre,
      share_url: reunion.shareUrl,
      debut: reunion.debut,
      fin: reunion.fin,
      duree_minutes: reunion.dureeMinutes,
      enregistre_par: reunion.enregistrePar,
      invitees: reunion.invites,
      resume: reunion.resume,
      action_items: reunion.actionItems,
      score_interet_lina: extraction?.score_interet_lina ?? null,
      score_interet_porteur: extraction?.score_interet_porteur ?? null,
      score_conformite: extraction?.score_conformite ?? null,
      score_global: typeof extraction?.score_global === "number" ? extraction.score_global : null,
      structure_recommandee: extraction?.structure_recommandee ?? null,
      alertes_charia: extraction?.alertes_charia ?? null,
      prochaine_etape: extraction?.prochaine_etape ?? null,
      date_prochaine_etape: extraction?.date_prochaine_etape ?? null,
      matched_email: matchedEmail,
      statut_match: statutMatch,
      matchs_candidats: matchsCandidats,
      payload_brut: payloadSansTranscript,
    };

    const { data: meetingInsere, error: erreurInsert } = await sb
      .from("meetings")
      .insert(ligneMeeting)
      .select("id")
      .single();

    if (erreurInsert) {
      console.error("fathom-webhook insertion meeting:", erreurInsert.message);
      return reponseJson({ erreur: "insertion_meeting", message: "Erreur interne" }, 500);
    }

    // Timeline du dossier si rattachement automatique
    if (dealId) {
      const { error: erreurEvent } = await sb.from("deal_events").insert({
        deal_id: dealId,
        type: "reunion",
        resume: `Réunion Fathom rattachée automatiquement : « ${reunion.titre} »`,
        payload: { meeting_id: meetingInsere.id, statut_match: statutMatch },
        auteur_id: null,  // action système
      });
      if (erreurEvent) {
        console.error("deal_events reunion :", erreurEvent.message);
      }
    }

    return reponseJson({
      statut: "traitee",
      meeting_id: meetingInsere.id,
      rattachement: statutMatch,
      deal_id: dealId,
      scores_extraits: !!extraction,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("fathom-webhook :", message);
    return reponseJson({ erreur: "interne", message: "Traitement impossible" }, 500);
  }
});

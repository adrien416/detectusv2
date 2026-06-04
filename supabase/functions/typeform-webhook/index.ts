// =============================================================================
// Edge Function : typeform-webhook
//
// Réception temps réel des nouvelles soumissions Typeform (form pUE5Jgae).
// C'était la v6 du backlog de Djamel — la v2 la réalise (SPECS F5).
//
// - Appelée par Typeform à chaque soumission (pas de JWT : verify_jwt = false)
// - Sécurité : signature `Typeform-Signature` (HMAC-SHA256 base64, préfixe sha256=)
// - Parse form_response → autoScore → upsert deal (dédup typeform_id)
// - La réponse brute complète est conservée dans payload_brut (D14)
// - Realtime propage automatiquement le nouveau deal aux membres connectés
//
// Secrets : TYPEFORM_WEBHOOK_SECRET
// =============================================================================

import { createClient } from "npm:@supabase/supabase-js@2";
import { reponseJson } from "../_shared/cors.ts";
import { enArrierePlan } from "../_shared/retry.ts";
import { reponseVersDeal, scoringSante } from "../_shared/typeform.ts";
import { classifierSanteIA } from "../_shared/sante.ts";

function comparaisonConstante(a: string, b: string): boolean {
  const aa = new TextEncoder().encode(a);
  const bb = new TextEncoder().encode(b);
  if (aa.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < aa.length; i++) diff |= aa[i] ^ bb[i];
  return diff === 0;
}

// ── Vérification de la signature Typeform ────────────────────────────────────
// Doc : https://www.typeform.com/developers/webhooks/secure-your-webhooks/

async function verifierSignatureTypeform(
  signatureRecue: string,
  corps: string,
  secret: string,
): Promise<boolean> {
  const cle = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const hash = await crypto.subtle.sign(
    "HMAC",
    cle,
    new TextEncoder().encode(corps),
  );
  const signatureAttendue = "sha256=" + btoa(String.fromCharCode(...new Uint8Array(hash)));
  return comparaisonConstante(signatureRecue, signatureAttendue);
}

// ── Traitement ────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  try {
    // ── Configuration ──────────────────────────────────────────────────────────
    const secretWebhook = Deno.env.get("TYPEFORM_WEBHOOK_SECRET");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!secretWebhook || !supabaseUrl || !serviceRoleKey) {
      return reponseJson({ erreur: "Configuration serveur incomplète" }, 500);
    }

    // ── Lecture + vérification de signature ────────────────────────────────────
    const corps = await req.text();
    const signature = req.headers.get("Typeform-Signature") ?? "";

    const signatureValide = await verifierSignatureTypeform(signature, corps, secretWebhook);
    if (!signatureValide) {
      return reponseJson({ erreur: "Signature invalide" }, 401);
    }

    // ── Parsing du payload ──────────────────────────────────────────────────────
    const payload = JSON.parse(corps);
    const formResponse = payload.form_response;
    if (!formResponse || !formResponse.token) {
      return reponseJson({ erreur: "Payload sans form_response" }, 400);
    }

    // Conversion : parsing des refs + autoScore + payload_brut (module partagé)
    // Santé détectée par mots-clés ici ; l'affinage par IA se fait APRÈS l'insertion
    // (hors chemin critique) pour ne jamais retarder l'enregistrement (revue Codex).
    const ligne = reponseVersDeal(formResponse);
    const cleAnthropic = Deno.env.get("ANTHROPIC_API_KEY");

    const sb = createClient(supabaseUrl, serviceRoleKey);

    // ── Upsert dédupliqué ───────────────────────────────────────────────────────
    // ignoreDuplicates : si la réponse existe déjà (rejeu du webhook), on ne touche
    // à RIEN — ni au statut, ni aux notes, ni aux champs confidentiels.
    const { data: insere, error: erreurInsert } = await sb
      .from("deals")
      .upsert(ligne, { onConflict: "typeform_id", ignoreDuplicates: true })
      .select("id, prenom, nom")
      .maybeSingle();

    if (erreurInsert) {
      console.error("typeform-webhook insertion:", erreurInsert.message);
      return reponseJson({ erreur: "insertion_deal", message: "Erreur interne" }, 500);
    }

    // Rejeu d'un webhook déjà traité → rien inséré, c'est un succès idempotent
    if (!insere) {
      return reponseJson({ statut: "deja_present", typeform_id: ligne.typeform_id });
    }
    const idDossier = insere.id;

    // ── Timeline : événement import ─────────────────────────────────────────────
    const { error: erreurEvent } = await sb.from("deal_events").insert({
      deal_id: idDossier,
      type: "import",
      resume: "Dossier reçu en temps réel depuis Typeform (webhook)",
      payload: { source: "typeform-webhook" },
      auteur_id: null,  // action système
    });
    if (erreurEvent) {
      // Non bloquant : le deal est inséré, seule la timeline a échoué
      console.error("deal_events import :", erreurEvent.message);
    }

    // ── Classification santé par IA EN ARRIÈRE-PLAN (hors chemin critique) ──────
    // Le dossier est déjà enregistré. Si l'IA confirme une profession de santé que
    // les mots-clés ont ratée, on le repasse en « Santé plus tard » après coup.
    if (!ligne.sante && cleAnthropic) {
      enArrierePlan((async () => {
        const estSante = await classifierSanteIA(ligne.activite, ligne.description, cleAnthropic);
        if (estSante === true) {
          // Garde anti-écrasement : on ne reclasse que si personne n'a touché au
          // dossier entre-temps (statut encore 'nouveau'). Sinon on respecte
          // l'action de l'utilisateur. La condition rend l'update sans effet et
          // on n'écrit l'événement que si une ligne a réellement changé.
          const { data: maj } = await sb.from("deals")
            .update({ ...scoringSante(), statut: "sante" })
            .eq("id", idDossier)
            .eq("statut", "nouveau")
            .select("id");
          if (maj && maj.length > 0) {
            await sb.from("deal_events").insert({
              deal_id: idDossier,
              type: "champ",
              resume: "Classé « Santé plus tard » par l'IA à l'import",
              auteur_id: null,
            });
          }
        }
      })());
    }

    return reponseJson({
      statut: "insere",
      deal_id: insere.id,
      dossier: `${insere.prenom} ${insere.nom}`,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("typeform-webhook :", message);
    return reponseJson({ erreur: "interne", message: "Traitement impossible" }, 500);
  }
});

// =============================================================================
// Edge Function : typeform-sync
//
// Import exhaustif des réponses Typeform (form pUE5Jgae) vers la table deals.
// Déclenchée par le bouton « ⟳ Synchroniser » et au chargement de l'app.
//
// - JWT utilisateur requis (verify_jwt = true dans config.toml)
// - Pagination `before` jusqu'à épuisement — JAMAIS de limite de pages (D14)
// - Upsert dédupliqué par typeform_id : n'écrase JAMAIS le travail CRM existant
// - Chaque nouveau deal reçoit un deal_events type 'import'
//
// Secrets : TYPEFORM_TOKEN, TYPEFORM_FORM_ID
// =============================================================================

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, reponseJson } from "../_shared/cors.ts";
import { enArrierePlan, fetchAvecRetry } from "../_shared/retry.ts";
import { reponseVersDeal, scoringSante, type LigneDeal } from "../_shared/typeform.ts";
import { classifierSanteIA } from "../_shared/sante.ts";

const TYPEFORM_API = "https://api.typeform.com";

// Plafond d'appels IA de classification santé par synchronisation (sécurité :
// évite de dépasser le temps d'exécution / le coût sur un très gros import).
// Les syncs courantes ne ramènent que quelques nouveaux dossiers.
const MAX_CLASSIFICATION_IA = 80;

Deno.serve(async (req) => {
  // Pré-vol CORS (appel depuis le navigateur)
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // ── Configuration ─────────────────────────────────────────────────────────
    const typeformToken = Deno.env.get("TYPEFORM_TOKEN");
    const formId = Deno.env.get("TYPEFORM_FORM_ID");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!typeformToken || !formId || !supabaseUrl || !serviceRoleKey) {
      return reponseJson({ erreur: "Configuration serveur incomplète (secrets manquants)" }, 500);
    }

    // ── Vérification de l'utilisateur appelant ────────────────────────────────
    // verify_jwt = true garantit un JWT valide ; on identifie l'utilisateur pour
    // tracer qui a déclenché la synchronisation.
    const enTeteAuth = req.headers.get("Authorization") ?? "";
    const clientUtilisateur = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY") ?? "", {
      global: { headers: { Authorization: enTeteAuth } },
    });
    const { data: { user } } = await clientUtilisateur.auth.getUser();
    if (!user) {
      return reponseJson({ erreur: "Utilisateur non authentifié" }, 401);
    }

    // Client service_role pour les écritures (bypass RLS)
    const sb = createClient(supabaseUrl, serviceRoleKey);

    // Réservé aux admins : la synchro déclenche un import massif + des appels IA.
    const { data: profilAppelant } = await sb
      .from("profiles").select("role").eq("id", user.id).maybeSingle();
    if (!profilAppelant || profilAppelant.role !== "admin") {
      return reponseJson({ erreur: "Accès réservé aux admins" }, 403);
    }

    // ── 1. Récupération exhaustive des réponses Typeform ──────────────────────
    // Pagination `before` jusqu'à épuisement. La limite v1 (5 pages / 1 000
    // réponses) est une régression interdite : on pagine tant qu'il y a des items.
    const toutesReponses: Array<Record<string, unknown>> = [];
    let before: string | null = null;
    let continuer = true;

    while (continuer) {
      const url = new URL(`${TYPEFORM_API}/forms/${formId}/responses`);
      url.searchParams.set("page_size", "200");
      // On ne veut que les réponses complétées (les partielles n'ont pas de réponses exploitables)
      url.searchParams.set("completed", "true");
      if (before) url.searchParams.set("before", before);

      const res = await fetchAvecRetry(url.toString(), {
        headers: { Authorization: `Bearer ${typeformToken}` },
      });

      if (!res.ok) {
        const corps = await res.text();
        console.error(`typeform-sync API Typeform ${res.status}:`, corps.slice(0, 500));
        return reponseJson({ erreur: "typeform_api", message: "Connexion à Typeform impossible." }, 502);
      }

      const page = await res.json();
      const items: Array<Record<string, unknown>> = page.items ?? [];
      toutesReponses.push(...items);

      // Page pleine → il reste potentiellement des réponses plus anciennes
      continuer = items.length === 200;
      if (continuer) {
        before = (items[items.length - 1] as { token: string }).token;
      }
    }

    // ── 2. Conversion en lignes deals (parsing + autoScore + payload_brut) ────
    const lignes: LigneDeal[] = toutesReponses.map((r) =>
      reponseVersDeal(r as Parameters<typeof reponseVersDeal>[0])
    );

    // ── 3. Déduplication : on n'insère que les typeform_id absents de la base ──
    // Les réponses Typeform sont immuables après soumission : pour les deals déjà
    // importés, il n'y a RIEN à mettre à jour — et surtout on ne touche jamais
    // au statut, aux notes ni aux champs confidentiels.
    const { data: existants, error: erreurLecture } = await sb
      .from("deals")
      .select("typeform_id")
      .not("typeform_id", "is", null);

    if (erreurLecture) {
      console.error("typeform-sync lecture deals:", erreurLecture.message);
      return reponseJson({ erreur: "lecture_deals", message: "Erreur interne — réessayez." }, 500);
    }

    const idsExistants = new Set((existants ?? []).map((d) => d.typeform_id));
    const nouvelles = lignes.filter((l) => !idsExistants.has(l.typeform_id));
    const cleAnthropic = Deno.env.get("ANTHROPIC_API_KEY");

    // ── 4. Insertion des nouveaux deals (par lots de 100) ─────────────────────
    // La santé est posée par mots-clés ici ; l'affinage IA se fait APRÈS, en
    // arrière-plan (les dossiers sont enregistrés sans attendre l'IA — revue Codex).
    let inseres = 0;
    const aClasser: Array<{ id: string; activite: string; description: string }> = [];
    for (let i = 0; i < nouvelles.length; i += 100) {
      const lot = nouvelles.slice(i, i + 100);
      const { data: insertes, error: erreurInsert } = await sb
        .from("deals")
        .upsert(lot, { onConflict: "typeform_id", ignoreDuplicates: true })
        .select("id, prenom, nom, activite, description, sante");

      if (erreurInsert) {
        console.error("typeform-sync insertion:", erreurInsert.message);
        return reponseJson({ erreur: "insertion_deal", message: "Erreur interne — réessayez.", inseres }, 500);
      }

      // ── 5. Timeline : un événement 'import' par nouveau deal ────────────────
      if (insertes && insertes.length > 0) {
        const evenements = insertes.map((d) => ({
          deal_id: d.id,
          type: "import",
          resume: `Dossier importé depuis Typeform (synchronisation par ${user.email})`,
          payload: { source: "typeform-sync" },
          auteur_id: null,  // action système
        }));
        const { error: erreurEvents } = await sb.from("deal_events").insert(evenements);
        if (erreurEvents) {
          // Non bloquant : le deal est inséré, seule la timeline a échoué
          console.error("deal_events import :", erreurEvents.message);
        }
        inseres += insertes.length;
        // On ne classe par IA que ceux non déjà détectés santé par mots-clés.
        for (const d of insertes) {
          if (!d.sante) aClasser.push({ id: d.id, activite: d.activite ?? "", description: d.description ?? "" });
        }
      }
    }

    // ── 5bis. Classification santé par IA EN ARRIÈRE-PLAN (hors chemin critique)
    // Les dossiers sont déjà en base ; on repasse en « Santé plus tard » ceux que
    // l'IA confirme. Plafonné (temps/coût) ; un échec ne bloque jamais l'import. ──
    if (cleAnthropic && aClasser.length > 0) {
      enArrierePlan((async () => {
        const lot = aClasser.slice(0, MAX_CLASSIFICATION_IA);
        for (const d of lot) {
          const estSante = await classifierSanteIA(d.activite, d.description, cleAnthropic);
          if (estSante === true) {
            // Garde anti-écrasement : ne reclasse que si le dossier n'a pas été
            // déplacé entre-temps (statut encore 'nouveau'). La fenêtre peut être
            // longue sur un gros lot, donc le garde-fou est indispensable ici.
            const { data: maj } = await sb.from("deals")
              .update({ ...scoringSante(), statut: "sante" })
              .eq("id", d.id)
              .eq("statut", "nouveau")
              .select("id");
            if (maj && maj.length > 0) {
              await sb.from("deal_events").insert({
                deal_id: d.id,
                type: "champ",
                resume: "Classé « Santé plus tard » par l'IA à l'import",
                auteur_id: null,
              });
            }
          }
        }
      })());
    }

    // ── 6. Résultat ────────────────────────────────────────────────────────────
    return reponseJson({
      total_typeform: toutesReponses.length,
      inseres,
      deja_presents: toutesReponses.length - nouvelles.length,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("typeform-sync :", message);
    return reponseJson({ erreur: "interne", message: "Synchronisation impossible — réessayez." }, 500);
  }
});

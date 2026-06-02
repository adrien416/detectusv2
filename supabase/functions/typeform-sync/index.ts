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
import { fetchAvecRetry } from "../_shared/retry.ts";
import { reponseVersDeal, type LigneDeal } from "../_shared/typeform.ts";

const TYPEFORM_API = "https://api.typeform.com";

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
        return reponseJson(
          { erreur: `Typeform a répondu ${res.status}`, detail: corps.slice(0, 500) },
          502,
        );
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
      return reponseJson({ erreur: `Lecture des deals existants impossible : ${erreurLecture.message}` }, 500);
    }

    const idsExistants = new Set((existants ?? []).map((d) => d.typeform_id));
    const nouvelles = lignes.filter((l) => !idsExistants.has(l.typeform_id));

    // ── 4. Insertion des nouveaux deals (par lots de 100) ─────────────────────
    let inseres = 0;
    for (let i = 0; i < nouvelles.length; i += 100) {
      const lot = nouvelles.slice(i, i + 100);
      const { data: insertes, error: erreurInsert } = await sb
        .from("deals")
        .upsert(lot, { onConflict: "typeform_id", ignoreDuplicates: true })
        .select("id, prenom, nom");

      if (erreurInsert) {
        return reponseJson(
          { erreur: `Insertion échouée : ${erreurInsert.message}`, inseres },
          500,
        );
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
      }
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
    return reponseJson({ erreur: `Synchronisation échouée : ${message}` }, 500);
  }
});

// =============================================================================
// Edge Function : fullenrich-webhook
//
// Reception des resultats FullEnrich. Securite par secret dans l'URL configuree.
// =============================================================================

import { createClient } from "npm:@supabase/supabase-js@2";
import { reponseJson } from "../_shared/cors.ts";
import { lireCreditsFullEnrich } from "../_shared/fullenrich.ts";

function premierTelephone(ligne: any): string | null {
  const info = ligne?.contact_info ?? {};
  const probable = info.most_probable_phone?.number;
  if (probable) return String(probable).trim();
  const phones = Array.isArray(info.phones) ? info.phones : [];
  const premier = phones.find((p: any) => p?.number);
  return premier ? String(premier.number).trim() : null;
}

const STATUTS_FINAUX = new Set(["termine", "aucun_resultat", "credits_insuffisants"]);

Deno.serve(async (req) => {
  try {
    const secretAttendu = Deno.env.get("FULLENRICH_WEBHOOK_SECRET");
    const apiKey = Deno.env.get("FULLENRICH_API_KEY");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const secretRecu = new URL(req.url).searchParams.get("secret");

    if (!secretAttendu || !apiKey || !supabaseUrl || !serviceRoleKey) {
      return reponseJson({ erreur: "Configuration serveur incomplete" }, 500);
    }
    if (!secretRecu || secretRecu !== secretAttendu) {
      return reponseJson({ erreur: "Secret invalide" }, 401);
    }

    const payload = await req.json();
    const sb = createClient(supabaseUrl, serviceRoleKey);
    const status = String(payload.status || "").toUpperCase();
    const enrichmentId = String(payload.id || payload.enrichment_id || "");
    const cout = typeof payload.cost?.credits === "number" ? payload.cost.credits : null;
    const creditsApres = await lireCreditsFullEnrich(apiKey);
    const lignes = Array.isArray(payload.data) ? payload.data : [];

    if (status === "CREDITS_INSUFFICIENT") {
      await sb
        .from("fullenrich_requests")
        .update({
          statut: "credits_insuffisants",
          enrichment_id: enrichmentId || null,
          cout_credits: cout,
          credits_apres: creditsApres,
          resultats: payload,
        })
        .eq("enrichment_id", enrichmentId);
      return reponseJson({ statut: "credits_insuffisants" });
    }

    for (const ligne of lignes) {
      const dealId = ligne?.custom?.deal_id ? String(ligne.custom.deal_id) : "";
      const requestId = ligne?.custom?.request_id ? String(ligne.custom.request_id) : "";
      if (!dealId) continue;

      if (requestId) {
        const { data: demandeExistante } = await sb
          .from("fullenrich_requests")
          .select("statut")
          .eq("id", requestId)
          .maybeSingle();

        if (demandeExistante?.statut && STATUTS_FINAUX.has(demandeExistante.statut)) {
          continue;
        }
      }

      const telephone = premierTelephone(ligne);
      const statut = telephone ? "termine" : "aucun_resultat";

      const updateRequest = {
        statut,
        enrichment_id: enrichmentId || null,
        cout_credits: cout,
        credits_apres: creditsApres,
        resultats: ligne,
      };

      if (requestId) {
        await sb.from("fullenrich_requests").update(updateRequest).eq("id", requestId);
      } else if (enrichmentId) {
        await sb
          .from("fullenrich_requests")
          .update(updateRequest)
          .eq("enrichment_id", enrichmentId)
          .eq("deal_id", dealId);
      }

      if (telephone) {
        const { data: dealAvant } = await sb
          .from("deals")
          .select("id, telephone")
          .eq("id", dealId)
          .maybeSingle();

        if (!dealAvant?.telephone) {
          const { error: erreurUpdate } = await sb
            .from("deals")
            .update({
              telephone,
              telephone_source: "fullenrich",
              telephone_enrichi_le: new Date().toISOString(),
            })
            .eq("id", dealId);

          if (!erreurUpdate) {
            await sb.from("deal_events").insert({
              deal_id: dealId,
              type: "enrichissement",
              resume: `Telephone trouve via FullEnrich : ${telephone}`,
              payload: { enrichment_id: enrichmentId, request_id: requestId || null },
              auteur_id: null,
            });
          }
        }
      } else {
        await sb.from("deal_events").insert({
          deal_id: dealId,
          type: "enrichissement",
          resume: "FullEnrich n'a pas trouve de telephone",
          payload: { enrichment_id: enrichmentId, request_id: requestId || null },
          auteur_id: null,
        });
      }
    }

    return reponseJson({ statut: "traite", lignes: lignes.length, credits_apres: creditsApres });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return reponseJson({ erreur: `Webhook FullEnrich echoue : ${message}` }, 500);
  }
});

// =============================================================================
// Edge Function : fullenrich-webhook
//
// Reception des resultats FullEnrich. Securite par secret dans l'URL configuree.
// =============================================================================

import { createClient } from "npm:@supabase/supabase-js@2";
import { reponseJson } from "../_shared/cors.ts";
import { lireCreditsFullEnrich } from "../_shared/fullenrich.ts";

function premierTelephone(ligne: any): string | null {
  // Parsing défensif : FullEnrich peut placer les téléphones à divers endroits.
  const sources = [ligne?.contact_info, ligne?.contact, ligne].filter(Boolean);
  for (const s of sources) {
    const prob = s.most_probable_phone;
    if (typeof prob === "string" && prob.trim()) return prob.trim();
    if (prob?.number) return String(prob.number).trim();
    const phones = Array.isArray(s.phones) ? s.phones : [];
    for (const p of phones) {
      const num = typeof p === "string" ? p : p?.number;
      if (num) return String(num).trim();
    }
  }
  return null;
}

// Recherche défensive d'un profil LinkedIn dans la réponse FullEnrich (format variable).
function lienLinkedin(ligne: any): string | null {
  try {
    const m = JSON.stringify(ligne ?? {}).match(/https?:\/\/(?:[a-z]{2,3}\.)?linkedin\.com\/in\/[^\s"'\\]+/i);
    if (!m) return null;
    let url = m[0].split(/[?#]/)[0].replace(/\/+$/, "");
    url = url.replace(/^http:/i, "https:").replace(/:\/\/(?:[a-z]{2,3}\.)?linkedin\.com/i, "://www.linkedin.com");
    return /^https:\/\/(?:www\.)?linkedin\.com\/in\/[^\/\s]+/i.test(url) ? url : null;
  } catch (_e) {
    return null;
  }
}

const STATUTS_FINAUX = new Set(["termine", "aucun_resultat", "credits_insuffisants"]);

// Comparaison à temps constant (même durée quel que soit le point de divergence) —
// aligne ce webhook sur Typeform/Fathom, qui l'utilisent déjà.
function comparaisonConstante(a: string, b: string): boolean {
  const aa = new TextEncoder().encode(a);
  const bb = new TextEncoder().encode(b);
  if (aa.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < aa.length; i++) diff |= aa[i] ^ bb[i];
  return diff === 0;
}

// Trace toute erreur d'écriture : un résultat d'enrichissement ne doit jamais
// se perdre en silence (revue Fable 5 — O9).
function loggerErreur(contexte: string, erreur: { message: string } | null | undefined): void {
  if (erreur) console.error(`fullenrich-webhook ${contexte}:`, erreur.message);
}

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
    if (!secretRecu || !comparaisonConstante(secretRecu, secretAttendu)) {
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
      const { error: erreurCredits } = await sb
        .from("fullenrich_requests")
        .update({
          statut: "credits_insuffisants",
          enrichment_id: enrichmentId || null,
          cout_credits: cout,
          credits_apres: creditsApres,
          resultats: payload,
        })
        .eq("enrichment_id", enrichmentId);
      loggerErreur("maj credits_insuffisants", erreurCredits);
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
        const { error: erreurMaj } = await sb.from("fullenrich_requests").update(updateRequest).eq("id", requestId);
        loggerErreur(`maj demande ${requestId}`, erreurMaj);
      } else if (enrichmentId) {
        const { error: erreurMaj } = await sb
          .from("fullenrich_requests")
          .update(updateRequest)
          .eq("enrichment_id", enrichmentId)
          .eq("deal_id", dealId);
        loggerErreur(`maj demande enrichment ${enrichmentId}`, erreurMaj);
      }

      const { data: dealAvant } = await sb
        .from("deals")
        .select("id, telephone, linkedin_url")
        .eq("id", dealId)
        .maybeSingle();

      if (telephone && !dealAvant?.telephone) {
        const { error: erreurUpdate } = await sb
          .from("deals")
          .update({
            telephone,
            telephone_source: "fullenrich",
            telephone_enrichi_le: new Date().toISOString(),
          })
          .eq("id", dealId);

        loggerErreur(`maj telephone deal ${dealId}`, erreurUpdate);
        if (!erreurUpdate) {
          const { error: erreurEvent } = await sb.from("deal_events").insert({
            deal_id: dealId,
            type: "enrichissement",
            resume: `Telephone trouve via FullEnrich : ${telephone}`,
            payload: { enrichment_id: enrichmentId, request_id: requestId || null },
            auteur_id: null,
          });
          loggerErreur("event telephone", erreurEvent);
        }
      } else if (!telephone) {
        const { error: erreurEvent } = await sb.from("deal_events").insert({
          deal_id: dealId,
          type: "enrichissement",
          resume: "FullEnrich n'a pas trouve de telephone",
          payload: { enrichment_id: enrichmentId, request_id: requestId || null },
          auteur_id: null,
        });
        loggerErreur("event aucun telephone", erreurEvent);
      }

      // LinkedIn renvoyé par FullEnrich : on l'enregistre gratuitement (même réponse,
      // même crédit), sans jamais écraser un profil déjà validé.
      const linkedin = lienLinkedin(ligne);
      if (linkedin && !dealAvant?.linkedin_url) {
        const { error: erreurLk } = await sb
          .from("deals")
          .update({
            linkedin_url: linkedin,
            linkedin_source: "fullenrich",
            linkedin_valide_le: new Date().toISOString(),
          })
          .eq("id", dealId);
        if (!erreurLk) {
          await sb.from("deal_events").insert({
            deal_id: dealId,
            type: "enrichissement",
            resume: "Profil LinkedIn trouve via FullEnrich",
            payload: { linkedin_url: linkedin, enrichment_id: enrichmentId, request_id: requestId || null },
            auteur_id: null,
          });
        }
      }
    }

    return reponseJson({ statut: "traite", lignes: lignes.length, credits_apres: creditsApres });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return reponseJson({ erreur: `Webhook FullEnrich echoue : ${message}` }, 500);
  }
});

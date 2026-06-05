// =============================================================================
// Edge Function : fullenrich-credits
//
// Lit le solde de credits FullEnrich. Admin uniquement.
// =============================================================================

import { corsHeaders, reponseJson } from "../_shared/cors.ts";
import { contexteAdmin } from "../_shared/admin.ts";
import { lireCreditsFullEnrich } from "../_shared/fullenrich.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const admin = await contexteAdmin(req);
    if (admin instanceof Response) return admin;

    const apiKey = Deno.env.get("FULLENRICH_API_KEY");
    if (!apiKey) {
      return reponseJson({ erreur: "Cle FullEnrich manquante" }, 500);
    }

    const balance = await lireCreditsFullEnrich(apiKey);
    if (balance === null) {
      return reponseJson({ erreur: "Lecture des credits FullEnrich impossible" }, 502);
    }

    return reponseJson({ balance });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return reponseJson({ erreur: `Lecture credits echouee : ${message}` }, 500);
  }
});

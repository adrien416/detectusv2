// =============================================================================
// Edge Function : formulaire-maison-document
//
// Ouvre un document uploade via le formulaire maison.
// - JWT requis par Supabase.
// - Admin uniquement.
// - Le bucket reste prive : on renvoie un lien temporaire.
// =============================================================================

import { corsHeaders, reponseJson } from "../_shared/cors.ts";
import { contexteAdmin } from "../_shared/admin.ts";

const BUCKET_DOCUMENTS = "formulaire-maison-documents";
const PREFIX_STORAGE = `storage://${BUCKET_DOCUMENTS}/`;
const DUREE_LIEN_SECONDES = 10 * 60;

function cheminStorage(documentUrl: string): string | null {
  if (!documentUrl.startsWith(PREFIX_STORAGE)) return null;
  const chemin = documentUrl.slice(PREFIX_STORAGE.length);
  if (!chemin || chemin.includes("..") || chemin.startsWith("/")) return null;
  return chemin;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return reponseJson({ erreur: "methode_non_autorisee" }, 405);
  }

  const ctx = await contexteAdmin(req);
  if (ctx instanceof Response) return ctx;

  const body = await req.json().catch(() => ({}));
  const dealId = String(body.deal_id ?? "").trim();
  if (!dealId) return reponseJson({ erreur: "deal_id_requis" }, 400);

  const { data: deal, error: erreurDeal } = await ctx.sb
    .from("deals")
    .select("id, document_url")
    .eq("id", dealId)
    .maybeSingle();

  if (erreurDeal) {
    return reponseJson({ erreur: "lecture_dossier", message: erreurDeal.message }, 500);
  }
  if (!deal?.document_url) {
    return reponseJson({ erreur: "document_absent" }, 404);
  }

  const documentUrl = String(deal.document_url);
  if (/^https?:\/\//i.test(documentUrl)) {
    return reponseJson({ url: documentUrl, type: "lien_externe" });
  }

  const chemin = cheminStorage(documentUrl);
  if (!chemin) {
    return reponseJson({ erreur: "document_non_pris_en_charge" }, 400);
  }

  const { data: signe, error: erreurSignature } = await ctx.sb
    .storage
    .from(BUCKET_DOCUMENTS)
    .createSignedUrl(chemin, DUREE_LIEN_SECONDES);

  if (erreurSignature || !signe?.signedUrl) {
    return reponseJson({
      erreur: "signature_document",
      message: erreurSignature?.message ?? "Lien temporaire impossible.",
    }, 500);
  }

  return reponseJson({ url: signe.signedUrl, type: "stockage_prive" });
});

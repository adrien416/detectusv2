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
const MAX_TYPEFORM_BYTES = 50 * 1024 * 1024;

function cheminStorage(documentUrl: string): string | null {
  if (!documentUrl.startsWith(PREFIX_STORAGE)) return null;
  const chemin = documentUrl.slice(PREFIX_STORAGE.length);
  if (!chemin || chemin.includes("..") || chemin.startsWith("/")) return null;
  return chemin;
}

function urlTypeformProtegee(documentUrl: string): boolean {
  try {
    const url = new URL(documentUrl);
    return url.hostname === "api.typeform.com" && url.pathname.includes("/files/");
  } catch {
    return false;
  }
}

function nomDepuisUrl(documentUrl: string): string {
  try {
    const morceaux = new URL(documentUrl).pathname.split("/");
    return decodeURIComponent(morceaux[morceaux.length - 1] || "document");
  } catch {
    return "document";
  }
}

function extensionFichier(nom: string): string {
  const morceaux = nom.toLowerCase().split(".");
  return morceaux.length > 1 ? morceaux[morceaux.length - 1] : "";
}

function securiserNomFichier(nom: string): string {
  const extension = extensionFichier(nom);
  const base = (nom || "document")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90);
  const avecExtension = base.includes(".") || !extension ? base : `${base}.${extension}`;
  return avecExtension || "document";
}

function mimeDepuisNom(nom: string): string {
  const extension = extensionFichier(nom);
  const types: Record<string, string> = {
    pdf: "application/pdf",
    ppt: "application/vnd.ms-powerpoint",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
  };
  return types[extension] ?? "application/octet-stream";
}

function typeMimeValide(typeMime: string, nom: string): string {
  const propre = typeMime.split(";")[0].trim();
  if (!propre || propre === "application/octet-stream" || propre === "binary/octet-stream") {
    return mimeDepuisNom(nom);
  }
  return propre;
}

// deno-lint-ignore no-explicit-any
async function signerDocumentStocke(ctx: { sb: any }, chemin: string) {
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

  return reponseJson({
    url: signe.signedUrl,
    type: "stockage_prive",
    document_url: `${PREFIX_STORAGE}${chemin}`,
  });
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
  if (/^https?:\/\//i.test(documentUrl) && !urlTypeformProtegee(documentUrl)) {
    return reponseJson({ url: documentUrl, type: "lien_externe" });
  }

  if (urlTypeformProtegee(documentUrl)) {
    const typeformToken = Deno.env.get("TYPEFORM_TOKEN");
    if (!typeformToken) {
      return reponseJson({ erreur: "configuration_typeform", message: "Token Typeform manquant." }, 500);
    }

    const reponseTypeform = await fetch(documentUrl, {
      headers: { Authorization: `Bearer ${typeformToken}` },
    });
    if (!reponseTypeform.ok) {
      const message = await reponseTypeform.text().catch(() => "");
      console.error("formulaire-maison-document Typeform:", reponseTypeform.status, message.slice(0, 300));
      return reponseJson({
        erreur: "document_typeform",
        message: "Document Typeform impossible a recuperer.",
      }, 502);
    }

    const taille = Number(reponseTypeform.headers.get("content-length") ?? "0");
    if (taille > MAX_TYPEFORM_BYTES) {
      return reponseJson({ erreur: "document_trop_gros", message: "Document superieur a 50 Mo." }, 413);
    }

    const buffer = await reponseTypeform.arrayBuffer();
    if (buffer.byteLength > MAX_TYPEFORM_BYTES) {
      return reponseJson({ erreur: "document_trop_gros", message: "Document superieur a 50 Mo." }, 413);
    }

    const nom = securiserNomFichier(nomDepuisUrl(documentUrl));
    const chemin = `typeform/${dealId}/${nom}`;
    const typeMime = typeMimeValide(reponseTypeform.headers.get("content-type") ?? "", nom);
    const { error: erreurUpload } = await ctx.sb.storage.from(BUCKET_DOCUMENTS).upload(
      chemin,
      new Uint8Array(buffer),
      { contentType: typeMime, upsert: true },
    );
    if (erreurUpload) {
      console.error("formulaire-maison-document upload Typeform:", erreurUpload.message);
      return reponseJson({ erreur: "stockage_document", message: "Copie du document impossible." }, 500);
    }

    const documentUrlPrive = `${PREFIX_STORAGE}${chemin}`;
    const { error: erreurMaj } = await ctx.sb
      .from("deals")
      .update({ document_url: documentUrlPrive })
      .eq("id", dealId);
    if (erreurMaj) {
      console.error("formulaire-maison-document maj document_url:", erreurMaj.message);
    }

    return await signerDocumentStocke(ctx, chemin);
  }

  const chemin = cheminStorage(documentUrl);
  if (!chemin) {
    return reponseJson({ erreur: "document_non_pris_en_charge" }, 400);
  }

  return await signerDocumentStocke(ctx, chemin);
});

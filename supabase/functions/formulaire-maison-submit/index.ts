// =============================================================================
// Edge Function : formulaire-maison-submit
//
// Reception du formulaire public Lina Capital.
// - Pas de JWT : appelee par une page publique.
// - Aucun secret cote front : ecriture via service_role uniquement ici.
// - Validation serveur obligatoire, telephone et consentement RGPD requis.
// =============================================================================

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, reponseJson } from "../_shared/cors.ts";
import { enArrierePlan } from "../_shared/retry.ts";
import { autoScore, scoringSante } from "../_shared/typeform.ts";
import { classifierSanteIA } from "../_shared/sante.ts";

const VERSION_FORMULAIRE = "formulaire_maison_v1_2026_06_05";
const DELAI_MINIMUM_MS = 3000;
const BUCKET_DOCUMENTS = "formulaire-maison-documents";
const MAX_BODY_BYTES = 16 * 1024 * 1024;
const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
const EXTENSIONS_DOCUMENTS = new Set(["pdf", "ppt", "pptx", "doc", "docx", "jpg", "jpeg", "png", "webp"]);
const TYPES_MIME_DOCUMENTS = new Set([
  "application/pdf",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const ETHIQUE_LABELS: Record<string, string> = {
  tres_important: "Tres important",
  important_ouvert: "Important mais ouvert a discussion",
  pas_prioritaire: "Pas prioritaire",
  decouverte: "Je ne connais pas encore ces principes",
};

type CorpsFormulaire = Record<string, unknown>;

interface CorpsLu {
  champs: CorpsFormulaire;
  fichier: File | null;
}

function texte(v: unknown): string {
  return String(v ?? "").trim();
}

function normaliserEspaces(v: unknown): string {
  return texte(v).replace(/\s+/g, " ");
}

function erreur(champ: string, message: string, statut = 400): Response {
  return reponseJson({ erreur: "validation", champ, message }, statut);
}

function emailValide(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function telephoneValide(telephone: string): boolean {
  const chiffres = telephone.replace(/[^\d]/g, "");
  return chiffres.length >= 9 && chiffres.length <= 16 && /^[+\d][\d\s().-]+$/.test(telephone);
}

function urlOptionnelle(v: unknown, champ: string): string | null {
  const brute = texte(v);
  if (!brute) return null;
  const candidate = /^https?:\/\//i.test(brute) ? brute : `https://${brute}`;
  try {
    const url = new URL(candidate);
    if (!["http:", "https:"].includes(url.protocol)) {
      throw new Error("protocol");
    }
    return url.toString();
  } catch {
    throw new Error(`${champ}:url_invalide`);
  }
}

function montantOptionnel(v: unknown): number | null {
  const brute = texte(v).replace(/\s/g, "").replace(/€/g, "").replace(",", ".");
  if (!brute) return null;
  const n = Number(brute);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function entrepriseCreee(v: unknown): boolean {
  const s = texte(v).toLowerCase();
  return s === "oui" || s === "true" || s === "1";
}

function caPlus50K(v: unknown): boolean {
  const s = texte(v).toLowerCase();
  return (s.includes("50") && (s.includes("+") || s.includes(">"))) || s.includes("plus_50");
}

async function lireCorps(req: Request): Promise<CorpsLu> {
  const contentLength = Number(req.headers.get("content-length") ?? "0");
  if (contentLength > MAX_BODY_BYTES) {
    throw new Error("body_trop_gros");
  }
  const contentType = req.headers.get("content-type") ?? "";
  if (contentType.includes("multipart/form-data")) {
    const formData = await req.formData();
    const champs: CorpsFormulaire = {};
    let fichier: File | null = null;
    for (const [cle, valeur] of formData.entries()) {
      if (cle === "document_upload" && valeur instanceof File) {
        if (valeur.size > 0) fichier = valeur;
        continue;
      }
      if (typeof valeur === "string") champs[cle] = valeur;
    }
    return { champs, fichier };
  }
  return { champs: await req.json(), fichier: null };
}

function extensionFichier(nom: string): string {
  const morceaux = nom.toLowerCase().split(".");
  return morceaux.length > 1 ? morceaux[morceaux.length - 1] : "";
}

function erreurFichier(fichier: File): string | null {
  if (fichier.size > MAX_UPLOAD_BYTES) {
    return "Le fichier depasse 15 Mo.";
  }
  const extension = extensionFichier(fichier.name || "");
  if (extension && EXTENSIONS_DOCUMENTS.has(extension)) {
    return null;
  }
  if (fichier.type && TYPES_MIME_DOCUMENTS.has(fichier.type)) {
    return null;
  }
  return "Format accepte : PDF, PowerPoint, Word ou image.";
}

function securiserNomFichier(nom: string): string {
  const extension = extensionFichier(nom);
  const base = (nom || "document")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90);
  const avecExtension = base.includes(".") || !extension ? base : `${base}.${extension}`;
  return `${Date.now()}-${avecExtension || "document"}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return reponseJson({ erreur: "methode_non_autorisee" }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) {
      return reponseJson({ erreur: "configuration_serveur" }, 500);
    }

    const { champs: body, fichier } = await lireCorps(req);
    const sb = createClient(supabaseUrl, serviceRoleKey);

    // Honeypot : un vrai porteur ne remplit jamais ce champ invisible.
    if (texte(body.site_cache) || texte(body.website_url)) {
      return reponseJson({ statut: "recu" });
    }

    const startedAt = Number(body.started_at ?? 0);
    if (!startedAt || Date.now() - startedAt < DELAI_MINIMUM_MS) {
      return erreur("started_at", "Merci de renvoyer le formulaire normalement.");
    }

    const prenom = normaliserEspaces(body.prenom);
    const nom = normaliserEspaces(body.nom);
    const email = texte(body.email).toLowerCase();
    const telephone = normaliserEspaces(body.telephone);
    const societeProjet = normaliserEspaces(body.societe_projet);
    const activite = normaliserEspaces(body.activite);
    const besoinFinancement = normaliserEspaces(body.besoin_financement);
    const descriptionProjet = normaliserEspaces(body.description_projet);
    const caTraction = normaliserEspaces(body.ca_traction);
    const ethiqueCode = texte(body.ethique_financement);
    const ethiqueFinancement = ETHIQUE_LABELS[ethiqueCode] ?? "";
    const consentement = body.consentement_rgpd === true || texte(body.consentement_rgpd) === "true";

    if (!prenom) return erreur("prenom", "Le prenom est requis.");
    if (!nom) return erreur("nom", "Le nom est requis.");
    if (!emailValide(email)) return erreur("email", "L email est invalide.");
    if (!telephoneValide(telephone)) return erreur("telephone", "Le numero de telephone est requis.");
    if (!societeProjet) return erreur("societe_projet", "La societe ou le nom du projet est requis.");
    if (!activite) return erreur("activite", "L activite est requise.");
    if (!descriptionProjet || descriptionProjet.length < 20) {
      return erreur("description_projet", "La description doit contenir au moins 20 caracteres.");
    }
    if (!ethiqueFinancement) return erreur("ethique_financement", "Merci de choisir une option.");
    if (!consentement) return erreur("consentement_rgpd", "Le consentement RGPD est requis.");

    let siteWeb: string | null = null;
    let linkedinUrl: string | null = null;
    let documentUrl: string | null = null;
    try {
      siteWeb = urlOptionnelle(body.site_web, "site_web");
      linkedinUrl = urlOptionnelle(body.linkedin_url, "linkedin_url");
      documentUrl = urlOptionnelle(body.document_url, "document_url");
    } catch (e) {
      const [champ] = String((e as Error).message).split(":");
      return erreur(champ, "Le lien indique n est pas valide.");
    }

    if (linkedinUrl && !/linkedin\.com\/in\//i.test(linkedinUrl)) {
      return erreur("linkedin_url", "Le lien LinkedIn doit pointer vers un profil /in/.");
    }

    const montantDemande = montantOptionnel(body.montant_recherche);
    if (texte(body.montant_recherche) && montantDemande === null) {
      return erreur("montant_recherche", "Le montant recherche doit etre un nombre.");
    }

    const maintenant = new Date().toISOString();
    const submissionId = `formulaire_maison:${crypto.randomUUID()}`;
    let documentUrlFinal = documentUrl;
    let documentUpload: Record<string, unknown> | null = null;
    if (fichier) {
      const messageFichier = erreurFichier(fichier);
      if (messageFichier) return erreur("document_upload", messageFichier);

      const nomStocke = securiserNomFichier(fichier.name || "document");
      const chemin = `${submissionId.replace(":", "/")}/${nomStocke}`;
      const { error: erreurUpload } = await sb.storage.from(BUCKET_DOCUMENTS).upload(
        chemin,
        new Uint8Array(await fichier.arrayBuffer()),
        {
          contentType: fichier.type || "application/octet-stream",
          upsert: false,
        },
      );
      if (erreurUpload) {
        console.error("formulaire-maison-submit upload:", erreurUpload.message);
        return reponseJson({ erreur: "upload_document", message: "Enregistrement du document impossible." }, 500);
      }
      documentUrlFinal = `storage://${BUCKET_DOCUMENTS}/${chemin}`;
      documentUpload = {
        bucket: BUCKET_DOCUMENTS,
        path: chemin,
        nom_original: fichier.name || null,
        nom_stocke: nomStocke,
        taille_octets: fichier.size,
        type_mime: fichier.type || null,
      };
    }

    const descriptionComplete = [
      descriptionProjet,
      besoinFinancement ? `Besoin de financement : ${besoinFinancement}` : "",
      ethiqueFinancement ? `Finance ethique/islamique : ${ethiqueFinancement}` : "",
      siteWeb ? `Site : ${siteWeb}` : "",
    ].filter(Boolean).join("\n\n");

    const scoring = autoScore({
      prenom,
      nom,
      activite,
      entrepriseCreee: entrepriseCreee(body.entreprise_creee),
      caPlus50K: caPlus50K(caTraction),
      description: descriptionComplete,
      documentFourni: !!documentUrlFinal,
    });

    const payloadBrut = {
      source: "formulaire_maison",
      version: VERSION_FORMULAIRE,
      soumis_le: maintenant,
      question_ethique: "Dans quelle mesure souhaitez-vous que votre financement respecte les principes de la finance ethique/islamique, notamment l'absence d'interets ?",
      consentement_rgpd_texte: "J'accepte que Lina Capital traite les informations transmises afin d'etudier ma demande de financement.",
      donnees: {
        prenom,
        nom,
        email,
        telephone,
        societe_ou_nom_du_projet: societeProjet,
        site_web: siteWeb,
        linkedin_url: linkedinUrl,
        activite,
        entreprise_creee: entrepriseCreee(body.entreprise_creee),
        ca_traction: caTraction,
        montant_recherche: montantDemande,
        besoin_financement: besoinFinancement,
        description_projet: descriptionProjet,
        document_url: documentUrlFinal,
        document_lien_saisi: documentUrl,
        document_upload: documentUpload,
        ethique_financement: ethiqueFinancement,
        consentement_rgpd: true,
      },
    };

    const doublons: Array<Record<string, unknown>> = [];
    const { data: memeEmail } = await sb
      .from("deals")
      .select("id, prenom, nom, email, telephone, source")
      .ilike("email", email)
      .limit(5);
    if (memeEmail) doublons.push(...memeEmail);

    const { data: memeTelephone } = await sb
      .from("deals")
      .select("id, prenom, nom, email, telephone, source")
      .eq("telephone", telephone)
      .limit(5);
    if (memeTelephone) {
      for (const d of memeTelephone) {
        if (!doublons.some((x) => x.id === d.id)) doublons.push(d);
      }
    }

    const ligne = {
      submission_source_id: submissionId,
      prenom,
      nom,
      email,
      telephone,
      telephone_source: "formulaire_maison",
      telephone_enrichi_le: null,
      activite,
      entreprise_creee: entrepriseCreee(body.entreprise_creee),
      ca_tranche: caPlus50K(caTraction) ? "+ 50K" : "< 50K",
      description: descriptionComplete,
      document_url: documentUrlFinal,
      date_soumission: maintenant,
      payload_brut: payloadBrut,
      score: scoring.score,
      decision: scoring.decision,
      motif: scoring.motif,
      points_forts: scoring.points_forts,
      points_faibles: scoring.points_faibles,
      action_reco: scoring.action_reco,
      sante: scoring.sante,
      statut: scoring.sante ? "sante" : "nouveau",
      societe: societeProjet,
      source: "formulaire_maison",
      montant_demande: montantDemande,
      linkedin_url: linkedinUrl,
      linkedin_source: linkedinUrl ? "formulaire_maison" : null,
      linkedin_valide_le: linkedinUrl ? maintenant : null,
      ethique_financement: ethiqueFinancement,
      consentement_rgpd: true,
      consentement_rgpd_le: maintenant,
    };

    const { data: insere, error: erreurInsert } = await sb
      .from("deals")
      .insert(ligne)
      .select("id, prenom, nom, activite, description, sante")
      .single();

    if (erreurInsert) {
      console.error("formulaire-maison-submit insertion:", erreurInsert.message);
      return reponseJson({ erreur: "insertion_deal", message: "Enregistrement impossible." }, 500);
    }

    const events: Array<Record<string, unknown>> = [{
      deal_id: insere.id,
      type: "import",
      resume: "Dossier recu via formulaire maison Lina Capital",
      payload: { source: "formulaire_maison", submission_source_id: submissionId },
      auteur_id: null,
    }];
    if (doublons.length > 0) {
      events.push({
        deal_id: insere.id,
        type: "champ",
        resume: "Doublon potentiel detecte a la soumission",
        payload: { doublons: doublons.map((d) => ({ id: d.id, source: d.source, email: d.email, telephone: d.telephone })) },
        auteur_id: null,
      });
    }
    const { error: erreurEvents } = await sb.from("deal_events").insert(events);
    if (erreurEvents) console.error("deal_events formulaire maison:", erreurEvents.message);

    const cleAnthropic = Deno.env.get("ANTHROPIC_API_KEY");
    if (!scoring.sante && cleAnthropic) {
      enArrierePlan((async () => {
        const estSante = await classifierSanteIA(insere.activite ?? "", insere.description ?? "", cleAnthropic);
        if (estSante === true) {
          const { data: maj } = await sb.from("deals")
            .update({ ...scoringSante(), statut: "sante" })
            .eq("id", insere.id)
            .eq("statut", "nouveau")
            .select("id");
          if (maj && maj.length > 0) {
            await sb.from("deal_events").insert({
              deal_id: insere.id,
              type: "champ",
              resume: "Classe Sante plus tard par l IA a la soumission",
              auteur_id: null,
            });
          }
        }
      })());
    }

    return reponseJson({
      statut: "insere",
      deal_id: insere.id,
      submission_source_id: submissionId,
      doublon_potentiel: doublons.length > 0,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("formulaire-maison-submit:", message);
    if (message === "body_trop_gros") {
      return reponseJson({ erreur: "payload_trop_gros" }, 413);
    }
    return reponseJson({ erreur: "interne", message: "Traitement impossible." }, 500);
  }
});

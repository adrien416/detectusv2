// =============================================================================
// Edge Function : formulaire-maison-submit
//
// Reception du formulaire public Lina Capital.
// - Pas de JWT : appelee par une page publique.
// - Aucun secret cote front : ecriture via service_role uniquement ici.
// - Anti-spam robuste sans cle externe :
//     * GET  → emet un jeton a usage unique (horodate cote serveur).
//     * POST → honeypot + jeton (anti-rejeu + anti-remplissage trop rapide,
//              non falsifiable) + limite de debit par IP (IP hashee).
// - Validation serveur obligatoire, telephone et consentement RGPD requis.
// =============================================================================

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, reponseJson } from "../_shared/cors.ts";
import { enArrierePlan } from "../_shared/retry.ts";
import { autoScore, scoringSante } from "../_shared/typeform.ts";
import { classifierSanteIA } from "../_shared/sante.ts";

const VERSION_FORMULAIRE = "formulaire_maison_v1_2026_06_05";
const BUCKET_DOCUMENTS = "formulaire-maison-documents";
const MAX_BODY_BYTES = 11 * 1024 * 1024;
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

// Anti-spam (jeton serveur + limite IP) — aucun secret externe requis.
const JETON_AGE_MIN_MS = 3000;                 // remplissage plus rapide = robot
const JETON_AGE_MAX_MS = 2 * 60 * 60 * 1000;   // jeton perime au-dela de 2 h
const MAX_JETONS_PAR_IP_HEURE = 20;            // ouvertures de formulaire / IP / h
const MAX_SOUMISSIONS_PAR_IP_HEURE = 8;        // envois reels / IP / h
const SEL_IP = "detectus-formulaire-maison-2026"; // sel de pseudonymisation (RGPD)

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

const CA_LABELS: Record<string, string> = {
  plus_50k: "50K€ ou plus de CA",
  moins_50k: "Moins de 50K€ de CA",
  pas_encore: "Pas encore de CA",
  autre: "Autre situation",
};

const TEMPLATE_PORTEUR_RECU = "formulaire_porteur_recu";
const TEMPLATE_EQUIPE_NOUVEAU = "formulaire_equipe_nouveau";
const EMAIL_FROM_DEFAUT = "Adrien <adrien@prouesse.vc>";
const EMAIL_EQUIPE_DEFAUT = "adrien@prouesse.vc,djamel@lina.finance,mahefa@prouesse.vc";
const DETECTUS_URL_DEFAUT = "https://detectus2.netlify.app";

const EMAIL_AUTO_DEFAULTS: Record<string, { label: string; subject: string; body: string }> = {
  formulaire_porteur_recu: {
    label: "Accusé réception formulaire",
    subject: "Lina Capital - Votre demande a bien été reçue",
    body: `Bonjour {{prenom}},

Nous avons bien reçu votre demande de financement pour {{societe}}.

Notre équipe va étudier les informations transmises. Si le dossier entre dans notre périmètre, nous reviendrons vers vous avec les prochaines étapes.

Bien cordialement,
L'Équipe Lina Capital

https://lina.capital`,
  },
  formulaire_equipe_nouveau: {
    label: "Notification équipe formulaire",
    subject: "Nouveau dossier Lina Capital - {{societe}}",
    body: `Nouveau dossier reçu via le formulaire maison.

Porteur : {{prenom}} {{nom}}
Email : {{email}}
Telephone : {{telephone}}
Projet : {{societe}}
Activité : {{activite}}
CA : {{ca}}
Score : {{score}}/100 - {{decision}}

Ouvrir Detectus :
{{lien_detectus}}`,
  },
};

type CorpsFormulaire = Record<string, unknown>;

interface CorpsLu {
  champs: CorpsFormulaire;
  fichier: File | null;
}

interface VariablesEmail {
  prenom: string;
  nom: string;
  email: string;
  telephone: string;
  societe: string;
  entreprise: string;
  activite: string;
  ca: string;
  score: string;
  decision: string;
  lien_detectus: string;
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

// Variantes courantes d'un numero FR (avec/sans indicatif) pour la detection de doublons.
function variantesTelephone(telephone: string): string[] {
  const brut = telephone.trim();
  const chiffres = brut.replace(/\D/g, "");
  const set = new Set<string>();
  if (brut) set.add(brut);
  if (chiffres) set.add(chiffres);
  let national = chiffres;
  if (chiffres.startsWith("0033")) national = "0" + chiffres.slice(4);
  else if (chiffres.startsWith("33")) national = "0" + chiffres.slice(2);
  else if (chiffres.startsWith("0")) national = chiffres;
  else national = "0" + chiffres;
  if (national.length >= 9) {
    const sansZero = national.replace(/^0/, "");
    set.add(national);          // 0612345678
    set.add("+33" + sansZero);  // +33612345678
    set.add("33" + sansZero);   // 33612345678
    set.add("0033" + sansZero); // 0033612345678
  }
  return [...set].filter(Boolean);
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
    return "Le fichier depasse 10 Mo. Collez plutot un lien (Drive, Notion...).";
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
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90);
  const avecExtension = base.includes(".") || !extension ? base : `${base}.${extension}`;
  return `${Date.now()}-${avecExtension || "document"}`;
}

function emailsListe(v: string): string[] {
  return v.split(/[;,]/).map((x) => x.trim()).filter((x) => emailValide(x));
}

function appliquerTemplate(texteTemplate: string, variables: VariablesEmail): string {
  return String(texteTemplate || "").replace(
    /\{\{\s*(prenom|nom|email|telephone|societe|entreprise|activite|ca|score|decision|lien_detectus)\s*\}\}/gi,
    (_, cle) => variables[cle.toLowerCase() as keyof VariablesEmail] ?? "",
  );
}

// deno-lint-ignore no-explicit-any
async function chargerTemplateEmail(sb: any, cle: string): Promise<{ label: string; subject: string; body: string }> {
  const defaut = EMAIL_AUTO_DEFAULTS[cle];
  const { data, error } = await sb
    .from("email_templates")
    .select("label, subject, body")
    .eq("statut", cle)
    .maybeSingle();
  if (error) {
    console.error("formulaire-maison-submit template email:", cle, error.message);
  }
  return {
    label: data?.label || defaut.label,
    subject: data?.subject || defaut.subject,
    body: data?.body || defaut.body,
  };
}

interface ResultatEmail {
  ok: boolean;
  message: string;
}

function expediteurEmail(): { name: string; email: string } {
  const brut = Deno.env.get("EMAIL_FROM") || EMAIL_FROM_DEFAUT;
  const match = brut.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  if (match && emailValide(match[2])) {
    return { name: match[1].trim() || match[2], email: match[2] };
  }
  return { name: "Adrien", email: emailValide(brut) ? brut : "adrien@prouesse.vc" };
}

async function envoyerEmail(
  destinataires: string[],
  sujet: string,
  texteEmail: string,
  replyTo?: string,
): Promise<ResultatEmail> {
  const brevoKey = Deno.env.get("BREVO_API_KEY") ?? "";
  if (!brevoKey) {
    return { ok: false, message: "BREVO_API_KEY manquant" };
  }
  const to = destinataires.filter(emailValide);
  if (to.length === 0) {
    return { ok: false, message: "Aucun destinataire valide" };
  }

  const body: Record<string, unknown> = {
    sender: expediteurEmail(),
    to: to.map((email) => ({ email })),
    subject: sujet,
    textContent: texteEmail,
  };
  if (replyTo && emailValide(replyTo)) body.replyTo = { email: replyTo };

  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "xkeysib-key": brevoKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const message = await res.text().catch(() => "");
    return { ok: false, message: `Brevo ${res.status}: ${message.slice(0, 300)}` };
  }
  return { ok: true, message: "envoye" };
}

// deno-lint-ignore no-explicit-any
async function envoyerEmailsAutomatiquesFormulaire(sb: any, dealId: string, variables: VariablesEmail): Promise<void> {
  const equipe = emailsListe(Deno.env.get("FORMULAIRE_EQUIPE_TO") || EMAIL_EQUIPE_DEFAUT);
  const templatePorteur = await chargerTemplateEmail(sb, TEMPLATE_PORTEUR_RECU);
  const templateEquipe = await chargerTemplateEmail(sb, TEMPLATE_EQUIPE_NOUVEAU);

  const sujetPorteur = appliquerTemplate(templatePorteur.subject, variables);
  const corpsPorteur = appliquerTemplate(templatePorteur.body, variables);
  const sujetEquipe = appliquerTemplate(templateEquipe.subject, variables);
  const corpsEquipe = appliquerTemplate(templateEquipe.body, variables);

  const resultats = [
    {
      cible: "porteur",
      destinataires: [variables.email],
      resultat: await envoyerEmail([variables.email], sujetPorteur, corpsPorteur),
    },
    {
      cible: "equipe",
      destinataires: equipe,
      resultat: await envoyerEmail(equipe, sujetEquipe, corpsEquipe, variables.email),
    },
  ];

  const evenements = resultats.map((r) => ({
    deal_id: dealId,
    type: "email",
    resume: r.resultat.ok
      ? `Email automatique ${r.cible} envoye`
      : `Email automatique ${r.cible} non envoye : ${r.resultat.message}`,
    payload: {
      source: "formulaire-maison-submit",
      cible: r.cible,
      destinataires: r.destinataires,
      ok: r.resultat.ok,
      message: r.resultat.message,
    },
    auteur_id: null,
  }));

  const { error } = await sb.from("deal_events").insert(evenements);
  if (error) {
    console.error("formulaire-maison-submit events emails:", error.message);
  }
}

// ── Anti-spam : IP + jeton ────────────────────────────────────────────────────

function ipClient(req: Request): string {
  const xff = req.headers.get("x-forwarded-for") ?? "";
  const premier = xff.split(",")[0].trim();
  return premier || (req.headers.get("x-real-ip") ?? "").trim();
}

async function hacherIp(ip: string): Promise<string> {
  if (!ip) return "";
  const data = new TextEncoder().encode(SEL_IP + "|" + ip);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// GET : emet un jeton (horodate cote serveur) apres controle de debit par IP.
// deno-lint-ignore no-explicit-any
async function emettreJeton(req: Request, sb: any): Promise<Response> {
  const ipHash = await hacherIp(ipClient(req));
  if (ipHash) {
    const ilya1h = new Date(Date.now() - 3600_000).toISOString();
    const { count } = await sb
      .from("formulaire_soumissions")
      .select("id", { count: "exact", head: true })
      .eq("ip_hash", ipHash)
      .gte("emis_le", ilya1h);
    if ((count ?? 0) >= MAX_JETONS_PAR_IP_HEURE) {
      return reponseJson({ erreur: "trop_de_demandes", message: "Trop de tentatives. Reessayez plus tard." }, 429);
    }
  }
  const jeton = crypto.randomUUID();
  const { error } = await sb.from("formulaire_soumissions").insert({ jeton, ip_hash: ipHash || null });
  if (error) {
    console.error("formulaire-maison-submit emettreJeton:", error.message);
    return reponseJson({ erreur: "jeton_indisponible" }, 500);
  }
  return reponseJson({ jeton });
}

// GET ?action=upload&jeton=...&nom=... → URL d'upload signee pour un envoi DIRECT
// vers Storage (le fichier ne transite pas par la fonction → pas de limite de corps,
// gros decks acceptes). Gate par un jeton valide non consomme.
// deno-lint-ignore no-explicit-any
async function emettreUrlUpload(url: URL, sb: any): Promise<Response> {
  const jeton = (url.searchParams.get("jeton") ?? "").trim();
  const nom = (url.searchParams.get("nom") ?? "").trim();
  if (!jeton) return reponseJson({ erreur: "jeton_absent" }, 400);
  const { data: jetonRow } = await sb
    .from("formulaire_soumissions")
    .select("id, consomme_le")
    .eq("jeton", jeton)
    .maybeSingle();
  if (!jetonRow || jetonRow.consomme_le) {
    return reponseJson({ erreur: "jeton_invalide" }, 400);
  }
  const chemin = `formulaire_maison/${jeton}/${securiserNomFichier(nom || "document")}`;
  const { data, error } = await sb.storage.from(BUCKET_DOCUMENTS).createSignedUploadUrl(chemin);
  if (error || !data?.token) {
    console.error("formulaire-maison-submit url upload:", error?.message);
    return reponseJson({ erreur: "url_upload_indisponible" }, 500);
  }
  return reponseJson({ bucket: BUCKET_DOCUMENTS, path: data.path ?? chemin, token: data.token });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    return reponseJson({ erreur: "configuration_serveur" }, 500);
  }
  const sb = createClient(supabaseUrl, serviceRoleKey);

  // Ouverture du formulaire : jeton anti-spam, ou URL d'upload signee.
  if (req.method === "GET") {
    const url = new URL(req.url);
    if (url.searchParams.get("action") === "upload") {
      return await emettreUrlUpload(url, sb);
    }
    return await emettreJeton(req, sb);
  }
  if (req.method !== "POST") {
    return reponseJson({ erreur: "methode_non_autorisee" }, 405);
  }

  try {
    const { champs: body, fichier } = await lireCorps(req);

    // Honeypot : un vrai porteur ne remplit jamais ce champ invisible.
    if (texte(body.site_cache) || texte(body.website_url)) {
      return reponseJson({ statut: "recu" });
    }

    // ── Jeton anti-spam (sans le consommer encore : une erreur de validation
    //    ne doit pas « bruler » le jeton du porteur) ──────────────────────────
    const jeton = texte(body.jeton);
    if (!jeton) {
      return erreur("jeton", "Merci de recharger la page et de renvoyer le formulaire.");
    }
    const { data: jetonRow, error: erreurJetonLecture } = await sb
      .from("formulaire_soumissions")
      .select("id, emis_le, consomme_le")
      .eq("jeton", jeton)
      .maybeSingle();
    if (erreurJetonLecture) {
      console.error("formulaire-maison-submit lecture jeton:", erreurJetonLecture.message);
      return reponseJson({ erreur: "interne", message: "Traitement impossible." }, 500);
    }
    if (!jetonRow || jetonRow.consomme_le) {
      return erreur("jeton", "Formulaire expire ou deja envoye. Rechargez la page.");
    }
    const ageJetonMs = Date.now() - new Date(jetonRow.emis_le).getTime();
    if (ageJetonMs < JETON_AGE_MIN_MS) {
      return erreur("jeton", "Merci de renvoyer le formulaire normalement.");
    }
    if (ageJetonMs > JETON_AGE_MAX_MS) {
      return erreur("jeton", "Formulaire expire. Rechargez la page.");
    }

    // ── Limite de debit par IP (sur les envois reellement consommes) ──────────
    const ipHash = await hacherIp(ipClient(req));
    if (ipHash) {
      const ilya1h = new Date(Date.now() - 3600_000).toISOString();
      const { count } = await sb
        .from("formulaire_soumissions")
        .select("id", { count: "exact", head: true })
        .eq("ip_hash", ipHash)
        .not("consomme_le", "is", null)
        .gte("consomme_le", ilya1h);
      if ((count ?? 0) >= MAX_SOUMISSIONS_PAR_IP_HEURE) {
        return reponseJson(
          { erreur: "trop_de_demandes", message: "Trop d'envois depuis votre connexion. Reessayez plus tard." },
          429,
        );
      }
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
    const caLabel = CA_LABELS[texte(body.ca_traction)] ?? "";
    const anciennete = normaliserEspaces(body.anciennete);
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

    // ── Consommation du jeton (usage unique, atomique) ────────────────────────
    // Tout est valide : on brule le jeton maintenant. Un double-clic / renvoi
    // simultane echoue ici (la ligne n'est mise a jour qu'une fois).
    const maintenant = new Date().toISOString();
    const { data: jetonConsomme, error: erreurConsommation } = await sb
      .from("formulaire_soumissions")
      .update({ consomme_le: maintenant })
      .eq("jeton", jeton)
      .is("consomme_le", null)
      .select("id")
      .maybeSingle();
    if (erreurConsommation) {
      console.error("formulaire-maison-submit consommation jeton:", erreurConsommation.message);
      return reponseJson({ erreur: "interne", message: "Traitement impossible." }, 500);
    }
    if (!jetonConsomme) {
      return erreur("jeton", "Formulaire deja envoye. Rechargez la page si besoin.");
    }

    const submissionId = `formulaire_maison:${crypto.randomUUID()}`;
    let documentUrlFinal = documentUrl;
    let documentUpload: Record<string, unknown> | null = null;
    const cheminUploadDirect = texte(body.document_storage_path);
    if (fichier) {
      // Fallback : petit fichier passe par la fonction (rare, voie principale = upload direct).
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
    } else if (cheminUploadDirect) {
      // Voie principale : fichier deja televerse directement vers Storage (URL signee).
      // Le chemin doit appartenir a CE jeton (anti-usurpation de chemin).
      const prefixe = `formulaire_maison/${jeton}/`;
      if (!cheminUploadDirect.startsWith(prefixe) || cheminUploadDirect.includes("..")) {
        return erreur("document_upload", "Document invalide. Reessayez l'envoi.");
      }
      documentUrlFinal = `storage://${BUCKET_DOCUMENTS}/${cheminUploadDirect}`;
      documentUpload = {
        bucket: BUCKET_DOCUMENTS,
        path: cheminUploadDirect,
        nom_original: texte(body.document_nom) || null,
        taille_octets: Number(body.document_taille) || null,
        type_mime: texte(body.document_type) || null,
        mode: "upload_direct",
      };
    }

    // Description enrichie (lisible par l'equipe) : on conserve le detail des
    // reponses, mais le SCORING tourne sur la description brute du porteur.
    const descriptionComplete = [
      descriptionProjet,
      caLabel ? `CA : ${caLabel}` : "",
      anciennete ? `Anciennete : ${anciennete}` : "",
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
      description: descriptionProjet,
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
        anciennete: anciennete || null,
        ca_traction: caTraction,
        ca_traction_label: caLabel || null,
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
      .in("telephone", variantesTelephone(telephone))
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

    // Rattache la soumission au dossier cree (tracabilite anti-spam).
    await sb.from("formulaire_soumissions").update({ deal_id: insere.id }).eq("jeton", jeton);

    enArrierePlan(envoyerEmailsAutomatiquesFormulaire(sb, insere.id, {
      prenom,
      nom,
      email,
      telephone,
      societe: societeProjet,
      entreprise: societeProjet,
      activite,
      ca: caLabel || caTraction || (caPlus50K(caTraction) ? "+ 50K" : "< 50K"),
      score: String(scoring.score),
      decision: scoring.decision,
      lien_detectus: Deno.env.get("DETECTUS_URL") || DETECTUS_URL_DEFAUT,
    }));

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

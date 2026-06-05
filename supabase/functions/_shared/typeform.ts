// Parsing des réponses Typeform + scoring autoScore.
// Logique v1 portée à l'identique (index.html : parseTypeformAnswers, typeformToLead, autoScore).
// Form pUE5Jgae — le mapping des refs est documenté dans CLAUDE.md §6.

// ── Mapping des refs Typeform → champs deals ─────────────────────────────────

const REFS = {
  prenom: "7cb1e3c9-8bbb-498f-94f6-fe6f2952db05",
  nom: "e19aadcb-cdcf-4d59-b5c8-e6f64f61ecb1",
  email: "a24b51ec-27e0-41c8-afe6-26fc9d28968e",
  activite: "b0d255f7-aae6-40e1-ad69-c6f508242778",
  entreprise_creee: "fc05b640-ec8e-4923-80ac-27298f319e3e",
  ca_tranche: "48916931-9ca2-4010-9427-b99f4ceab42e",
  description: "5dc89ab4-1f65-4fed-a1bd-4e57e36856bd",
  document_url: "946de8c4-6455-426f-a039-4b38f1ebdd36",
  telephone: "96c42553-d4d5-44aa-b088-07c5894a5c07",
} as const;

// ── Règles métier de scoring (CLAUDE.md §5) ──────────────────────────────────

const SECTEURS_REFUSES = ["Restauration", "Transport", "VTC", "Taxi", "BTP"];
const SECTEURS_SANTE = [
  "Santé", "Médical", "Paramédical", "Pharmacie", "Kiné", "Infirmier",
  "Chirurgie", "Médecin", "Dentiste", "Optique", "Bien-être",
];

// ── Types ─────────────────────────────────────────────────────────────────────

interface ReponseTypeform {
  token: string;
  submitted_at: string;
  answers?: TypeformAnswer[];
  [cle: string]: unknown;
}

interface TypeformAnswer {
  type: string;
  field?: { ref?: string; id?: string };
  [cle: string]: unknown;
}

export interface LigneDeal {
  typeform_id: string;
  prenom: string;
  nom: string;
  email: string | null;
  telephone: string | null;
  telephone_source: string | null;
  telephone_enrichi_le: string | null;
  activite: string;
  entreprise_creee: boolean;
  ca_tranche: string;
  description: string;
  document_url: string | null;
  date_soumission: string;
  payload_brut: ReponseTypeform;
  score: number;
  decision: string;
  motif: string;
  points_forts: string[];
  points_faibles: string[];
  action_reco: string;
  sante: boolean;
  statut: string;
  source: string;
}

// ── Parsing des réponses (identique au parseTypeformAnswers v1) ──────────────

function parserReponses(answers: TypeformAnswer[] | undefined): Record<string, string> {
  const map: Record<string, string> = {};
  if (!answers) return map;

  for (const a of answers) {
    const cle = a.field?.ref || a.field?.id || "";
    if (!cle) continue;
    switch (a.type) {
      case "text":
      case "short_text":
      case "long_text":
        map[cle] = (a.text as string) || "";
        break;
      case "choice":
        map[cle] = (a.choice as { label?: string })?.label || "";
        break;
      case "choices":
        map[cle] = ((a.choices as { labels?: string[] })?.labels || []).join(", ");
        break;
      case "email":
        map[cle] = (a.email as string) || "";
        break;
      case "phone_number":
        map[cle] = (a.phone_number as string) || "";
        break;
      case "file_url":
      case "file_upload":
        map[cle] = (a.file_url as string) || "";
        break;
      case "boolean":
        map[cle] = a.boolean ? "Oui" : "Non";
        break;
      case "number":
        map[cle] = String(a.number ?? "");
        break;
      case "url":
        map[cle] = (a.url as string) || "";
        break;
      default:
        map[cle] = String(a[a.type] ?? "");
        break;
    }
  }
  return map;
}

// ── Scoring autoScore (identique au v1) ───────────────────────────────────────

interface EntreeScore {
  prenom: string;
  nom: string;
  activite: string;
  entrepriseCreee: boolean;
  caPlus50K: boolean;
  description: string;
  documentFourni: boolean;
}

interface ResultatScore {
  score: number;
  decision: string;
  motif: string;
  points_forts: string[];
  points_faibles: string[];
  action_reco: string;
  sante: boolean;
}

// Résultat de scoring « Santé plus tard » — partagé entre la détection par
// mots-clés (autoScore) et la classification par IA (Edge Functions).
export function scoringSante(): ResultatScore {
  return {
    score: 15,
    decision: "REFUSÉ",
    motif: "Santé — segment conservé en base, non financé pour l'instant",
    points_forts: ["Dossier conservé pour réouverture future"],
    points_faibles: ["Professions de santé non financées pour l'instant"],
    action_reco: "Refuser santé — garder le dossier en suivi",
    sante: true,
  };
}

// Applique le traitement « Santé plus tard » à une ligne déjà construite
// (utilisé quand l'IA détecte une profession de santé que les mots-clés ont ratée).
export function marquerSante(ligne: LigneDeal): LigneDeal {
  return { ...ligne, ...scoringSante(), statut: "sante" };
}

export function autoScore(l: EntreeScore): ResultatScore {
  // Secteur exclu → refus direct, score 5
  if (SECTEURS_REFUSES.some((x) => l.activite.toLowerCase().includes(x.toLowerCase()))) {
    return {
      score: 5,
      decision: "REFUSÉ",
      motif: `Activité ${l.activite} — secteur exclu par Lina Finance`,
      points_forts: [],
      points_faibles: [`Secteur ${l.activite} exclu`],
      action_reco: `Refus — ${l.activite} exclu`,
      sante: false,
    };
  }

  const sante = SECTEURS_SANTE.some((x) =>
    (l.activite + " " + l.description).toLowerCase().includes(x.toLowerCase())
  );
  if (sante) {
    return scoringSante();
  }

  let s = 30;
  if (l.entrepriseCreee) s += 15;
  if (l.caPlus50K) s += 15;
  if (l.documentFourni) s += 10;
  if (l.description.length > 150) s += 5;
  s = Math.min(s, 100);

  const decision = s >= 65 ? "QUALIFIÉ" : s <= 20 ? "REFUSÉ" : "À ÉTUDIER";

  const points_forts: string[] = [];
  const points_faibles: string[] = [];
  if (l.entrepriseCreee) points_forts.push("Entreprise existante");
  else points_faibles.push("Entreprise non créée");
  if (l.caPlus50K) points_forts.push("CA positif");
  else points_faibles.push("CA faible ou nul");
  if (l.documentFourni) points_forts.push("Document fourni");
  else points_faibles.push("Aucun document");
  if (l.description.length > 150) points_forts.push("Description détaillée");
  if (l.description.length < 50) points_faibles.push("Description trop courte");

  const motif = decision === "QUALIFIÉ"
    ? `Dossier solide — ${l.activite}, à qualifier en priorité`
    : decision === "REFUSÉ"
    ? "Dossier insuffisant — critères non remplis"
    : `À analyser — ${points_forts.length ? points_forts[0] : "potentiel à confirmer"}`;

  const action_reco = decision === "QUALIFIÉ"
    ? `Appel prioritaire — ${l.prenom} ${l.nom}`
    : decision === "REFUSÉ"
    ? "Refus — critères insuffisants"
    : "Demander un complément avant traitement";

  return { score: s, decision, motif, points_forts, points_faibles, action_reco, sante };
}

// ── Conversion réponse Typeform → ligne deals ─────────────────────────────────

export function reponseVersDeal(reponse: ReponseTypeform): LigneDeal {
  const a = parserReponses(reponse.answers);

  const prenom = (a[REFS.prenom] || "").trim() || "Inconnu";
  const nom = (a[REFS.nom] || "").trim() || "—";
  const email = a[REFS.email] || null;
  const activite = a[REFS.activite] || "Non précisée";
  const entrepriseCreee = (a[REFS.entreprise_creee] || "").startsWith("Oui");
  const caBrut = a[REFS.ca_tranche] || "";
  const caPlus50K = (caBrut.includes("50K") || caBrut.includes("50k")) && caBrut.includes("+");
  const description = a[REFS.description] || "";
  const documentUrl = a[REFS.document_url] || "";
  const documentFourni = !!documentUrl && documentUrl.startsWith("http");
  const telephone = a[REFS.telephone] || null;

  const scoring = autoScore({
    prenom,
    nom,
    activite,
    entrepriseCreee,
    caPlus50K,
    description,
    documentFourni,
  });

  return {
    typeform_id: reponse.token,
    prenom,
    nom,
    email,
    telephone,
    telephone_source: telephone ? "typeform" : null,
    telephone_enrichi_le: null,
    activite,
    entreprise_creee: entrepriseCreee,
    ca_tranche: caPlus50K ? "+ 50K" : "< 50K",
    description,
    document_url: documentFourni ? documentUrl : null,
    date_soumission: reponse.submitted_at,
    payload_brut: reponse,   // réponse brute complète (D14 — sanctuarisation)
    ...scoring,
    statut: scoring.sante ? "sante" : "nouveau",
    source: "typeform",
  };
}

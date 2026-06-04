// =============================================================================
// Edge Function : linkedin-search
//
// Recherche web autonome de profils LinkedIn publics. Ne se connecte jamais à
// LinkedIn et ne scrape pas les pages LinkedIn ; on interroge des moteurs de
// recherche et on ne récupère que des URLs publiques linkedin.com/in.
//
// Stratégie (du plus fiable au plus best-effort) :
//   1. API de recherche dédiée si SERPER_API_KEY est configuré (résultats fiables) ;
//   2. sinon scraping best-effort multi-sources (DuckDuckGo HTML + Lite + Bing) ;
//   3. dans tous les cas, on renvoie aussi des liens de recherche manuelle.
//
// Admin uniquement. Ne consomme aucun crédit FullEnrich.
// =============================================================================

import { corsHeaders, reponseJson } from "../_shared/cors.ts";
import { contexteAdmin } from "../_shared/admin.ts";

// User-Agent réaliste : indispensable, sinon les moteurs renvoient une page anti-bot.
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const ENTETES_NAVIGATEUR = {
  "User-Agent": UA,
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
};
const DELAI_SOURCE_MS = 7000;

interface CandidatLinkedIn {
  titre: string;
  url: string;
  extrait: string;
  score: number;
  raison: string;
  confiance: string;
  methode: string;
  requete: string;
}

function nettoyerTexte(v: unknown): string {
  return String(v ?? "")
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function domaineEmail(email: string): string {
  return (String(email || "").split("@")[1] || "").toLowerCase();
}
function racineDomaine(domaine: string): string {
  return domaine.split(".")[0] || "";
}
function domainePro(domaine: string): boolean {
  return !!domaine &&
    !/^(gmail|googlemail|outlook|hotmail|live|msn|yahoo|ymail|orange|wanadoo|free|icloud|me|laposte|sfr|neuf|bbox|protonmail|proton|aol|gmx)\./i
      .test(domaine);
}
function normaliser(v: string): string {
  return v.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}
function tokensNom(v: string): string[] {
  return normaliser(v)
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((x) => x.length >= 2);
}

// Normalise une URL LinkedIn /in/ : https, host www, sans query/hash ni slash final.
function normaliserUrlLinkedin(brut: string): string | null {
  let u = String(brut || "").trim().replace(/&amp;/g, "&");
  u = u.split(/[?#]/)[0].replace(/\/+$/, "");
  if (!/linkedin\.com\/in\//i.test(u)) return null;
  u = u.replace(/^http:\/\//i, "https://");
  if (!/^https:\/\//i.test(u)) u = "https://" + u.replace(/^\/+/, "");
  u = u.replace(/:\/\/[a-z]{2,3}\.linkedin\.com/i, "://www.linkedin.com");
  if (!/^https:\/\/www\.linkedin\.com\/in\//i.test(u)) {
    u = u.replace(/^https:\/\/linkedin\.com/i, "https://www.linkedin.com");
  }
  return /^https:\/\/www\.linkedin\.com\/in\/[^\/\s]+/i.test(u) ? u : null;
}

// Nom lisible déduit du slug d'URL (ex : /in/fatiha-deroueche-1a2b → "Fatiha Deroueche").
function titreDepuisSlug(url: string): string {
  const slug = decodeURIComponent((url.split("/in/")[1] || "").split("/")[0]);
  return slug
    .replace(/[-_]+/g, " ")
    .replace(/\b[0-9a-f]{4,}\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// Extraction GÉNÉRIQUE : récupère toutes les URLs linkedin.com/in d'un HTML, qu'elles
// soient directes ou encodées dans un lien de redirection DuckDuckGo (uddg=...).
function extraireLiensLinkedin(htmlBrut: string, requete: string, methode: string): CandidatLinkedIn[] {
  const html = String(htmlBrut || "").replace(/&amp;/g, "&");
  const vues = new Set<string>();
  const out: CandidatLinkedIn[] = [];

  const ajouter = (rawUrl: string, extrait: string) => {
    const url = normaliserUrlLinkedin(rawUrl);
    if (!url) return;
    const cle = url.toLowerCase();
    if (vues.has(cle)) return;
    vues.add(cle);
    out.push({
      titre: titreDepuisSlug(url) || url,
      url,
      extrait: nettoyerTexte(extrait).slice(0, 240),
      score: 0,
      raison: "",
      confiance: "",
      methode,
      requete,
    });
  };

  // 1) Liens de redirection DuckDuckGo : ...uddg=<url-encodée>...
  for (const m of html.matchAll(/uddg=([^&"'<>]+)/gi)) {
    try {
      ajouter(decodeURIComponent(m[1]), "");
    } catch (_e) { /* lien invalide, ignoré */ }
  }
  // 2) Liens LinkedIn directs présents dans la page
  for (const m of html.matchAll(/https?:\/\/(?:[a-z]{2,3}\.)?linkedin\.com\/in\/[^\s"'<>)]+/gi)) {
    // Extrait = texte voisin (fenêtre autour du lien), nettoyé des balises.
    const i = m.index ?? 0;
    ajouter(m[0], html.slice(i, i + 320));
  }
  return out;
}

function evaluer(c: CandidatLinkedIn, mots: string[]): CandidatLinkedIn {
  const texte = normaliser(`${c.titre} ${c.extrait} ${c.url}`);
  let score = 0;
  for (const mot of mots) if (mot && texte.includes(normaliser(mot))) score += 18;
  const [prenom, nom] = mots;
  const morceauxNom = tokensNom(nom || "");
  const morceauxPrenom = tokensNom(prenom || "");
  if (prenom && nom && texte.includes(normaliser(`${prenom} ${nom}`))) score += 35;
  if (nom && texte.includes(normaliser(nom))) score += 25;
  if (prenom && texte.includes(normaliser(prenom))) score += 12;
  for (const morceau of morceauxNom) if (texte.includes(morceau)) score += 12;
  for (const morceau of morceauxPrenom) if (texte.includes(morceau)) score += 6;
  if (/linkedin\.com\/in\//i.test(c.url)) score += 30;
  if (nom && !texte.includes(normaliser(nom)) && !morceauxNom.some((m) => texte.includes(m))) score -= 40; // nom absent = doute fort
  score = Math.max(0, Math.min(140, score));
  const confiance = score >= 95 ? "élevée" : score >= 65 ? "moyenne" : "faible";
  const raison = score >= 95
    ? "Nom et contexte concordants"
    : score >= 65
    ? "Profil probable"
    : "Profil LinkedIn possible";
  return { ...c, score, confiance, raison };
}

function liensRecherche(requetes: string[]) {
  const strict = requetes.find((q) => q.includes("site:linkedin.com/in")) || requetes[0];
  const large = requetes.find((q) => q.includes(" linkedin") && !q.includes("site:linkedin.com/in")) || requetes[1] || strict;
  const liens = [
    { label: "DuckDuckGo LinkedIn strict", requete: strict, url: `https://duckduckgo.com/?q=${encodeURIComponent(strict)}` },
    { label: "Google LinkedIn strict", requete: strict, url: `https://www.google.com/search?q=${encodeURIComponent(strict)}` },
    { label: "DuckDuckGo recherche large", requete: large, url: `https://duckduckgo.com/?q=${encodeURIComponent(large)}` },
    { label: "Google recherche large", requete: large, url: `https://www.google.com/search?q=${encodeURIComponent(large)}` },
  ];
  return liens.filter((l) => l.requete).filter((l, i, a) => a.findIndex((x) => x.label === l.label && x.requete === l.requete) === i);
}

// Récupère le texte d'une page avec délai d'abandon strict (best-effort, jamais bloquant).
async function recupererTexte(url: string, init: RequestInit): Promise<string | null> {
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(DELAI_SOURCE_MS) });
    if (!res.ok) return null;
    const txt = await res.text();
    return txt && txt.length > 200 ? txt : null;
  } catch (_e) {
    return null;
  }
}

// Détecte une page anti-bot / sans résultats exploitables.
function pageInexploitable(html: string | null): boolean {
  if (!html) return true;
  if (!/linkedin\.com\/in\//i.test(html) && !/uddg=/i.test(html)) {
    // Aucune trace de profil ET marqueurs anti-bot fréquents.
    return /unusual traffic|detected unusual|are you a robot|challenge-platform|captcha|enablejs|please enable javascript/i.test(html) || true;
  }
  return false;
}

// Source fiable : API Serper (Google) si une clé est configurée.
async function chercherSerper(requete: string, apiKey: string): Promise<CandidatLinkedIn[]> {
  try {
    const res = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: { "X-API-KEY": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ q: requete, gl: "fr", hl: "fr", num: 10 }),
      signal: AbortSignal.timeout(DELAI_SOURCE_MS),
    });
    if (!res.ok) return [];
    const data = await res.json();
    const organiques = Array.isArray(data.organic) ? data.organic : [];
    const out: CandidatLinkedIn[] = [];
    for (const o of organiques) {
      const url = normaliserUrlLinkedin(String(o?.link || ""));
      if (!url) continue;
      out.push({
        titre: nettoyerTexte(o.title) || titreDepuisSlug(url),
        url,
        extrait: nettoyerTexte(o.snippet).slice(0, 240),
        score: 0,
        raison: "",
        confiance: "",
        methode: "serper",
        requete,
      });
    }
    return out;
  } catch (_e) {
    return [];
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const admin = await contexteAdmin(req);
    if (admin instanceof Response) return admin;

    const { deal_id } = await req.json().catch(() => ({}));
    if (!deal_id) return reponseJson({ erreur: "Dossier manquant" }, 400);

    const { data: deal, error } = await admin.sb
      .from("deals")
      .select("id, prenom, nom, email, activite, societe")
      .eq("id", deal_id)
      .maybeSingle();

    if (error) {
      console.error("linkedin-search lecture deal:", error.message);
      return reponseJson({ erreur: "lecture_dossier", message: "Lecture du dossier impossible" }, 500);
    }
    if (!deal) return reponseJson({ erreur: "Dossier introuvable" }, 404);

    const prenom = nettoyerTexte(deal.prenom);
    const nom = nettoyerTexte(deal.nom);
    const societe = nettoyerTexte(deal.societe);
    const activite = nettoyerTexte(deal.activite);
    const domaine = domaineEmail(String(deal.email || ""));
    const racine = domainePro(domaine) ? racineDomaine(domaine) : "";
    const contexte = societe || racine || activite;

    const requetes = [
      [`"${prenom} ${nom}"`, "site:linkedin.com/in"].filter(Boolean).join(" "),
      [prenom, nom, "site:linkedin.com/in"].filter(Boolean).join(" "),
      [`"${prenom} ${nom}"`, "site:fr.linkedin.com/in"].filter(Boolean).join(" "),
      contexte ? [`"${prenom} ${nom}"`, contexte, "site:linkedin.com/in"].join(" ") : "",
      contexte ? [prenom, nom, contexte, "site:linkedin.com/in"].join(" ") : "",
      contexte ? [prenom, nom, contexte, "linkedin"].join(" ") : "",
      activite ? [prenom, nom, activite, "linkedin"].join(" ") : "",
      [prenom, nom, "linkedin"].filter(Boolean).join(" "),
    ].filter((q, i, a) => q && a.indexOf(q) === i);

    const mots = [prenom, nom, societe, racine, activite].filter(Boolean) as string[];
    const candidats: CandidatLinkedIn[] = [];
    const ajouterTous = (liste: CandidatLinkedIn[]) => {
      for (const c of liste) if (!candidats.some((x) => x.url.toLowerCase() === c.url.toLowerCase())) candidats.push(c);
    };

    const serperKey = Deno.env.get("SERPER_API_KEY");
    let methode = "liens_manuels";

    if (serperKey) {
      // ── Chemin fiable : API de recherche ──────────────────────────────────
      methode = "serper";
      for (const requete of requetes.slice(0, 3)) {
        ajouterTous(await chercherSerper(requete, serperKey));
        if (candidats.length >= 5) break;
      }
    }

    if (candidats.length === 0) {
      // ── Chemin best-effort : scraping multi-sources ───────────────────────
      // On limite aux 2 requêtes les plus spécifiques pour borner le temps.
      for (const requete of requetes.slice(0, 2)) {
        // 1) DuckDuckGo HTML (POST = plus fiable que GET)
        let html = await recupererTexte("https://html.duckduckgo.com/html/", {
          method: "POST",
          headers: { ...ENTETES_NAVIGATEUR, "Content-Type": "application/x-www-form-urlencoded" },
          body: `q=${encodeURIComponent(requete)}&kl=fr-fr`,
        });
        if (!pageInexploitable(html)) { ajouterTous(extraireLiensLinkedin(html!, requete, "duckduckgo")); methode = "duckduckgo"; }

        // 2) DuckDuckGo Lite (fallback léger, souvent plus tolérant)
        if (candidats.length < 3) {
          html = await recupererTexte(`https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(requete)}&kl=fr-fr`, { headers: ENTETES_NAVIGATEUR });
          if (!pageInexploitable(html)) { ajouterTous(extraireLiensLinkedin(html!, requete, "duckduckgo_lite")); if (methode === "liens_manuels") methode = "duckduckgo_lite"; }
        }

        // 3) Bing (autre moteur, autre IP-tolérance)
        if (candidats.length < 3) {
          html = await recupererTexte(`https://www.bing.com/search?q=${encodeURIComponent(requete)}&setlang=fr&cc=fr`, { headers: ENTETES_NAVIGATEUR });
          if (!pageInexploitable(html)) { ajouterTous(extraireLiensLinkedin(html!, requete, "bing")); if (methode === "liens_manuels") methode = "bing"; }
        }

        if (candidats.length >= 5) break;
      }
    }

    const tries = candidats
      .map((c) => evaluer(c, mots))
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);

    return reponseJson({
      candidats: tries,
      methode,
      auto: tries.length > 0,
      search_url: liensRecherche(requetes)[0]?.url,
      search_links: liensRecherche(requetes),
      requetes,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("linkedin-search:", message);
    return reponseJson({ erreur: "interne", message: "Recherche LinkedIn impossible" }, 500);
  }
});

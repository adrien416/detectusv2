// =============================================================================
// Edge Function : linkedin-search
//
// Recherche web legere de profils LinkedIn publics via moteur de recherche.
// Ne se connecte jamais a LinkedIn et ne scrape pas les pages LinkedIn.
// Admin uniquement.
// =============================================================================

import { corsHeaders, reponseJson } from "../_shared/cors.ts";
import { contexteAdmin } from "../_shared/admin.ts";
import { fetchAvecRetry } from "../_shared/retry.ts";

interface CandidatLinkedIn {
  titre: string;
  url: string;
  extrait: string;
  score: number;
  raison: string;
  requete: string;
}

function nettoyerTexte(v: unknown): string {
  return String(v ?? "")
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function domaineEmail(email: string): string {
  const domaine = String(email || "").split("@")[1] || "";
  return domaine.toLowerCase();
}

function racineDomaine(domaine: string): string {
  return domaine.split(".")[0] || "";
}

function domainePro(domaine: string): boolean {
  return !!domaine && !/^(gmail|googlemail|outlook|hotmail|live|msn|yahoo|ymail|orange|wanadoo|free|icloud|me|laposte|sfr|neuf|bbox|protonmail|proton|aol|gmx)\./i.test(domaine);
}

function normaliser(v: string): string {
  return v
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

function decoderUrlDuckDuckGo(url: string): string {
  try {
    const u = new URL(url.replace(/&amp;/g, "&"));
    const uddg = u.searchParams.get("uddg");
    if (uddg) return decodeURIComponent(uddg);
  } catch (_e) {
    // URL relative ou invalide : on la filtre plus loin.
  }
  return url;
}

function scoreCandidat(c: CandidatLinkedIn, mots: string[]): CandidatLinkedIn {
  const texte = normaliser(`${c.titre} ${c.extrait} ${c.url}`);
  const titre = normaliser(c.titre);
  let score = 0;
  for (const mot of mots) {
    if (mot && texte.includes(normaliser(mot))) score += 20;
  }
  const [prenom, nom] = mots;
  if (prenom && nom && titre.includes(normaliser(`${prenom} ${nom}`))) score += 30;
  if (nom && titre.includes(normaliser(nom))) score += 25;
  if (prenom && titre.includes(normaliser(prenom))) score += 15;
  if (/linkedin\.com\/in\//i.test(c.url)) score += 40;
  if (!nom || !texte.includes(normaliser(nom))) score -= 35;
  return { ...c, score, raison: score >= 95 ? "Nom et contexte concordants" : score >= 70 ? "Profil probable" : "Profil LinkedIn possible" };
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
  return liens.filter((l, idx, arr) => l.requete && arr.findIndex((x) => x.label === l.label && x.requete === l.requete) === idx);
}

function extraireCandidats(html: string, requete: string): CandidatLinkedIn[] {
  const candidats: CandidatLinkedIn[] = [];
  const blocs = html.match(/<div[^>]+class="[^"]*result[^"]*"[\s\S]*?(?=<div[^>]+class="[^"]*result[^"]*"|<\/body>)/gi) || [];
  const sources = blocs.length ? blocs : [html];

  for (const bloc of sources) {
    const lien = bloc.match(/<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!lien) continue;
    const url = decoderUrlDuckDuckGo(lien[1]).replace(/&amp;/g, "&");
    if (!/^https?:\/\/([a-z]{2,3}\.)?linkedin\.com\/in\//i.test(url)) continue;
    const snippet = bloc.match(/class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/i)
      || bloc.match(/class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    const titre = nettoyerTexte(lien[2]);
    const extrait = nettoyerTexte(snippet?.[1] || "");
    candidats.push({ titre, url, extrait, score: 0, raison: "", requete });
  }

  return candidats;
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

    if (error) return reponseJson({ erreur: `Lecture dossier impossible : ${error.message}` }, 500);
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
      contexte ? [`"${prenom} ${nom}"`, contexte, "site:linkedin.com/in"].join(" ") : "",
      contexte ? [prenom, nom, contexte, "linkedin"].join(" ") : "",
      activite ? [prenom, nom, activite, "linkedin"].join(" ") : "",
    ].filter((q, idx, arr) => q && arr.indexOf(q) === idx);

    const candidats: CandidatLinkedIn[] = [];

    for (const requete of requetes) {
      const res = await fetchAvecRetry(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(requete)}&kl=fr-fr`, {
        method: "GET",
        headers: {
          "User-Agent": "Detectus/1.0 (+https://lina.finance)",
        },
      });

      if (!res.ok) continue;
      const html = await res.text();
      for (const candidat of extraireCandidats(html, requete)) {
        if (!candidats.some((c) => c.url === candidat.url)) candidats.push(candidat);
      }
      if (candidats.length >= 8) break;
    }

    const mots = [prenom, nom, societe, racine, activite].filter(Boolean);
    const tries = candidats
      .map((c) => scoreCandidat(c, mots as string[]))
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);

    return reponseJson({
      candidats: tries,
      search_url: liensRecherche(requetes)[0]?.url,
      search_links: liensRecherche(requetes),
      requetes,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return reponseJson({ erreur: `Recherche LinkedIn echouee : ${message}` }, 500);
  }
});

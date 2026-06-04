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
}

function nettoyerTexte(v: unknown): string {
  return String(v ?? "").replace(/\s+/g, " ").trim();
}

function domaineEmail(email: string): string {
  const domaine = String(email || "").split("@")[1] || "";
  return domaine.toLowerCase();
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
  const texte = `${c.titre} ${c.extrait} ${c.url}`.toLowerCase();
  let score = 0;
  for (const mot of mots) {
    if (mot && texte.includes(mot.toLowerCase())) score += 20;
  }
  if (/linkedin\.com\/in\//i.test(c.url)) score += 40;
  return { ...c, score, raison: score >= 80 ? "Nom et contexte concordants" : "Profil LinkedIn possible" };
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
    const contexte = societe || (domaine && !/^(gmail|outlook|hotmail|yahoo|orange|free|icloud|laposte)\./.test(domaine) ? domaine : activite);
    const requete = [`"${prenom} ${nom}"`, contexte ? `"${contexte}"` : "", "site:linkedin.com/in"].filter(Boolean).join(" ");
    const searchUrl = `https://duckduckgo.com/?q=${encodeURIComponent(requete)}`;

    const res = await fetchAvecRetry(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(requete)}`, {
      method: "GET",
      headers: {
        "User-Agent": "Detectus/1.0 (+https://lina.finance)",
      },
    });

    if (!res.ok) {
      return reponseJson({ candidats: [], search_url: searchUrl, erreur: `Recherche web ${res.status}` }, 502);
    }

    const html = await res.text();
    const candidats: CandidatLinkedIn[] = [];
    const regex = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>(.*?)<\/a>[\s\S]*?<a[^>]+class="result__snippet"[^>]*>(.*?)<\/a>/gi;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(html)) && candidats.length < 8) {
      const url = decoderUrlDuckDuckGo(match[1]).replace(/&amp;/g, "&");
      if (!/^https?:\/\/([a-z]{2,3}\.)?linkedin\.com\/in\//i.test(url)) continue;
      const titre = nettoyerTexte(match[2].replace(/<[^>]+>/g, ""));
      const extrait = nettoyerTexte(match[3].replace(/<[^>]+>/g, ""));
      if (!candidats.some((c) => c.url === url)) candidats.push({ titre, url, extrait, score: 0, raison: "" });
    }

    const mots = [prenom, nom, societe, domaine && domaine.split(".")[0], activite].filter(Boolean);
    const tries = candidats
      .map((c) => scoreCandidat(c, mots as string[]))
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);

    return reponseJson({ candidats: tries, search_url: searchUrl, requete });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return reponseJson({ erreur: `Recherche LinkedIn echouee : ${message}` }, 500);
  }
});

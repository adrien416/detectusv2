// =============================================================================
// Edge Function : event-registration-submit
//
// Réception du formulaire événement Paris 19 juin 2026.
// - Pas de JWT : appelée par une page publique Netlify.
// - Anti-spam simple : jeton serveur + honeypot + limite IP.
// - Stockage Supabase + email Brevo vers Adrien.
// =============================================================================

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, reponseJson } from "../_shared/cors.ts";

const EVENT_SLUG = "paris-19juin-2026";
const EVENT_LABEL = "Startups, diasporas et finance éthique - 19 juin 2026 à 18h30";
const NOTIFY_TO = "adrien@prouesse.vc";
const EMAIL_FROM_DEFAUT = "Adrien <adrien@prouesse.vc>";

const JETON_AGE_MIN_MS = 800;
const JETON_AGE_MAX_MS = 2 * 60 * 60 * 1000;
const MAX_JETONS_PAR_IP_HEURE = 40;
const MAX_SOUMISSIONS_PAR_IP_HEURE = 12;
const SEL_IP = "detectus-event-registration-2026";

const PROFILS: Record<string, string> = {
  entrepreneur: "Entrepreneur / startup",
  investisseur: "Investisseur",
  diaspora: "Diaspora / réseau",
  sponsor: "Sponsor / partenaire",
  curieux: "Curieux de la finance éthique",
};

const DINER: Record<string, string> = {
  oui: "Oui",
  non: "Non",
  confirmer: "À confirmer",
};

type Champs = Record<string, unknown>;

function texte(v: unknown): string {
  return String(v ?? "").trim();
}

function normaliser(v: unknown): string {
  return texte(v).replace(/\s+/g, " ");
}

function emailValide(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function telephoneValide(telephone: string): boolean {
  const chiffres = telephone.replace(/[^\d]/g, "");
  return chiffres.length >= 9 && chiffres.length <= 16 && /^[+\d][\d\s().-]+$/.test(telephone);
}

function erreur(champ: string, message: string, statut = 400): Response {
  return reponseJson({ erreur: "validation", champ, message }, statut);
}

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

function expediteurEmail(): { name: string; email: string } {
  const brut = Deno.env.get("EMAIL_FROM") || EMAIL_FROM_DEFAUT;
  const match = brut.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  if (match && emailValide(match[2])) return { name: match[1].trim() || match[2], email: match[2] };
  return { name: "Adrien", email: emailValide(brut) ? brut : "adrien@prouesse.vc" };
}

async function envoyerEmailInscription(champs: {
  prenom: string;
  nom: string;
  email: string;
  telephone: string;
  organisation: string;
  fonction: string;
  profil: string;
  diner: string;
  newsletter: boolean;
  message: string;
}): Promise<{ ok: boolean; message: string }> {
  const brevoKey = Deno.env.get("BREVO_API_KEY") ?? "";
  if (!brevoKey) return { ok: false, message: "BREVO_API_KEY manquant" };

  const contenu = `Nouvelle inscription événement

Événement : ${EVENT_LABEL}
Prix : ancien tarif 60€ / invitation offerte 0€

Nom : ${champs.prenom} ${champs.nom}
Email : ${champs.email}
Téléphone : ${champs.telephone}
Organisation : ${champs.organisation || "-"}
Fonction : ${champs.fonction || "-"}
Profil : ${champs.profil}
Présence au dîner : ${champs.diner}
Infos Prouesse/Lina : ${champs.newsletter ? "Oui" : "Non"}

Message :
${champs.message || "-"}

Source : QR Netlify
Lien : https://detectus2.netlify.app/paris-19juin`;

  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "api-key": brevoKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      sender: expediteurEmail(),
      to: [{ email: NOTIFY_TO }],
      replyTo: { email: champs.email },
      subject: `Inscription événement - ${champs.prenom} ${champs.nom}`,
      textContent: contenu,
    }),
  });

  if (!res.ok) {
    const message = await res.text().catch(() => "");
    return { ok: false, message: `Brevo ${res.status}: ${message.slice(0, 300)}` };
  }
  return { ok: true, message: "envoyé" };
}

// deno-lint-ignore no-explicit-any
async function emettreJeton(req: Request, sb: any): Promise<Response> {
  const ipHash = await hacherIp(ipClient(req));
  if (ipHash) {
    const ilya1h = new Date(Date.now() - 3600_000).toISOString();
    const { count } = await sb
      .from("event_registration_tokens")
      .select("id", { count: "exact", head: true })
      .eq("event_slug", EVENT_SLUG)
      .eq("ip_hash", ipHash)
      .gte("created_at", ilya1h);
    if ((count ?? 0) >= MAX_JETONS_PAR_IP_HEURE) {
      return reponseJson({ erreur: "trop_de_demandes", message: "Trop de tentatives. Réessayez plus tard." }, 429);
    }
  }

  const token = crypto.randomUUID();
  const { error } = await sb.from("event_registration_tokens").insert({
    event_slug: EVENT_SLUG,
    token,
    ip_hash: ipHash || null,
  });
  if (error) {
    console.error("event-registration-submit token:", error.message);
    return reponseJson({ erreur: "jeton_indisponible" }, 500);
  }
  return reponseJson({ token });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return reponseJson({ erreur: "configuration_serveur" }, 500);

  const sb = createClient(supabaseUrl, serviceRoleKey);

  if (req.method === "GET") return await emettreJeton(req, sb);
  if (req.method !== "POST") return reponseJson({ erreur: "methode_non_autorisee" }, 405);

  try {
    const body = await req.json().catch(() => ({} as Champs));

    if (texte(body.site_cache) || texte(body.website_url)) {
      return reponseJson({ statut: "recu" });
    }

    const token = texte(body.token);
    if (!token) return erreur("token", "Merci de recharger la page et de renvoyer le formulaire.");

    const { data: tokenRow, error: tokenError } = await sb
      .from("event_registration_tokens")
      .select("id, created_at, consumed_at")
      .eq("event_slug", EVENT_SLUG)
      .eq("token", token)
      .maybeSingle();
    if (tokenError) {
      console.error("event-registration-submit token read:", tokenError.message);
      return reponseJson({ erreur: "interne" }, 500);
    }
    if (!tokenRow || tokenRow.consumed_at) return erreur("token", "Formulaire expiré ou déjà envoyé. Rechargez la page.");

    const ageMs = Date.now() - new Date(tokenRow.created_at).getTime();
    if (ageMs < JETON_AGE_MIN_MS) return erreur("token", "Merci de renvoyer le formulaire normalement.");
    if (ageMs > JETON_AGE_MAX_MS) return erreur("token", "Formulaire expiré. Rechargez la page.");

    const ipHash = await hacherIp(ipClient(req));
    if (ipHash) {
      const ilya1h = new Date(Date.now() - 3600_000).toISOString();
      const { count } = await sb
        .from("event_registrations")
        .select("id", { count: "exact", head: true })
        .eq("event_slug", EVENT_SLUG)
        .eq("ip_hash", ipHash)
        .gte("created_at", ilya1h);
      if ((count ?? 0) >= MAX_SOUMISSIONS_PAR_IP_HEURE) {
        return reponseJson({ erreur: "trop_de_demandes", message: "Trop d'envois depuis votre connexion. Réessayez plus tard." }, 429);
      }
    }

    const prenom = normaliser(body.prenom);
    const nom = normaliser(body.nom);
    const email = normaliser(body.email).toLowerCase();
    const telephone = normaliser(body.telephone);
    const organisation = normaliser(body.organisation);
    const fonction = normaliser(body.fonction);
    const profil = PROFILS[texte(body.profil)] ?? "";
    const diner = DINER[texte(body.diner)] ?? "";
    const newsletter = texte(body.newsletter) === "true";
    const message = texte(body.message).slice(0, 1200);

    if (!prenom) return erreur("prenom", "Merci d'indiquer votre prénom.");
    if (!nom) return erreur("nom", "Merci d'indiquer votre nom.");
    if (!emailValide(email)) return erreur("email", "Adresse email invalide.");
    if (!telephoneValide(telephone)) return erreur("telephone", "Numéro de téléphone invalide.");
    if (!profil) return erreur("profil", "Merci de choisir un profil.");
    if (!diner) return erreur("diner", "Merci d'indiquer votre présence au dîner.");

    await sb
      .from("event_registration_tokens")
      .update({ consumed_at: new Date().toISOString() })
      .eq("id", tokenRow.id);

    const emailResult = await envoyerEmailInscription({
      prenom,
      nom,
      email,
      telephone,
      organisation,
      fonction,
      profil,
      diner,
      newsletter,
      message,
    });

    const { data, error } = await sb
      .from("event_registrations")
      .insert({
        event_slug: EVENT_SLUG,
        prenom,
        nom,
        email,
        telephone,
        organisation: organisation || null,
        fonction: fonction || null,
        profil,
        diner,
        newsletter,
        message: message || null,
        source: "netlify_qr",
        ip_hash: ipHash || null,
        user_agent: req.headers.get("user-agent") || null,
        email_notification_ok: emailResult.ok,
        email_notification_message: emailResult.message,
      })
      .select("id")
      .single();

    if (error) {
      console.error("event-registration-submit insert:", error.message);
      return reponseJson({ erreur: "interne", message: "Inscription impossible pour le moment." }, 500);
    }

    return reponseJson({ statut: "recu", id: data.id, email_ok: emailResult.ok });
  } catch (e) {
    console.error("event-registration-submit:", e);
    return reponseJson({ erreur: "interne", message: "Inscription impossible pour le moment." }, 500);
  }
});

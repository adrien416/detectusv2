// =============================================================================
// Edge Function : fullenrich-phone
//
// Lance un enrichissement telephone FullEnrich pour des dossiers sans telephone.
// Admin uniquement. La cle FullEnrich reste cote Supabase.
// =============================================================================

import { corsHeaders, reponseJson } from "../_shared/cors.ts";
import { contexteAdmin } from "../_shared/admin.ts";
import { appelerFullEnrich, lireCreditsFullEnrich } from "../_shared/fullenrich.ts";

const DOMAINES_PERSO = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "msn.com",
  "yahoo.com", "yahoo.fr", "icloud.com", "me.com", "orange.fr", "wanadoo.fr",
  "free.fr", "laposte.net", "sfr.fr", "neuf.fr", "bbox.fr", "proton.me", "protonmail.com",
]);

function domainePro(email: string | null): string | null {
  const domaine = String(email || "").split("@")[1]?.toLowerCase() || "";
  if (!domaine || DOMAINES_PERSO.has(domaine)) return null;
  return domaine;
}

function texte(v: unknown): string {
  return String(v ?? "").trim();
}

function linkedinValide(url: string | null): boolean {
  return /^https?:\/\/([a-z]{2,3}\.)?linkedin\.com\/in\/\S+/i.test(String(url || ""));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const admin = await contexteAdmin(req);
    if (admin instanceof Response) return admin;

    const apiKey = Deno.env.get("FULLENRICH_API_KEY");
    const secretWebhook = Deno.env.get("FULLENRICH_WEBHOOK_SECRET");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    if (!apiKey || !secretWebhook || !supabaseUrl) {
      return reponseJson({ erreur: "Secrets FullEnrich manquants" }, 500);
    }

    const { deal_ids } = await req.json().catch(() => ({}));
    const ids = Array.isArray(deal_ids) ? [...new Set(deal_ids.map(String))].slice(0, 100) : [];
    if (!ids.length) return reponseJson({ erreur: "Aucun dossier selectionne" }, 400);

    const { data: deals, error: erreurDeals } = await admin.sb
      .from("deals")
      .select("id, prenom, nom, email, telephone, societe, activite, linkedin_url")
      .in("id", ids);

    if (erreurDeals) {
      return reponseJson({ erreur: `Lecture dossiers impossible : ${erreurDeals.message}` }, 500);
    }

    const creditsAvant = await lireCreditsFullEnrich(apiKey);
    const eligibles = [];
    const ignores = [];

    for (const d of deals ?? []) {
      if (texte(d.telephone)) {
        ignores.push({ deal_id: d.id, raison: "telephone_deja_present" });
        continue;
      }
      const firstName = texte(d.prenom);
      const lastName = texte(d.nom);
      const companyName = texte(d.societe);
      const domain = domainePro(d.email);
      const linkedinUrl = texte(d.linkedin_url);
      const aLinkedin = linkedinValide(linkedinUrl);

      if (!aLinkedin && (!firstName || !lastName || (!companyName && !domain))) {
        ignores.push({ deal_id: d.id, raison: "societe_domaine_ou_linkedin_requis" });
        continue;
      }

      eligibles.push({
        deal: d,
        entree: {
          first_name: firstName,
          last_name: lastName,
          company_name: companyName || undefined,
          domain: domain || undefined,
          linkedin_url: aLinkedin ? linkedinUrl : undefined,
          enrich_fields: ["contact.phones"],
        },
      });
    }

    if (!eligibles.length) {
      return reponseJson({ lances: 0, ignores, credits_avant: creditsAvant });
    }

    const demandes = eligibles.map((e) => ({
      deal_id: e.deal.id,
      statut: "prepare",
      mode: "phone",
      entree: e.entree,
      credits_avant: creditsAvant,
      demande_par: admin.user.id,
    }));

    const { data: requests, error: erreurRequests } = await admin.sb
      .from("fullenrich_requests")
      .insert(demandes)
      .select("id, deal_id");

    if (erreurRequests) {
      return reponseJson({ erreur: `Suivi FullEnrich impossible : ${erreurRequests.message}` }, 500);
    }

    const requestByDeal = new Map((requests ?? []).map((r) => [r.deal_id, r.id]));
    const webhookUrl = `${supabaseUrl}/functions/v1/fullenrich-webhook?secret=${encodeURIComponent(secretWebhook)}`;
    const data = eligibles.map((e) => ({
      ...e.entree,
      custom: {
        deal_id: String(e.deal.id),
        request_id: String(requestByDeal.get(e.deal.id)),
      },
    }));

    const res = await appelerFullEnrich("/contact/enrich/bulk", apiKey, {
      method: "POST",
      body: JSON.stringify({
        name: `Detectus telephones - ${new Date().toISOString()}`,
        webhook_url: webhookUrl,
        webhook_events: { contact_finished: webhookUrl },
        data,
      }),
    });

    const corps = await res.json().catch(async () => ({ detail: await res.text() }));
    if (!res.ok) {
      await admin.sb
        .from("fullenrich_requests")
        .update({ statut: "erreur", resultats: corps })
        .in("id", [...requestByDeal.values()]);
      return reponseJson({ erreur: `FullEnrich ${res.status}`, detail: corps }, 502);
    }

    const enrichmentId = corps.enrichment_id;
    await admin.sb
      .from("fullenrich_requests")
      .update({ statut: "lance", enrichment_id: enrichmentId })
      .in("id", [...requestByDeal.values()]);

    const events = eligibles.map((e) => ({
      deal_id: e.deal.id,
      type: "enrichissement",
      resume: "Recherche telephone FullEnrich lancee",
      payload: {
        enrichment_id: enrichmentId,
        request_id: requestByDeal.get(e.deal.id),
      },
      auteur_id: admin.user.id,
    }));
    await admin.sb.from("deal_events").insert(events);

    const creditsApres = await lireCreditsFullEnrich(apiKey);
    return reponseJson({
      lances: eligibles.length,
      ignores,
      enrichment_id: enrichmentId,
      credits_avant: creditsAvant,
      credits_apres: creditsApres,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return reponseJson({ erreur: `Enrichissement echoue : ${message}` }, 500);
  }
});

// =============================================================================
// Edge Function : typeform-webhook
//
// Réception temps réel des nouvelles soumissions Typeform (form pUE5Jgae).
// C'était la v6 du backlog de Djamel — la v2 la réalise (SPECS F5).
//
// - Appelée par Typeform à chaque soumission (pas de JWT : verify_jwt = false)
// - Sécurité : signature `Typeform-Signature` (HMAC-SHA256 base64, préfixe sha256=)
// - Parse form_response → autoScore → upsert deal (dédup typeform_id)
// - La réponse brute complète est conservée dans payload_brut (D14)
// - Realtime propage automatiquement le nouveau deal aux membres connectés
//
// Secrets : TYPEFORM_WEBHOOK_SECRET
// =============================================================================

import { createClient } from "npm:@supabase/supabase-js@2";
import { reponseJson } from "../_shared/cors.ts";
import { marquerSante, reponseVersDeal } from "../_shared/typeform.ts";
import { classifierSanteIA } from "../_shared/sante.ts";

function comparaisonConstante(a: string, b: string): boolean {
  const aa = new TextEncoder().encode(a);
  const bb = new TextEncoder().encode(b);
  if (aa.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < aa.length; i++) diff |= aa[i] ^ bb[i];
  return diff === 0;
}

// ── Vérification de la signature Typeform ────────────────────────────────────
// Doc : https://www.typeform.com/developers/webhooks/secure-your-webhooks/

async function verifierSignatureTypeform(
  signatureRecue: string,
  corps: string,
  secret: string,
): Promise<boolean> {
  const cle = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const hash = await crypto.subtle.sign(
    "HMAC",
    cle,
    new TextEncoder().encode(corps),
  );
  const signatureAttendue = "sha256=" + btoa(String.fromCharCode(...new Uint8Array(hash)));
  return comparaisonConstante(signatureRecue, signatureAttendue);
}

// ── Traitement ────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  try {
    // ── Configuration ──────────────────────────────────────────────────────────
    const secretWebhook = Deno.env.get("TYPEFORM_WEBHOOK_SECRET");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!secretWebhook || !supabaseUrl || !serviceRoleKey) {
      return reponseJson({ erreur: "Configuration serveur incomplète" }, 500);
    }

    // ── Lecture + vérification de signature ────────────────────────────────────
    const corps = await req.text();
    const signature = req.headers.get("Typeform-Signature") ?? "";

    const signatureValide = await verifierSignatureTypeform(signature, corps, secretWebhook);
    if (!signatureValide) {
      return reponseJson({ erreur: "Signature invalide" }, 401);
    }

    // ── Parsing du payload ──────────────────────────────────────────────────────
    const payload = JSON.parse(corps);
    const formResponse = payload.form_response;
    if (!formResponse || !formResponse.token) {
      return reponseJson({ erreur: "Payload sans form_response" }, 400);
    }

    // Conversion : parsing des refs + autoScore + payload_brut (module partagé)
    let ligne = reponseVersDeal(formResponse);

    // Classification santé par IA si les mots-clés n'ont rien détecté (temps réel,
    // un seul dossier → pas de risque de délai). Conservateur : n'ajoute qu'au
    // segment « Santé plus tard », ne retire jamais.
    const cleAnthropic = Deno.env.get("ANTHROPIC_API_KEY");
    if (!ligne.sante && cleAnthropic) {
      const estSante = await classifierSanteIA(ligne.activite, ligne.description, cleAnthropic);
      if (estSante === true) ligne = marquerSante(ligne);
    }

    const sb = createClient(supabaseUrl, serviceRoleKey);

    // ── Upsert dédupliqué ───────────────────────────────────────────────────────
    // ignoreDuplicates : si la réponse existe déjà (rejeu du webhook), on ne touche
    // à RIEN — ni au statut, ni aux notes, ni aux champs confidentiels.
    const { data: insere, error: erreurInsert } = await sb
      .from("deals")
      .upsert(ligne, { onConflict: "typeform_id", ignoreDuplicates: true })
      .select("id, prenom, nom")
      .maybeSingle();

    if (erreurInsert) {
      console.error("typeform-webhook insertion:", erreurInsert.message);
      return reponseJson({ erreur: "insertion_deal", message: "Erreur interne" }, 500);
    }

    // Rejeu d'un webhook déjà traité → rien inséré, c'est un succès idempotent
    if (!insere) {
      return reponseJson({ statut: "deja_present", typeform_id: ligne.typeform_id });
    }

    // ── Timeline : événement import ─────────────────────────────────────────────
    const { error: erreurEvent } = await sb.from("deal_events").insert({
      deal_id: insere.id,
      type: "import",
      resume: "Dossier reçu en temps réel depuis Typeform (webhook)",
      payload: { source: "typeform-webhook" },
      auteur_id: null,  // action système
    });
    if (erreurEvent) {
      // Non bloquant : le deal est inséré, seule la timeline a échoué
      console.error("deal_events import :", erreurEvent.message);
    }

    return reponseJson({
      statut: "insere",
      deal_id: insere.id,
      dossier: `${insere.prenom} ${insere.nom}`,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("typeform-webhook :", message);
    return reponseJson({ erreur: "interne", message: "Traitement impossible" }, 500);
  }
});

// En-têtes CORS communs aux Edge Functions appelées depuis le navigateur.
// Les webhooks (Typeform, Fathom) n'en ont pas besoin mais les renvoyer est sans danger.

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Réponse JSON standardisée (avec CORS)
export function reponseJson(corps: unknown, statut = 200): Response {
  return new Response(JSON.stringify(corps), {
    status: statut,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// config.example.js — Copier ce fichier en config.js et renseigner les valeurs
// config.js est gitignored par convention, mais ne contient AUCUN secret :
// l'URL Supabase et l'anon key sont publiques par conception (la sécurité vient du RLS + Auth).
//
// ⚠️ Les clés Typeform, Fathom et Anthropic ne vont JAMAIS ici : elles vivent
//    côté serveur dans les secrets des Edge Functions Supabase (`supabase secrets set`).

const CONFIG = {
  SUPABASE_URL: "https://xxxx.supabase.co",   // URL du projet Supabase
  SUPABASE_ANON_KEY: "eyJ...",                // clé anonyme publique (protégée par RLS)
};

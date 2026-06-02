# Detectus v2 — CRM Lina Capital

CRM interne de suivi du deal-flow PSFP pour Lina Capital. Évolution de [detectus v1](https://github.com/djamel-lab/detectus) (créé par Djamel) vers un vrai CRM sécurisé : login, données partagées en temps réel, informations confidentielles, et rattachement automatique des réunions Fathom aux dossiers.

## Fonctionnalités

- 🔐 **Accès protégé** : login obligatoire, comptes sur invitation uniquement
- 📥 **Deal-flow temps réel** : les leads Typeform arrivent automatiquement (webhook + synchronisation)
- 🎯 **Qualification automatique** : scoring des dossiers (secteur santé, CA, documents...)
- 📊 **Pipeline Kanban** : suivi des dossiers par statut, partagé entre tous les membres en temps réel
- 🤝 **Réunions Fathom** : chaque call enregistré est analysé (Claude Haiku), scoré sur 3 critères (intérêt projet / intérêt porteur / conformité islamique) et rattaché au bon dossier par email
- 🔒 **Infos confidentielles** : montants, valorisations, notes de due diligence — protégés derrière le login
- 📝 **Timeline & notes** : historique complet de chaque dossier (qui a fait quoi, quand)
- ✉️ **Réponses en 1 clic** : templates d'emails par statut, ouverture dans la messagerie

## Architecture

```
Front statique (Netlify)          Supabase (région EU)              APIs externes
┌─────────────────────┐          ┌──────────────────────┐
│ index.html          │── JWT ──▶│ Auth (invite-only)   │
│ vanilla JS           │          │ Postgres + RLS       │
│ + supabase-js (CDN) │◀─ Live ──│ Realtime             │          ┌──────────┐
└─────────────────────┘          │ Edge Functions ──────│─────────▶│ Typeform │
                                  │  typeform-webhook    │◀─webhook─│          │
                                  │  typeform-sync       │          ├──────────┤
                                  │  fathom-webhook      │◀─webhook─│ Fathom   │
                                  └──────────────────────┘─────────▶├──────────┤
                                                                     │ Anthropic│
                                  (v2.1 : fathom-backfill,           └──────────┘
                                   inviter-membre)
```

**Stack** : HTML/CSS/JS vanilla (un seul fichier, zéro framework, zéro build) + Supabase (Postgres, Auth, Realtime, Edge Functions Deno).

## Structure du code

```
detectusv2/
├── index.html                          ← app complète (login + CRM)
├── config.example.js                   ← template de config publique
├── netlify.toml                        ← déploiement front (génère config.js)
└── supabase/
    ├── config.toml                     ← verify_jwt par fonction
    ├── migrations/001_schema.sql       ← schéma complet (tables, RLS, Realtime)
    ├── seed.sql                        ← promotion admin des 3 comptes
    └── functions/
        ├── _shared/                    ← code partagé (CORS, retry, parsing Typeform)
        ├── typeform-sync/              ← import exhaustif + bouton Synchroniser
        ├── typeform-webhook/           ← soumissions Typeform en temps réel
        └── fathom-webhook/             ← réunions Fathom → matching → scores Claude
```

## Documents

| Fichier | Rôle |
|---|---|
| [SPECS.md](SPECS.md) | Spécification fonctionnelle complète de la v2 (avec schéma SQL) |
| [CLAUDE.md](CLAUDE.md) | Cahier des charges permanent (stack, conventions, interdits, règles métier) |
| [VERSIONS.md](VERSIONS.md) | Historique des versions et backlog (dont v2.1) |
| [HANDOFF.md](HANDOFF.md) | Document de passation : cycle de revue, décisions, ordre d'implémentation |
| [CODEX_REVIEW.md](CODEX_REVIEW.md) | Revue Codex du plan initial (validation sous réserves) |

## État du projet

🚀 **Code v2 implémenté** (4 lots) — en attente de revue Codex puis de mise en production.

---

# Mise en production — pas à pas

> Pré-requis : le token Typeform (fourni par Djamel), la clé API Fathom (compte d'Adrien ou Mahefa),
> la clé API Anthropic (celle d'Adrien), un compte [supabase.com](https://supabase.com) et un compte [netlify.com](https://netlify.com).

## Étape 1 — Créer le projet Supabase (~10 min)

1. Aller sur [supabase.com](https://supabase.com) → **New project**
2. Organisation : créer « Lina Capital » (recommandé : ne pas utiliser un compte perso)
3. Nom du projet : `detectus` · Mot de passe BDD : en générer un fort et **le sauvegarder**
4. **Région : Europe (Frankfurt `eu-central-1` ou Paris `eu-west-3`)** — obligatoire (RGPD)
5. Attendre ~2 min que le projet soit prêt
6. Noter deux informations (Settings → API) :
   - **Project URL** : `https://xxxx.supabase.co`
   - **anon public key** : `eyJ...`

## Étape 2 — Installer la CLI Supabase et lier le projet (~5 min)

```bash
# macOS
brew install supabase/tap/supabase

# Se connecter (ouvre le navigateur)
supabase login

# Depuis le dossier du repo cloné :
cd detectusv2
supabase link --project-ref <PROJECT_REF>   # le ref est dans l'URL du Dashboard
```

## Étape 3 — Appliquer le schéma de base de données (~2 min)

```bash
supabase db push
```

Cela crée les tables (`profiles`, `deals`, `deal_events`, `notes`, `meetings`), la sécurité RLS, les triggers et le Realtime.

## Étape 4 — Créer les 3 comptes admin (~5 min)

Dans le Dashboard Supabase → **Authentication → Users → Add user → Create new user** :

| Email | Action |
|---|---|
| adrien@prouesse.vc | ✅ Cocher « Auto Confirm User » + définir un mot de passe |
| djamel@lina.finance | idem |
| mahefa@prouesse.vc | idem |

> Le trigger `handle_new_user()` leur donne automatiquement le rôle **admin** (leur email est dans la liste).
> Chacun pourra changer son mot de passe via « Mot de passe oublié » sur l'écran de login.

Puis exécuter le seed (filet de sécurité) : Dashboard → **SQL Editor** → coller le contenu de `supabase/seed.sql` → **Run**.

## Étape 5 — Désactiver les inscriptions publiques (~1 min) ⚠️ IMPORTANT

Dashboard → **Authentication → Sign In / Up** → **désactiver « Allow new users to sign up »**.

Sans ça, n'importe qui pourrait créer un compte et voir les dossiers.

## Étape 6 — Configurer les secrets des Edge Functions (~3 min)

```bash
supabase secrets set \
  TYPEFORM_TOKEN="<le token de Djamel>" \
  TYPEFORM_FORM_ID="pUE5Jgae" \
  TYPEFORM_WEBHOOK_SECRET="<inventer une longue chaîne aléatoire>" \
  FATHOM_WEBHOOK_SECRET="a_remplacer_apres_etape_9" \
  ANTHROPIC_API_KEY="<la clé Anthropic d'Adrien>"
```

> Pour générer le `TYPEFORM_WEBHOOK_SECRET` : `openssl rand -hex 32`

## Étape 7 — Déployer les Edge Functions (~3 min)

```bash
supabase functions deploy typeform-sync
supabase functions deploy typeform-webhook --no-verify-jwt
supabase functions deploy fathom-webhook --no-verify-jwt
```

> `--no-verify-jwt` est nécessaire pour les 2 webhooks : ils sont appelés par Typeform/Fathom
> (pas par un utilisateur connecté) et sécurisés par signature HMAC à la place.

## Étape 8 — Créer le webhook Typeform (~2 min)

Avec le token de Djamel (remplacer `<TOKEN>`, `<PROJECT>` et `<SECRET>` — le même secret qu'à l'étape 6) :

```bash
curl -X PUT "https://api.typeform.com/forms/pUE5Jgae/webhooks/detectus-v2" \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://<PROJECT>.supabase.co/functions/v1/typeform-webhook",
    "enabled": true,
    "secret": "<SECRET>",
    "verify_ssl": true
  }'
```

Test : soumettre une réponse de test sur le form → elle doit apparaître dans le CRM en moins de 30 secondes.

## Étape 9 — Créer le webhook Fathom (~5 min)

Avec la clé API Fathom du compte qui enregistre les calls (Adrien ou Mahefa) :

```bash
curl -X POST "https://api.fathom.ai/external/v1/webhooks" \
  -H "X-Api-Key: <CLE_FATHOM>" \
  -H "Content-Type: application/json" \
  -d '{
    "destination_url": "https://<PROJECT>.supabase.co/functions/v1/fathom-webhook",
    "triggered_for": ["my_recordings"],
    "include_transcript": true,
    "include_summary": true,
    "include_action_items": true
  }'
```

La réponse contient un champ `secret` (préfixé `whsec_`). **Le copier**, puis mettre à jour le secret Supabase :

```bash
supabase secrets set FATHOM_WEBHOOK_SECRET="whsec_<le secret reçu>"
supabase functions deploy fathom-webhook --no-verify-jwt   # redéployer pour prendre le secret
```

## Étape 10 — Déployer le front sur Netlify (~10 min)

1. [netlify.com](https://netlify.com) → **Add new site → Import an existing project** → GitHub → choisir `adrien416/detectusv2`
2. Branche : `main` · Les réglages de build sont lus automatiquement depuis `netlify.toml`
3. Avant de lancer le déploiement : **Site configuration → Environment variables** → ajouter :
   - `SUPABASE_URL` = `https://xxxx.supabase.co` (étape 1)
   - `SUPABASE_ANON_KEY` = `eyJ...` (étape 1)
4. **Deploy site**
5. Optionnel : configurer un nom de domaine (ex. `detectus.lina.finance`)

## Étape 11 — Premier import et vérifications (~10 min)

1. Ouvrir l'URL Netlify → l'écran de login s'affiche (et rien d'autre ✅)
2. Se connecter avec `adrien@prouesse.vc`
3. La synchronisation Typeform se lance automatiquement → **tout l'historique du form arrive**
4. Vérifier : le nombre de dossiers = le nombre de réponses dans le Dashboard Typeform
5. Tests de sécurité (critères d'acceptation SPECS.md) :
   - [ ] Navigation privée → URL → uniquement le login (aucune donnée)
   - [ ] `curl https://xxxx.supabase.co/rest/v1/deals?apikey=<anon_key>` → `[]` (RLS active)
   - [ ] Une re-synchro ne crée pas de doublons et n'écrase pas les statuts
   - [ ] Drag & drop d'une carte → visible chez un autre membre connecté en < 2 s
   - [ ] Réunion Fathom de test → rattachée automatiquement (1 match) ou dans « À rattacher »

## Étape 12 — Couper la v1 (après quelques jours de v2 stable)

- Désactiver la page GitHub Pages `djamel-lab/detectus`
- Supprimer le Worker Cloudflare `typeform-proxy.djamel-753.workers.dev`

C'est la faille « URL ouverte » que la v2 corrige : tant que ces deux URLs existent, la donnée des porteurs reste accessible sans login.

---

## Ajouter un utilisateur (v2)

Dashboard Supabase → Authentication → Users → Add user (même procédure que l'étape 4).
⚠️ En v2, tout compte créé voit les champs confidentiels. L'invitation depuis l'app + le masquage par rôle arrivent en v2.1.

## Crédits

- **v1** : [Djamel Khamari](https://github.com/djamel-lab) — Lina Finance
- **Pipeline Fathom** : repris de [Lina_fathom_CRM](https://github.com/adrien416/Lina_fathom_CRM)
- **v2** : Lina Capital / Prouesse VC

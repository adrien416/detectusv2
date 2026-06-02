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

## Documents

| Fichier | Rôle |
|---|---|
| [SPECS.md](SPECS.md) | Spécification fonctionnelle complète de la v2 (avec schéma SQL) |
| [CLAUDE.md](CLAUDE.md) | Cahier des charges permanent (stack, conventions, interdits, règles métier) |
| [VERSIONS.md](VERSIONS.md) | Historique des versions et backlog (dont v2.1) |
| [HANDOFF.md](HANDOFF.md) | Document de passation : cycle de revue, décisions, ordre d'implémentation |
| [CODEX_REVIEW.md](CODEX_REVIEW.md) | Revue Codex du plan initial (validation sous réserves) |

## État du projet

📋 **Plan révisé après revue Codex** — le code v2 n'est pas encore écrit. Ce repo contient :
1. Le code v1 de Djamel (baseline, `index.html`)
2. Les documents de spécification v2, mis à jour selon la revue Codex (ci-dessus)

L'implémentation démarrera après validation finale du plan par Adrien (décision D11, voir HANDOFF.md §9).

## Setup (à réaliser lors de l'implémentation)

### 1. Projet Supabase
```bash
# Créer un projet sur supabase.com (région EU - Frankfurt ou Paris)
supabase link --project-ref <project-ref>
supabase db push                    # applique les migrations
psql -f supabase/seed.sql           # promotion admin des 3 comptes
```

### 2. Comptes admin par défaut
Dans le Dashboard Supabase → Authentication → Users → *Add user* (avec « Send invite ») :
- adrien@prouesse.vc
- djamel@lina.finance
- mahefa@prouesse.vc

Puis : Authentication → Settings → **désactiver « Allow new users to sign up »**

> En v2, ajouter un utilisateur = répéter cette procédure dans le Dashboard. La page admin et l'invitation depuis l'app arrivent en v2.1 (avec le masquage des champs confidentiels par rôle).

### 3. Edge Functions et secrets
```bash
supabase functions deploy typeform-sync typeform-webhook fathom-webhook

supabase secrets set \
  TYPEFORM_TOKEN=xxx \
  TYPEFORM_FORM_ID=pUE5Jgae \
  TYPEFORM_WEBHOOK_SECRET=xxx \
  FATHOM_API_KEY=xxx \
  FATHOM_WEBHOOK_SECRET=whsec_xxx \
  ANTHROPIC_API_KEY=xxx
```

### 4. Webhooks externes
- **Typeform** : form pUE5Jgae → Connect → Webhooks → `https://<project>.supabase.co/functions/v1/typeform-webhook`
- **Fathom** : `POST /external/v1/webhooks` → `https://<project>.supabase.co/functions/v1/fathom-webhook` (avec `include_transcript`, `include_summary`, `include_action_items` — périmètre `my_recordings`)

### 5. Front (Netlify)
```bash
# Connecter le repo GitHub à Netlify
# Build command : (aucune) · Publish directory : .
# Renseigner config.js avec l'URL Supabase + anon key
```

## Crédits

- **v1** : [Djamel Khamari](https://github.com/djamel-lab) — Lina Finance
- **Pipeline Fathom** : repris de [Lina_fathom_CRM](https://github.com/adrien416/Lina_fathom_CRM)
- **v2** : Lina Capital / Prouesse VC

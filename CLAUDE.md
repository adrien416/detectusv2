# Detectus v2 — Lina Capital
## Cahier des charges permanent (CLAUDE.md)

---

## 1. Ce qu'est le projet

CRM interne de Lina Capital pour le suivi du deal-flow PSFP. L'application récupère les leads depuis Typeform (temps réel), les qualifie automatiquement, permet à l'équipe de suivre l'avancement de chaque dossier dans un pipeline partagé, de stocker des informations confidentielles (montants, valorisations, notes de due diligence), et rattache automatiquement les comptes-rendus de réunions Fathom aux bons dossiers.

**Utilisateurs :** équipe Lina Capital / Prouesse VC — accès uniquement sur invitation
**Admins par défaut :** adrien@prouesse.vc, djamel@lina.finance, mahefa@prouesse.vc
**Support :** navigateur desktop (optimisé 13 pouces, MacBook Air M4)
**Accès :** protégé par login (Supabase Auth) — **plus jamais d'URL ouverte**

---

## 2. Stack technique

```
Frontend    : HTML + CSS + JavaScript vanilla (un seul fichier index.html)
              + supabase-js v2 via CDN (seule dépendance front)
Backend     : Supabase (Postgres + Auth + Realtime + Edge Functions Deno)
Données     : Postgres avec Row Level Security — partagées entre tous les membres
Secrets     : Supabase Edge Functions secrets (jamais côté client)
Déploiement : Front statique sur Netlify · Backend sur Supabase (région EU)
```

**Interdits absolus :**
- Aucun framework JS (pas de React, Vue, Angular)
- Aucune dépendance npm côté frontend (supabase-js vient du CDN)
- Aucun build step (pas de Vite, webpack, etc.)
- **Jamais de secret côté client** — l'anon key Supabase est la seule clé dans le front (elle est publique par conception, la sécurité vient du RLS)
- **Jamais de localStorage pour des données métier** — uniquement pour le thème dark/light
- Ne jamais committer de clé API dans le code (ni service_role, ni Typeform, ni Fathom, ni Anthropic)

---

## 3. Architecture des fichiers

```
detectusv2/
├── index.html              ← app complète (login + CRM, HTML + CSS + JS inline)
├── config.example.js       ← template de config publique (URL Supabase + anon key)
├── config.js               ← config publique réelle (gitignored par habitude, non secrète)
├── netlify.toml            ← config déploiement Netlify (publish ".", pas de build)
├── supabase/
│   ├── migrations/
│   │   └── 001_schema.sql  ← schéma complet (tables, RLS, triggers, enums)
│   ├── seed.sql            ← promotion admin des 3 comptes par défaut
│   └── functions/
│       ├── typeform-sync/      ← backfill + bouton Synchroniser
│       ├── typeform-webhook/   ← temps réel Typeform
│       ├── fathom-webhook/     ← réunions Fathom → matching → dossiers
│       ├── fathom-backfill/    ← import historique Fathom (one-shot)
│       └── inviter-membre/     ← invitation utilisateur (admin only)
├── CLAUDE.md               ← ce fichier
├── SPECS.md                ← spec de la version en cours
├── VERSIONS.md             ← historique et roadmap
├── HANDOFF.md              ← document de passation (revue Codex)
└── .gitignore              ← config.js, .env, supabase/.temp
```

> État actuel : seuls les documents existent (plan en revue). Le code v2 (`supabase/`, modifications d'index.html, netlify.toml) sera créé lors de la session d'implémentation, après validation du plan.

---

## 4. Configuration

### Côté front (public, non secret)
```javascript
// config.js — peut être lu par n'importe qui, ce n'est PAS un secret
const CONFIG = {
  SUPABASE_URL: "https://xxxx.supabase.co",
  SUPABASE_ANON_KEY: "eyJ...",   // clé publique, sécurité assurée par RLS
};
```

### Côté serveur (secrets Supabase — `supabase secrets set`)
```
TYPEFORM_TOKEN            ← Personal Access Token Typeform
TYPEFORM_FORM_ID          ← pUE5Jgae
TYPEFORM_WEBHOOK_SECRET   ← secret du webhook Typeform
FATHOM_API_KEY            ← clé API Fathom (Settings → API Access)
FATHOM_WEBHOOK_SECRET     ← secret de signature du webhook Fathom (whsec_...)
ANTHROPIC_API_KEY         ← clé API Anthropic (classification/extraction Haiku)
```
(`SUPABASE_URL` et `SUPABASE_SERVICE_ROLE_KEY` sont injectés automatiquement dans les Edge Functions.)

---

## 5. Règles métier — Qualification et scoring

### Scoring des leads Typeform (autoScore — repris du code v1)
- Base : 30 points
- Secteur santé (mots-clés dans activité + description) : **+25**
- Entreprise déjà créée : **+15**
- CA > 50K : **+15**
- Document fourni : **+10**
- Description > 150 caractères : **+5**
- Secteurs exclus (Restauration, Transport, VTC, Taxi, BTP) : **score 5, REFUSÉ direct**

### Seuils de décision
- Score ≥ 65 → QUALIFIÉ
- Score 21-64 → À ÉTUDIER
- Score ≤ 20 OU secteur exclu → REFUSÉ

### Statuts du pipeline CRM
`nouveau` → `info` (info demandée) → `pitch` (attente pitch) → `attente` (liste d'attente) → `accepte` / `refuse`

### Scoring des réunions Fathom (Claude Haiku — repris de Lina_fathom_CRM)
Trois scores de 1 à 5 extraits de chaque réunion prospect :
1. **Intérêt du projet pour Lina Capital** (profil dirigeant 30%, solidité financière 35%, potentiel revenus 20%, risques 15%)
2. **Intérêt du porteur pour Lina Capital** (réaction aux contraintes 40%, urgence/motivation 30%, alignement vision 30%)
3. **Conformité finance islamique** (screening halal 30%, ratios Shariah 25%, structure financement 25%, engagement éthique 20%)
+ structure recommandée (ex. Mourabaha), alertes charia, prochaine étape

> Les prompts exacts sont dans `Lina_fathom_CRM/classifier.py` (CLASSIFICATION_SYSTEM_PROMPT et EXTRACTION_SYSTEM_PROMPT) — à reprendre à l'identique.

---

## 6. Source des données — Typeform

**Endpoint :** `https://api.typeform.com/forms/{form_id}/responses` (form `pUE5Jgae`)
**Auth :** Bearer token (secret serveur)
**Mapping des refs** (identifié dans le code v1, à conserver) :

| Ref Typeform | Champ deals |
|---|---|
| `7cb1e3c9-8bbb-498f-94f6-fe6f2952db05` | prenom |
| `e19aadcb-cdcf-4d59-b5c8-e6f64f61ecb1` | nom |
| `a24b51ec-27e0-41c8-afe6-26fc9d28968e` | email |
| `b0d255f7-aae6-40e1-ad69-c6f508242778` | activite |
| `fc05b640-ec8e-4923-80ac-27298f319e3e` | entreprise_creee |
| `48916931-9ca2-4010-9427-b99f4ceab42e` | ca_tranche |
| `5dc89ab4-1f65-4fed-a1bd-4e57e36856bd` | description |
| `946de8c4-6455-426f-a039-4b38f1ebdd36` | document_url |
| `96c42553-d4d5-44aa-b088-07c5894a5c07` | telephone |
| token de la réponse | typeform_id (clé de déduplication) |
| submitted_at | date_soumission |

---

## 7. Source des données — Fathom

**API :** `https://api.fathom.ai/external/v1` — header `X-Api-Key`
**Webhook :** enregistré via `POST /webhooks` avec `include_summary: true`, `include_action_items: true`
**Signature :** style svix — headers `webhook-id` / `webhook-timestamp` / `webhook-signature`, secret préfixé `whsec_`, HMAC-SHA256 base64 sur `{webhook-id}.{webhook-timestamp}.{body}`
**Domaines internes** (jamais des prospects) : `lina.finance`, `prouesse.vc`, `leveo.fr`
**Matching :** email d'un invité externe = email d'un deal → rattachement automatique
**Rate limit :** 60 appels/min

---

## 8. Persistance — Supabase Postgres

Tables : `profiles`, `deals`, `deal_events` (timeline append-only), `notes`, `meetings`
Schéma complet : voir SPECS.md §F3
RLS activée sur toutes les tables — accès `authenticated` uniquement
Realtime activé sur `deals`, `meetings`, `notes`, `deal_events`

**Logique de sync :**
1. Au login : `chargerDeals()` lit toute la table deals
2. Realtime : tout changement (autre membre, webhook) est poussé aux clients connectés
3. Webhook Typeform/Fathom : écriture via service_role, propagée par Realtime

---

## 9. Emails de réponse — format mailto

Inchangé par rapport à v1 : templates par statut (`EMAIL_ST`), lien `mailto:` avec sujet et corps encodés (`encodeURIComponent`). L'email ne s'envoie jamais automatiquement — le membre relit et envoie depuis sa messagerie.

**Nouveau en v2 :** chaque clic sur « Ouvrir dans ma messagerie » insère un événement `email` dans la timeline du dossier (traçabilité).

---

## 10. Conventions de code

- Tout le JS dans `<script>` en bas de `index.html`, tout le CSS dans `<style>` en haut
- Fonctions nommées en camelCase français : `chargerDeals()`, `rattacherReunion()`, `inviterMembre()`, `sauvegarderConfidentiel()`
- Commentaires en français
- Pas de `console.log` en production
- Gestion d'erreur sur tous les appels Supabase et Edge Functions (try/catch + toast utilisateur)
- Edge Functions en TypeScript (Deno), commentaires en français, même rigueur de gestion d'erreur (retry 3x backoff sur les API externes)

---

## 11. Règle anti-scope-creep

Chaque version se code en une seule session. Si une idée émerge pendant le dev :
- La noter dans VERSIONS.md (backlog)
- Ne PAS l'ajouter à la version en cours
- Committer ce qui fonctionne avant d'ouvrir une nouvelle version

**Exception v2 :** la v2 est volumineuse (auth + BDD + 5 Edge Functions + refonte persistance). Elle se découpe en 4 sous-lots committés séparément (voir VERSIONS.md), tous sur la même branche.

---

## 12. Workflow Git

```bash
# Branche de développement : claude/relaxed-carson-GkaSS (puis merge vers main)
git add .
git commit -m "v2.x : description courte en français"
git push -u origin <branche>
```

Netlify déploie automatiquement depuis la branche main après merge.

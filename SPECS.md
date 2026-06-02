# SPECS v2 — Detectus CRM

> **Révision du 02/06/2026** — plan ajusté suite à la revue Codex (`CODEX_REVIEW.md`).
> Changements principaux : périmètre resserré (page admin, invitations in-app et backfill Fathom reportés en v2.1), rattachement Fathom jamais automatique en cas d'ambiguïté, transcript utilisé pour l'analyse mais jamais stocké, modèle Claude épinglé.

## Résumé en une phrase

Detectus devient le CRM sécurisé de Lina Capital : l'équipe se connecte avec un login, suit l'avancement des dossiers dans un pipeline partagé en temps réel, stocke des informations confidentielles, et les comptes-rendus de réunions Fathom se rattachent automatiquement aux bons dossiers.

---

## Non-négociables v2

1. **Authentification obligatoire** (Supabase Auth) — aucune donnée visible sans login, inscriptions publiques désactivées
2. **Les seuls comptes de la v2 sont les 3 admins** : `adrien@prouesse.vc`, `djamel@lina.finance`, `mahefa@prouesse.vc` — créés manuellement via le Dashboard Supabase. L'invitation de membres depuis l'app arrive en v2.1, **obligatoirement accompagnée du masquage des champs confidentiels par rôle**
3. **Aucun secret côté client** — toutes les clés API (Typeform, Fathom, Anthropic) vivent dans les Edge Functions Supabase (corrige la faille v1 : clés dans `config.js`)
4. **Persistance partagée** (Postgres + Realtime) — le localStorage ne stocke plus aucune donnée métier (uniquement le thème)
5. **Deal-flow Typeform conservé sans régression** — déduplication par `typeform_id`, mêmes champs, même scoring
6. **Réunions Fathom rattachées automatiquement uniquement si le match est sans ambiguïté** (exactement 1 dossier correspondant) — tout autre cas passe par la vue « À rattacher »
7. **Le transcript Fathom n'est jamais stocké** — ni en base, ni dans `payload_brut` ; il n'est utilisé qu'en mémoire le temps de l'analyse Claude
8. **Esprit v1 préservé** : un seul `index.html` vanilla JS, zéro framework, zéro build step, palette Lina, board Kanban, français partout

---

## Hors scope v2

### Reporté en v2.1 (décision revue Codex : réduire le périmètre)

- **Page admin** (liste des profils, changement de rôle membre ↔ admin)
- **Invitation de membres depuis l'app** (Edge Function `inviter-membre`)
- **Import historique Fathom** (Edge Function `fathom-backfill`)
- **Masquage des champs confidentiels pour les non-admins** — à livrer dans le même lot que les invitations : tant qu'il n'existe pas, aucun compte non-admin ne doit être créé
- **Réunions Fathom partagées** (`my_shared_with_team_recordings`) — la v2 ne traite que les réunions enregistrées par l'équipe (`my_recordings`)

### Backlog (v3+)

- Pas d'envoi automatique d'email (toujours via mailto + messagerie du membre)
- Pas d'application mobile ni de responsive complet (desktop 13 pouces comme v1)
- Pas de gestion documentaire (GED) ni de signature électronique
- Pas de statistiques avancées ni de graphiques (v3)
- Pas d'export Excel (v3)
- Pas d'intégration Pipedrive (remplacée par le CRM maison)
- Pas de lecture automatique des PDF business plan (backlog)
- Pas de cloisonnement des dossiers par propriétaire (toute l'équipe authentifiée voit tout)

---

## Spécification fonctionnelle détaillée

### F1 — Écran de connexion

Overlay plein écran affiché tant qu'aucune session n'est active. **Rien de l'app n'est rendu sans session.**

- Design : fond navy `#061D39`, logo Detectus (SVG v1), carte centrale avec champs email + mot de passe, police DM Sans
- Connexion : `sb.auth.signInWithPassword()`
- Lien « Mot de passe oublié » : `sb.auth.resetPasswordForEmail()`
- `sb.auth.onAuthStateChange()` : à `SIGNED_IN` → chargement de l'app ; à `SIGNED_OUT` → retour au login
- Bouton « Déconnexion » dans la topbar (à côté du toggle thème)
- Message d'erreur clair si identifiants invalides (en français)

---

### F2 — Utilisateurs et rôles

Deux rôles existent dans le schéma : `admin` et `membre`. **En v2, les seuls comptes sont les 3 admins** — le rôle `membre` est prévu par le schéma (pour éviter toute migration en v2.1) mais n'a aucune UI.

| Action | membre (v2.1) | admin |
|---|---|---|
| Lire/créer/modifier dossiers, notes, statuts | ✓ | ✓ |
| Voir et rattacher les réunions Fathom | ✓ | ✓ |
| Supprimer un dossier | ✗ | ✓ |
| Inviter un utilisateur, changer un rôle (v2.1) | ✗ | ✓ |

**Bootstrap des 3 admins** (étape de setup, documentée dans README) :
1. Création des 3 comptes via le Dashboard Supabase (*Authentication → Users → Add user*, avec « Send invite » ou mot de passe temporaire)
2. Le trigger `handle_new_user()` crée automatiquement leur ligne `profiles`
3. Le seed SQL (idempotent) les promeut admin :
```sql
update public.profiles set role = 'admin'
where lower(email) in ('adrien@prouesse.vc','djamel@lina.finance','mahefa@prouesse.vc');
```
4. Désactivation des inscriptions publiques (*Authentication → Settings → « Allow new users to sign up » : OFF*)

**Ajouter un utilisateur en v2** : opération manuelle d'un admin dans le Dashboard Supabase (même procédure que le bootstrap). La page admin et l'invitation depuis l'app arrivent en v2.1.

> Note : on ne crée jamais de `auth.users` par INSERT SQL (non supporté proprement par GoTrue). Le passage par le Dashboard ou l'API admin est obligatoire.

---

### F3 — Schéma de base de données (Supabase Postgres)

Toutes les tables dans le schéma `public`, **RLS activée partout**. Nommage des colonnes en français (cohérence avec le code v1).

```sql
-- ── Enums ────────────────────────────────────────────────────────────
create type public.deal_statut as enum
  ('nouveau','info','pitch','attente','accepte','refuse');
create type public.user_role as enum ('admin','membre');

-- ── profiles : utilisateurs (1-1 avec auth.users) ───────────────────
create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text unique not null,
  nom_complet text,
  role        public.user_role not null default 'membre',
  cree_le     timestamptz not null default now()
);

-- ── deals : les dossiers (table centrale) ───────────────────────────
create table public.deals (
  id                   uuid primary key default gen_random_uuid(),

  -- Champs Typeform (mapping v1 conservé, form pUE5Jgae)
  typeform_id          text unique,              -- token de réponse = clé de déduplication
  prenom               text not null default 'Inconnu',
  nom                  text not null default '—',
  email                text,                     -- clé de matching Fathom
  telephone            text,
  activite             text default 'Non précisée',
  entreprise_creee     boolean default false,
  ca_tranche           text,                     -- '+ 50K' / '< 50K'
  description          text,
  document_url         text,
  date_soumission      timestamptz,

  -- Scoring (autoScore v1, recalculé à l'import)
  score                int default 0,
  decision             text,                     -- 'QUALIFIÉ' | 'À ÉTUDIER' | 'REFUSÉ'
  motif                text,
  points_forts         jsonb default '[]'::jsonb,
  points_faibles       jsonb default '[]'::jsonb,
  action_reco          text,
  sante                boolean default false,

  -- CRM v2
  statut               public.deal_statut not null default 'nouveau',
  societe              text,
  proprietaire_id      uuid references public.profiles(id),
  source               text not null default 'typeform',  -- typeform | manuel

  -- Confidentiel v2 (due diligence)
  montant_demande      numeric(14,2),
  valorisation         numeric(14,2),
  montant_investi      numeric(14,2),
  notes_dd             text,
  prochaine_etape      text,
  date_prochaine_etape date,

  -- Méta
  cree_le              timestamptz not null default now(),
  modifie_le           timestamptz not null default now(),
  cree_par              uuid references public.profiles(id)
);
create index idx_deals_statut      on public.deals(statut);
create index idx_deals_email       on public.deals(lower(email));
create index idx_deals_typeform    on public.deals(typeform_id);
create index idx_deals_date_soum   on public.deals(date_soumission desc);

-- ── deal_events : timeline d'activité (append-only) ─────────────────
create table public.deal_events (
  id        uuid primary key default gen_random_uuid(),
  deal_id   uuid not null references public.deals(id) on delete cascade,
  type      text not null,   -- 'statut' | 'note' | 'reunion' | 'email' | 'import' | 'champ'
  resume    text not null,   -- ex : "Statut : nouveau → pitch"
  payload   jsonb,
  auteur_id uuid references public.profiles(id),  -- null = action système (webhook)
  cree_le   timestamptz not null default now()
);
create index idx_events_deal on public.deal_events(deal_id, cree_le desc);

-- ── notes : notes internes éditables ────────────────────────────────
create table public.notes (
  id         uuid primary key default gen_random_uuid(),
  deal_id    uuid not null references public.deals(id) on delete cascade,
  contenu    text not null,
  auteur_id  uuid references public.profiles(id),
  cree_le    timestamptz not null default now(),
  modifie_le timestamptz not null default now()
);
create index idx_notes_deal on public.notes(deal_id, cree_le desc);

-- ── meetings : réunions Fathom ───────────────────────────────────────
create table public.meetings (
  id                    uuid primary key default gen_random_uuid(),
  fathom_recording_id   text unique not null,   -- clé de déduplication
  deal_id               uuid references public.deals(id) on delete set null,  -- null = non rattachée
  titre                 text,
  share_url             text,
  debut                 timestamptz,
  fin                   timestamptz,
  duree_minutes         int,
  enregistre_par        text,                   -- email du membre Lina qui a enregistré
  invitees              jsonb default '[]'::jsonb,  -- calendar_invitees complet
  resume                text,                   -- summary Fathom (markdown)
  action_items          jsonb default '[]'::jsonb,

  -- Extraction Claude Haiku (3 scores, logique reprise de Lina_fathom_CRM)
  score_interet_lina    jsonb,   -- {note: 1-5, explication: "..."}
  score_interet_porteur jsonb,
  score_conformite      jsonb,
  score_global          numeric(3,1),
  structure_recommandee text,
  alertes_charia        text,
  prochaine_etape       text,
  date_prochaine_etape  date,

  -- Matching (règle revue Codex : jamais de rattachement automatique ambigu)
  matched_email         text,
  statut_match          text not null default 'non_rattache',
                        -- 'auto' (1 seul match) | 'manuel' | 'non_rattache' (0 match) | 'ambigu' (plusieurs matchs)
  matchs_candidats      jsonb default '[]'::jsonb,  -- si ambigu : [{deal_id, email, prenom, nom}] des dossiers possibles

  payload_brut          jsonb,   -- payload webhook complet SANS le transcript (rejouabilité)
  recu_le               timestamptz not null default now()
);
create index idx_meetings_deal      on public.meetings(deal_id);
create index idx_meetings_unmatched on public.meetings(statut_match) where deal_id is null;

-- ── Triggers ─────────────────────────────────────────────────────────
-- set_modifie_le() : BEFORE UPDATE sur deals et notes → modifie_le = now()
-- handle_new_user() : AFTER INSERT sur auth.users → insert profiles (role 'membre',
--                     ou 'admin' si email dans la liste des 3 admins par défaut)
```

**Politiques RLS** :

```sql
-- Helper
create or replace function public.est_admin() returns boolean
language sql security definer stable as $$
  select exists(select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

-- profiles    : SELECT authentifié ; UPDATE admin (ou soi-même hors champ role)
-- deals       : SELECT/INSERT/UPDATE authentifié ; DELETE admin uniquement
-- deal_events : SELECT/INSERT authentifié ; jamais d'UPDATE/DELETE (append-only)
-- notes       : SELECT/INSERT authentifié ; UPDATE/DELETE auteur ou admin
-- meetings    : SELECT/UPDATE (rattachement) authentifié ; INSERT via service_role uniquement
```

**Règle d'or** : le front utilise uniquement l'**anon key** + le JWT de session. Les Edge Functions utilisent la **service_role key** (jamais exposée). Realtime activé sur `deals`, `meetings`, `notes`, `deal_events`.

---

### F4 — Synchronisation Typeform (Edge Function `typeform-sync`)

Remplace le proxy Cloudflare Worker v1 (`typeform-proxy.djamel-753.workers.dev`).

- **Déclencheur** : bouton « ⟳ Synchroniser » + au chargement de l'app (comme v1), JWT utilisateur requis
- **Logique** :
  1. `GET https://api.typeform.com/forms/{TYPEFORM_FORM_ID}/responses?page_size=200` avec pagination `before` (max 5 pages, comme v1)
  2. Parsing avec le **même mapping de refs** que v1 (`parseTypeformAnswers` / `typeformToLead`, form `pUE5Jgae`)
  3. Calcul `autoScore` (logique v1 portée dans la fonction)
  4. Upsert sur `deals` avec `on conflict (typeform_id)` — **sans jamais écraser** `statut`, les champs CRM et confidentiels d'une ligne existante
  5. Pour chaque nouveau deal : insert `deal_events` type `import`
  6. Retour `{ inserted, updated, total }` affiché dans le bandeau de statut v1
- **Secrets** : `TYPEFORM_TOKEN`, `TYPEFORM_FORM_ID`

### F5 — Webhook Typeform (`typeform-webhook`) — temps réel

C'était la v6 du backlog de Djamel ; la v2 la réalise.

- **Déclencheur** : webhook Typeform configuré sur le form `pUE5Jgae` (Connect → Webhooks)
- **Sécurité** : vérification de la signature `Typeform-Signature` (HMAC-SHA256, encodage base64, préfixe `sha256=`)
- **Logique** : parse `form_response` → autoScore → upsert deal (dédup `typeform_id` = `form_response.token`) → event `import` → Realtime propage aux membres connectés
- **Secrets** : `TYPEFORM_WEBHOOK_SECRET`

---

### F6 — Webhook Fathom (`fathom-webhook`) — cœur de la v2

Pipeline repris de `Lina_fathom_CRM` (Python → Deno/TypeScript), déclenché à chaque réunion traitée par Fathom.

- **Déclencheur** : webhook Fathom — enregistré via `POST /webhooks` avec `include_transcript: true`, `include_summary: true`, `include_action_items: true`, périmètre `my_recordings` uniquement (revue Codex Q2)
- **Sécurité** : vérification de signature style svix (headers `webhook-id`, `webhook-timestamp`, `webhook-signature`, secret `whsec_`, HMAC-SHA256 base64)
- **Pipeline** (6 étapes) :
  1. **Déduplication** : si `fathom_recording_id` existe → update idempotent, stop
  2. **Invités externes** : extraire les emails des `calendar_invitees` hors domaines internes (`lina.finance`, `prouesse.vc`, `leveo.fr`) et hors liste d'emails internes
  3. **Réunion interne ?** : aucun invité externe → skip (la réunion n'entre pas dans le CRM)
  4. **Matching deal** — règle stricte (revue Codex : jamais de rattachement ambigu) : chercher `deals` où `lower(email)` ∈ emails externes
     - **exactement 1 match** → rattachement automatique (`statut_match = 'auto'`, `matched_email` renseigné)
     - **0 match** → classification Claude Haiku (prompt `CLASSIFICATION_SYSTEM_PROMPT` de Lina_fathom_CRM : prospect vs interne) ; si prospect → stockée non rattachée (`statut_match = 'non_rattache'`, visible dans « À rattacher ») ; si interne → skip
     - **plusieurs matchs** → **jamais de rattachement automatique** : stockée avec `statut_match = 'ambigu'` + `matchs_candidats` (liste des dossiers possibles), visible dans « À rattacher » avec mention explicite de l'ambiguïté
  5. **Extraction Haiku** (si rattachée ou prospect) : prompt `EXTRACTION_SYSTEM_PROMPT` de Lina_fathom_CRM, alimenté par le **résumé + le transcript complet** (meilleure qualité de scoring) → 3 scores (intérêt projet Lina / intérêt porteur / conformité islamique), structure recommandée, alertes charia, prochaine étape
  6. **Stockage** : insert `meetings` avec `payload_brut` **expurgé du transcript** ; si rattachée → insert `deal_events` type `reunion`
- **Gestion du transcript** (revue Codex) : le transcript n'existe qu'en mémoire pendant l'exécution de la fonction — envoyé à Claude pour l'analyse, puis supprimé du payload avant toute écriture en base. Aucune colonne ne le stocke.
- **Secrets** : `FATHOM_WEBHOOK_SECRET`, `ANTHROPIC_API_KEY`

### F7 — Import historique Fathom (`fathom-backfill`) — ⏭ REPORTÉ EN v2.1

> **Décision revue Codex** : le backfill historique (`GET /external/v1/meetings`, pagination `next_cursor`, rate limit 60 appels/min) est reporté en v2.1 pour réduire le périmètre. La v2 ne traite que les réunions reçues par webhook à partir de sa mise en service. Spécification conservée dans VERSIONS.md (backlog v2.1).

### F8 — Vue « Réunions à rattacher »

- Badge compteur dans la topbar (à côté des KPIs) : nombre de `meetings` où `deal_id is null`
- Vue listant ces réunions : titre, date, invités, résumé (premières lignes)
- **Cas ambigu** (`statut_match = 'ambigu'`) : bandeau « ⚠ Plusieurs dossiers possibles » + liste des dossiers candidats (`matchs_candidats`) cliquables — rattachement en 1 clic vers le bon dossier
- Sélecteur de dossier (recherche par nom/email) → rattachement manuel : `update meetings set deal_id = …, statut_match = 'manuel'` + insert `deal_events`
- Bouton « Ignorer » (la réunion ne concerne pas le deal-flow) → suppression ou flag

---

### F9 — Fiche dossier enrichie (panneau détail)

Sections v1 conservées : barre de décision, carte Projet, Analyse IA, Points forts/faibles, badges, action recommandée, bloc email mailto.

**Nouvelles sections** (dans l'ordre, après le bloc action) :

1. **Bloc Confidentiel** (style `.abox` navy, icône cadenas) :
   - Montant demandé (€), Valorisation (€), Ticket Lina (€) — inputs numériques éditables inline
   - Prochaine étape + date
   - Notes de due diligence (textarea)
   - Sauvegarde directe à la perte de focus (update `deals`)
   - *Visibilité : tous les membres connectés (en v2, tous sont admins). Le masquage par rôle arrive en v2.1 avec les invitations.*
2. **Réunions Fathom** : une carte par réunion rattachée — titre, date, durée, qui a enregistré, lien `share_url`, résumé déplié/replié, action items en liste, les 3 scores Haiku avec code couleur
3. **Notes internes** : fil de notes horodatées avec auteur (ajout, édition de ses propres notes, suppression admin)
4. **Timeline** : liste chronologique des `deal_events` (icône par type : changement de statut, note, réunion, email, import)

### F10 — Temps réel (Realtime)

```js
sb.channel('crm-live')
  .on('postgres_changes', {event:'*', schema:'public', table:'deals'}, appliquerChangementDeal)
  .on('postgres_changes', {event:'INSERT', schema:'public', table:'meetings'}, notifierNouvelleReunion)
  .subscribe();
```

- Le drag & drop d'une carte par un membre apparaît chez les autres en < 2 secondes
- Un nouveau lead Typeform (webhook) apparaît sans recharger
- Une nouvelle réunion Fathom rattachée déclenche un toast de notification

### F11 — UI v1 conservée

Topbar (logo, KPIs par statut, tabs Liste/Board, toggle thème), Sidebar (recherche, filtres Detectus/Backlog/Tri/Sélection, multi-sélection, redimensionnement), vue Board Kanban drag & drop, navigation clavier j/k. **Le HTML/CSS v1 est repris tel quel**, seule la couche données change (localStorage → supabase-js).

### F12 — Emails de réponse

Templates v1 conservés (`EMAIL_ST`, `EMAIL_SUBJECTS` par statut), bouton mailto inchangé. **Nouveau** : au clic sur « Ouvrir dans ma messagerie », un `deal_events` type `email` est inséré (traçabilité : qui a envoyé quoi, quand).

### F13 — Création manuelle de dossier

Bouton « + Nouveau dossier » dans la sidebar : formulaire modal (prénom, nom, email, activité, description, montant demandé) → insert `deals` avec `source = 'manuel'`. Permet de créer un dossier pour un prospect rencontré hors Typeform (ex. réunion Fathom non rattachée).

### F14 — Déploiement

- **Front** : Netlify (recommandé — repo privé OK, déploiement auto sur push, pas de build : `publish = "."`) ; GitHub Pages en alternative si le repo devient public
- **Supabase** : projet région EU (RGPD), migrations SQL, **3 Edge Functions** déployées via CLI (`typeform-sync`, `typeform-webhook`, `fathom-webhook`), secrets configurés
- **Webhooks** : Fathom (`POST /webhooks` vers l'URL de la fonction, avec transcript + summary + action items) + Typeform (Connect → Webhooks)

---

## Critères d'acceptation v2

- [ ] F1 — Impossible de voir un dossier ou une donnée sans être connecté (test : ouvrir l'URL en navigation privée → login uniquement)
- [ ] F1 — La déconnexion ramène à l'écran de login et purge l'état local
- [ ] F2 — Les 3 admins par défaut ont le rôle `admin` à leur premier login
- [ ] F2 — Les inscriptions publiques sont désactivées (aucune création de compte possible hors Dashboard Supabase)
- [ ] F3 — Aucune table accessible sans JWT (test direct API REST Supabase → 401 / 0 ligne)
- [ ] F4 — Le bouton Synchroniser importe les leads Typeform sans créer de doublons
- [ ] F4 — Une re-synchronisation n'écrase jamais les statuts ni les champs confidentiels
- [ ] F5 — Une nouvelle soumission Typeform apparaît dans l'app sans clic (< 30 s)
- [ ] F6 — Une réunion Fathom dont un participant correspond à **exactement un** dossier se rattache automatiquement
- [ ] F6 — Une réunion dont l'email correspond à **plusieurs** dossiers n'est **pas** rattachée automatiquement et apparaît dans « À rattacher » avec la mention d'ambiguïté
- [ ] F6 — Une réunion interne (que des emails @lina.finance / @prouesse.vc / @leveo.fr) n'apparaît pas dans le CRM
- [ ] F6 — Aucun transcript n'est stocké en base (vérifier `payload_brut` et toutes les colonnes de `meetings` après une réunion test)
- [ ] F8 — Une réunion prospect sans dossier correspondant apparaît dans « À rattacher »
- [ ] F9 — Les champs confidentiels saisis sont persistés et visibles par les autres membres
- [ ] F10 — Le déplacement d'une carte Kanban est visible chez un autre membre connecté en < 2 s
- [ ] F12 — Le clic sur le bouton email crée un événement dans la timeline
- [ ] Sécurité — Aucune clé API (Typeform, Fathom, Anthropic, service_role) n'est présente dans le code front ni dans le repo
- [ ] Esprit v1 — L'app reste un seul index.html vanilla JS sans framework ni build step

---

## Notes techniques

- **supabase-js v2** chargé via CDN (`https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2`) — seule dépendance front ajoutée
- L'**anon key** Supabase est faite pour être publique (la sécurité vient du RLS + JWT) — contrairement aux clés v1 qui étaient des secrets exposés
- **Région Supabase : EU** (Francfort ou Paris) — données financières confidentielles, RGPD
- **Transcript Fathom** : reçu dans le payload webhook (`include_transcript: true`), utilisé **en mémoire uniquement** pour l'analyse Claude, puis supprimé — jamais stocké (ni en base, ni dans `payload_brut`)
- **RGPD / Anthropic** : le résumé et le transcript des réunions sont envoyés à l'API Anthropic pour produire les 3 scores. Ce traitement est identique à celui de `Lina_fathom_CRM` (déjà en production) — il doit rester explicitement accepté par l'équipe. S'il ne l'est plus : désactiver l'étape d'extraction Haiku (le rattachement par email continue de fonctionner, sans scores).
- Idempotence partout : upsert sur `typeform_id` et `fathom_recording_id`, le rejeu d'un webhook ne crée pas de doublon
- Les prompts Claude Haiku (classification + extraction 3 scores) sont repris **à l'identique** de `Lina_fathom_CRM/classifier.py` — logique métier déjà validée par l'équipe
- **Modèle épinglé : `claude-haiku-4-5-20251001`** (revue Codex : jamais d'alias non versionné, pour qu'un changement silencieux de modèle ne modifie pas les scores)
- Gestion d'erreur : tout échec d'API externe (Typeform, Fathom, Anthropic) est loggé et n'interrompt pas le pipeline (retry 3x avec backoff, comme Lina_fathom_CRM)

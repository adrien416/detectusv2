# VERSIONS — Detectus

---

## ✅ Versions livrées

### v1 — Pipeline de qualification (djamel-lab/detectus)
> Livrée par Djamel · déployée sur GitHub Pages

**Périmètre réalisé :**
- Connexion API Typeform (via proxy Cloudflare Worker)
- Scoring automatique local (`autoScore` : santé +25, entreprise +15, CA +15, doc +10)
- Interface 3 zones (topbar KPIs / sidebar filtres / panneau détail) + vue Board Kanban drag & drop
- Statuts : nouveau → info → pitch → attente → accepté / refusé
- Templates d'emails par statut + bouton mailto
- Thème dark/light, sélection multiple, navigation clavier

**Limites connues (corrigées en v2) :**
- Pas d'authentification (URL ouverte)
- Statuts en localStorage (non partagés entre membres)
- Pas de notes, pas d'historique, pas d'infos confidentielles
- Clés API exposées côté client (config.js)

---

## 🔄 Version en cours

### v2 — CRM Lina Capital (Supabase + Fathom)
> Voir SPECS.md pour le détail complet · **périmètre resserré suite à la revue Codex** (CODEX_REVIEW.md)

**Périmètre :**
- Authentification Supabase (login obligatoire, inscriptions désactivées, 3 comptes admin créés via Dashboard)
- Persistance partagée Postgres + Realtime (remplace le localStorage)
- Suivi CRM : timeline d'activité, notes internes, champs confidentiels (montants, valorisation, due diligence)
- Intégration Fathom **temps réel** : webhook → analyse Claude Haiku (3 scores) → rattachement automatique **uniquement si match unique** → vue « À rattacher » (cas 0 match ou ambigu)
- Webhook Typeform temps réel (ex-v6 du backlog v1) + bouton Synchroniser
- Déploiement Netlify + Supabase région EU

**Découpage de l'implémentation en 4 lots** (ordre validé par Codex, chacun committé séparément) :
1. **Socle** : migrations SQL + RLS + Auth + écran de login + typeform-sync + affichage des dossiers
2. **CRM partagé** : statuts temps réel + notes + champs confidentiels + timeline + création manuelle
3. **Fathom courant** : fathom-webhook + analyse Claude + matching strict + vue « À rattacher »
4. **Finitions** : typeform-webhook temps réel + tests de sécurité + déploiement Netlify

**Statut :** 📋 Plan révisé après revue Codex — en attente de validation finale (décision D11, voir HANDOFF.md)

---

## 📋 Backlog (versions futures)

### v2.1 — Administration et historique
> Périmètre extrait de la v2 sur recommandation de la revue Codex

- **Page admin** : liste des profils (email, nom, rôle, date de création), changement de rôle membre ↔ admin
- **Invitation de membres depuis l'app** : Edge Function `inviter-membre` (envoi d'email d'invitation Supabase, admin only)
- **Masquage des champs confidentiels pour les non-admins** — ⚠️ obligatoire AVANT d'inviter le premier compte non-admin
- **Import historique Fathom** : Edge Function `fathom-backfill` (`GET /external/v1/meetings`, pagination `next_cursor`, rate limit 60 appels/min, même pipeline que le webhook)
- Extension du périmètre Fathom aux réunions partagées (`my_shared_with_team_recordings`) si utile après test

### v3 — Statistiques et pilotage
- Tableau de bord : taux de qualification par période, par activité, par secteur
- Courbe d'évolution des leads entrants (semaine/mois)
- Top 5 activités les plus fréquentes
- Funnel de conversion par statut

### v4 — Qualification enrichie
- Lecture du document PDF fourni (business plan) pour enrichir le score
- Détection automatique du montant demandé dans la description
- Alerte si le même email soumet plusieurs fois
- Qualification Claude côté serveur (Edge Function `qualify`)

### v5 — Notifications et exports
- Notification email/Slack à l'équipe quand un lead QUALIFIÉ arrive
- Export Excel des dossiers (avec scores, statuts, notes)
- Relances automatiques programmées

### v6 — Permissions avancées
- Cloisonnement des dossiers par propriétaire
- Journal d'audit complet (qui a vu quoi)

### Abandonné
- ~~Intégration Pipedrive~~ (remplacée par le CRM maison v2)

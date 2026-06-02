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
> Voir SPECS.md pour le détail complet · plan en cours de revue par Codex

**Périmètre :**
- Authentification Supabase (login obligatoire, invite-only, 3 admins par défaut)
- Persistance partagée Postgres + Realtime (remplace le localStorage)
- Suivi CRM : timeline d'activité, notes internes, champs confidentiels (montants, valorisation, due diligence)
- Intégration Fathom : réunions rattachées automatiquement aux dossiers (webhook + backfill), 3 scores Haiku
- Webhook Typeform temps réel (ex-v6 du backlog v1)
- Page admin (gestion des utilisateurs)
- Déploiement Netlify + Supabase région EU

**Découpage de l'implémentation en 4 sous-lots** (chacun committé séparément) :
1. **Socle** : migrations SQL + RLS + Auth + écran de login + import des deals Typeform
2. **CRM** : statuts partagés temps réel + champs confidentiels + notes + timeline
3. **Fathom** : fathom-webhook + fathom-backfill + UI réunions + vue « À rattacher »
4. **Admin** : page de gestion utilisateurs + inviter-membre + finitions

**Statut :** 📋 Plan rédigé, en attente de revue Codex avant implémentation

---

## 📋 Backlog (versions futures)

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
- Masquage des champs confidentiels par rôle
- Journal d'audit complet (qui a vu quoi)

### Abandonné
- ~~Intégration Pipedrive~~ (remplacée par le CRM maison v2)

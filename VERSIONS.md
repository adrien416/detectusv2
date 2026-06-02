# VERSIONS — Detectus

---

## ✅ Versions livrées

_(aucune pour l'instant)_

---

## 🔄 Version en cours

### v1 — Pipeline de base avec qualification IA
> Voir SPECS.md pour le détail complet

**Périmètre :**
- Connexion API Typeform
- Qualification IA (Claude API)
- Persistance Google Sheets (multi-utilisateurs)
- Email de réponse via mailto (Gmail)
- Interface full-screen optimisée 13 pouces

**Statut :** En cours de développement (Claude Code)

---

## 📋 Backlog (versions futures)

### v2 — Export et intégration Pipedrive
- Export Excel des leads qualifiés (avec score, décision, notes)
- Création automatique d'une opportunité Pipedrive pour les leads QUALIFIÉ
- Statut Pipedrive synchronisé avec le Sheet

### v3 — Statistiques et pilotage
- Tableau de bord : taux de qualification par période, par activité, par secteur
- Courbe d'évolution des leads entrants (semaine/mois)
- Top 5 activités les plus fréquentes

### v4 — Authentification et gestion d'équipe
- Connexion par email (lien magique ou Google OAuth)
- Historique des actions par membre
- Rôles : lecteur / traiteur / admin

### v5 — Qualification enrichie
- Lecture du document PDF fourni (via API d'extraction) pour enrichir le score
- Détection automatique du montant demandé dans la description
- Alerte si le même email soumet plusieurs fois

### v6 — Webhook Typeform (temps réel)
- Plus de bouton Synchroniser — les leads arrivent en temps réel via webhook
- Notification dans l'app quand un nouveau lead arrive
- Option : notification email/Slack à l'équipe

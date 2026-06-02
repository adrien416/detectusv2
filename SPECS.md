# SPECS v1 — Detectus

## Résumé en une phrase

L'application récupère les leads Typeform via API, les qualifie automatiquement avec Claude, et permet à l'équipe d'envoyer une réponse personnalisée en un clic via Gmail.

---

## Non-négociables v1

1. Connexion API Typeform — récupère les vraies réponses, déduplique par `typeform_id`
2. Qualification IA via API Claude — score + décision + email pré-rédigé pour chaque lead
3. Bouton "Répondre" → ouvre Gmail avec l'email pré-rempli (mailto), marque le lead "repondu" dans le Sheet

---

## Hors scope v1

- Pas d'authentification utilisateur (login/mot de passe)
- Pas d'envoi automatique d'email (toujours via Gmail manuel)
- Pas de notifications push ou email internes
- Pas de statistiques avancées ni de graphiques
- Pas d'intégration Pipedrive (v2)
- Pas d'export Excel (v2)
- Pas de tri personnalisé par colonne

---

## Spécification fonctionnelle détaillée

### F1 — Interface générale

Layout full-screen 3 zones fixes, sans scroll de page :
- **Topbar** (48px) : logo + titre + KPIs en temps réel
- **Sidebar** (260px) : liste des leads + filtres + recherche
- **Panneau détail** (reste) : dossier sélectionné

Palette Lina : `navy #061D39`, `teal #47d3b0`, `pale #E4EBF3`, `green #2ecc71`, `orange #e08c3a`, `red #e05252`
Police : DM Sans (Google Fonts)
Optimisé 13 pouces / 1280×800

---

### F2 — Topbar

Contient de gauche à droite :
- Logo Lina (icône Flaticon filtrée blanc) + "Detectus · Lina Finance" + sous-titre
- KPIs dynamiques recalculés à chaque action : `Total | Qualifiés | À étudier | Refusés | Santé`
- Bouton **"⟳ Synchroniser"** : déclenche la récupération Typeform + qualification IA

---

### F3 — Synchronisation Typeform

Déclencheur : clic sur "Synchroniser" ou au chargement initial.

Comportement :
1. Appel GET `https://api.typeform.com/forms/{FORM_ID}/responses?page_size=200`
2. Pour chaque réponse : extraire les champs mappés (voir CLAUDE.md §6)
3. Comparer avec les `typeform_id` déjà dans le Sheet Google
4. Pour les nouveaux uniquement → appel qualification Claude (F5)
5. Ajouter les nouveaux qualifiés dans le Sheet
6. Afficher un bandeau de statut : "X nouveau(x) dossier(s) ajouté(s)" ou "Aucun nouveau"
7. Afficher un spinner pendant le chargement

Pagination Typeform : si `total_items > 200`, boucler sur les pages suivantes avec `before` token.

---

### F4 — Sidebar — Liste des leads

Affiche tous les leads chargés (Sheet + nouveaux), triés par date décroissante.

Chaque item contient :
- Nom Prénom (tronqué si trop long)
- Badge score coloré (vert/orange/rouge selon décision)
- Sous-titre : Activité · Date
- Tags : `SANTÉ` (vert), `DOC` (bleu), `✓ RÉPONDU` (gris)
- Bordure gauche teal = dossier sélectionné

**Filtres** (boutons toggle) : Tous | Qualifiés | À étudier | Refusés | Santé | Non traités

**Recherche** : filtre en temps réel sur nom + prénom + activité + description

**Footer sidebar** : "X dossier(s) · Y total"

---

### F5 — Qualification IA (API Claude)

Appelé pour chaque nouveau lead non encore qualifié.

**Modèle :** `claude-sonnet-4-20250514`
**Max tokens :** 1000

**System prompt :**
```
Tu es l'expert de qualification PSFP de Lina Finance.
Analyse cette demande de financement halal et retourne UNIQUEMENT un JSON valide.

CRITÈRES ÉLIMINATOIRES (score < 35 automatique, decision = REFUSÉ) :
- Activité : restauration, café, snack, taxi, VTC, transport non médical, livraison colis, PTP
- Nom fantaisiste ou vide (toto, test, rien, —)
- Description vide ou moins de 5 mots

BONUS FORT (+30 au score) :
- Secteur santé : médecin, chirurgien, kiné, infirmier, pharmacien, dentiste, labo, cabinet médical, ambulance médicale

SEUILS : ≥65 = QUALIFIÉ | 35-64 = À ÉTUDIER | <35 = REFUSÉ

JSON attendu (aucun markdown, aucun backtick) :
{
  "decision": "QUALIFIÉ|À ÉTUDIER|REFUSÉ",
  "score": 0-100,
  "motif": "phrase courte",
  "points_forts": ["max 4 items"],
  "points_faibles": ["max 4 items"],
  "sante": true|false,
  "action": "action courte pour l'équipe"
}
```

**Gestion d'erreur :** si l'API échoue, marquer le lead `decision: "À ÉTUDIER", score: 50, motif: "Qualification manuelle requise"`

---

### F6 — Panneau détail

Affiché quand un lead est sélectionné. Scrollable verticalement.

Sections dans l'ordre :
1. **Barre de décision** (couleur = décision) : Nom complet | Email · Date | Activité · Entreprise · CA | Score /100 | Décision
2. **Carte Projet** : description complète du projet
3. **Carte Motif IA** : motif de la décision (bordure gauche colorée)
4. **Grille 2 colonnes** : Points forts (vert) | Points faibles (rouge)
5. **Badges** : Document fourni/manquant | Secteur santé | Entreprise | CA
6. **Boîte Action** (fond navy) : action recommandée pour l'équipe
7. **Prévisualisation email** : email complet pré-rédigé + destinataire
8. **Bouton principal** (si non répondu) : "✉️ Ouvrir dans Gmail" → ouvre le lien mailto + marque "repondu"
9. **Confirmation** (si répondu) : "✓ Répondu le JJ/MM/AAAA par [nom]"

---

### F7 — Templates email

**QUALIFIÉ :**
```
Sujet : Votre demande de financement Lina Finance — Suite favorable

Bonjour {prénom},

Nous avons bien étudié votre dossier de financement et nous sommes heureux de vous informer qu'il correspond à nos critères d'investissement.

Nous souhaiterions vous proposer un appel de découverte de 30 minutes afin d'échanger sur votre projet et vous présenter nos conditions de financement halal.

Pourriez-vous nous indiquer vos disponibilités cette semaine ?

Cordialement,
L'Équipe Lina Finance
06 33 60 54 12 | lina.finance
```

**À ÉTUDIER :**
```
Sujet : Votre demande de financement Lina Finance — Compléments nécessaires

Bonjour {prénom},

Nous avons bien reçu votre dossier et vous remercions de l'intérêt que vous portez à Lina Finance.

Afin de compléter notre analyse, nous aurions besoin d'un document présentant votre projet (business plan, prévisionnel ou pitch deck).

Dès réception, nous procéderons à l'étude complète de votre dossier et reviendrons vers vous rapidement.

Cordialement,
L'Équipe Lina Finance
06 33 60 54 12 | lina.finance
```

**REFUSÉ :**
```
Sujet : Votre demande de financement Lina Finance

Bonjour {prénom},

Nous vous remercions pour l'intérêt que vous portez à Lina Finance et pour le temps consacré à votre demande.

Après étude attentive de votre dossier, nous ne sommes malheureusement pas en mesure de donner une suite favorable à votre demande, en raison de critères propres à notre politique de financement.

Nous vous souhaitons plein succès dans votre projet.

Cordialement,
L'Équipe Lina Finance
06 33 60 54 12 | lina.finance
```

---

### F8 — Persistance Google Sheets

**Sheet ID :** à renseigner dans config.js
**Feuille :** "Detectus"
**Colonnes (dans l'ordre) :**
```
A: typeform_id
B: date_soumission
C: prenom
D: nom
E: email
F: activite
G: entreprise (Oui/Non)
H: ca
I: description (tronquée à 500 chars)
J: document_url
K: score
L: decision
M: motif
N: sante (TRUE/FALSE)
O: statut (nouveau/en_cours/repondu/archive)
P: traite_par
Q: date_traitement
R: notes
```

**Lecture :** GET `https://sheets.googleapis.com/v4/spreadsheets/{ID}/values/Detectus`
**Écriture :** POST/PUT via Google Sheets API v4
**Auth :** API Key publique (lecture) + OAuth2 (écriture) — ou API Key seule si le Sheet est en lecture/écriture publique

---

### F9 — Champ "Traité par"

Au moment où un membre clique "Ouvrir dans Gmail" :
- Popup modale simple : "Votre prénom ?" (sauvegardé dans localStorage pour ne pas redemander)
- Valeur stockée dans le Sheet colonne P
- Affichée dans la confirmation du panneau détail

---

### F10 — Notes manuelles

Dans le panneau détail, en bas :
- Zone de texte libre "Notes internes" (visible uniquement par l'équipe)
- Bouton "Sauvegarder" → écrit dans la colonne R du Sheet
- Valeur rechargée à chaque ouverture du dossier

---

## Critères d'acceptation v1

- [ ] F1 — L'app s'affiche en full-screen sans scroll de page sur 1280×800
- [ ] F2 — Les KPIs se mettent à jour en temps réel
- [ ] F3 — Le bouton Synchroniser charge les vrais leads Typeform
- [ ] F3 — Les leads déjà présents dans le Sheet ne sont pas re-qualifiés
- [ ] F4 — Les filtres fonctionnent : Tous, Qualifiés, À étudier, Refusés, Santé, Non traités
- [ ] F4 — La recherche filtre en temps réel
- [ ] F5 — Chaque nouveau lead reçoit un score + décision cohérente avec les règles métier
- [ ] F5 — Un chirurgien est toujours QUALIFIÉ, un VTC est toujours REFUSÉ
- [ ] F6 — Le panneau détail affiche toutes les sections dans l'ordre
- [ ] F7 — Le lien mailto ouvre Gmail avec le bon sujet et le bon corps
- [ ] F8 — Le statut "repondu" est bien écrit dans le Sheet après clic
- [ ] F9 — Le prénom du membre est demandé une seule fois puis mémorisé
- [ ] F10 — Les notes s'affichent et se sauvegardent correctement

---

## Notes techniques

- L'API Anthropic est appelée côté client — acceptable pour un outil interne
- Utiliser `encodeURIComponent()` pour le lien mailto (pas de `encodeURI`)
- Tester la gestion CORS pour Typeform et Google Sheets (ajouter les bons headers)
- Si CORS bloque, passer par un proxy Cloudflare Worker simple (à créer en cas de besoin)
- Le Sheet doit être en accès "Tout le monde avec le lien peut modifier" pour l'écriture sans OAuth

# Detectus — Lina Finance
## Cahier des charges permanent (CLAUDE.md)

---

## 1. Ce qu'est le projet

Application web interne de qualification automatique des demandes de financement PSFP reçues via Typeform. Elle récupère les leads depuis l'API Typeform, les qualifie via l'API Claude, génère des emails de réponse personnalisés, et permet à l'équipe de traiter et d'envoyer les réponses en un clic.

**Utilisateurs :** équipe interne Lina Finance (Adrien Pannetier + membres désignés)
**Support :** navigateur desktop (optimisé 13 pouces, MacBook Air M4)
**Accès :** URL partagée, pas d'authentification dans la v1

---

## 2. Stack technique

```
Frontend   : HTML + CSS + JavaScript vanilla (un seul fichier index.html)
Backend    : Aucun — tout en client-side
Données    : localStorage pour la persistance locale + sync multi-user via Google Sheets (API)
Secrets    : variables d'environnement dans un fichier .env (jamais committé)
Déploiement: GitHub Pages (djamel-lab/detectus)
```

**Interdits absolus :**
- Aucun framework JS (pas de React, Vue, Angular)
- Aucune dépendance npm côté frontend
- Aucun backend Node/Python
- Ne jamais committer les clés API dans le code
- Ne jamais utiliser de localStorage pour les données partagées entre membres

---

## 3. Architecture des fichiers

```
detectus/
├── index.html          ← app complète (HTML + CSS + JS inline)
├── config.js           ← clés API et configuration (gitignored)
├── config.example.js   ← template de config sans les vraies clés
├── CLAUDE.md           ← ce fichier
├── SPECS.md            ← spec de la version en cours
├── VERSIONS.md         ← historique et roadmap
└── .gitignore          ← inclut config.js et .env
```

---

## 4. Configuration (config.js)

```javascript
const CONFIG = {
  TYPEFORM_TOKEN: "xxx",           // Personal Access Token Typeform
  TYPEFORM_FORM_ID: "pUE5Jgae",    // ID du formulaire Typeform
  ANTHROPIC_API_KEY: "xxx",        // Clé API Anthropic Claude
  SHEETS_API_KEY: "xxx",           // Google Sheets API (lecture/écriture)
  SHEETS_ID: "xxx",                // ID du Google Sheet de persistance
};
```

---

## 5. Règles métier — Qualification PSFP

### Critères de REFUS automatique (éliminatoires)
- Activité = restauration, café, snack, fast-food
- Activité = taxi, VTC, transport non médical, livraison colis
- Activité = PTP (prêt entre particuliers)
- Localisation hors France et hors Europe
- Nom fantaisiste ou vide (toto, test, rien, —, ?, etc.)
- Description = vide ou moins de 5 mots significatifs

### Critères BONUS FORT (augmentent fortement le score)
- Secteur santé : médecin, chirurgien, kiné, infirmier, pharmacien, dentiste, orthophoniste, ostéopathe, psychologue, biologiste, laboratoire, cabinet médical, paramédical, ambulance médicale
- Document fourni (pitch deck, business plan, bilan, prévisionnel)
- Entreprise déjà créée + CA > 50K

### Score sur 100
- Base : 30 points
- Secteur santé : +30
- Document fourni : +15
- Entreprise créée : +10
- CA > 50K : +10
- Description détaillée (>50 mots) : +5
- Malus manque document : -10
- Malus activité borderline : -15

### Seuils de décision
- Score ≥ 65 → QUALIFIÉ
- Score 35–64 → À ÉTUDIER
- Score < 35 OU critère éliminatoire → REFUSÉ

---

## 6. Source des données — API Typeform

**Endpoint :** `https://api.typeform.com/forms/{form_id}/responses`
**Auth :** Bearer token (TYPEFORM_TOKEN dans config.js)
**Champs mappés :**

| Champ Typeform | Variable app |
|---|---|
| L'entreprise est-elle déjà créée ? | entreprise (Oui/Non) |
| Parlez-nous de votre projet | description |
| Quel est le CA des 12 derniers mois ? | ca |
| Quel est votre activité ? | activite |
| Merci de nous faire parvenir votre business plan | document_url |
| Votre prénom ? | prenom |
| Votre Nom ? | nom |
| Votre Email ? | email |
| token (réponse Typeform) | typeform_id (clé de déduplication) |
| submitted_at | date |

---

## 7. Persistance multi-utilisateurs — Google Sheets

**Objectif :** éviter qu'un membre traite un lead déjà traité par un autre.

**Structure du Sheet "Detectus" :**

| typeform_id | prenom | nom | email | activite | date | score | decision | statut | traite_par | date_traitement | notes |
|---|---|---|---|---|---|---|---|---|---|---|---|

**Statuts possibles :**
- `nouveau` — jamais vu
- `en_cours` — quelqu'un a ouvert le dossier
- `repondu` — email envoyé
- `archive` — classé sans suite

**Logique de sync :**
1. Au chargement : lire le Sheet et charger tous les leads connus
2. À chaque sync Typeform : ajouter les `typeform_id` absents du Sheet
3. Quand un email est envoyé : mettre à jour le statut + `traite_par` + `date_traitement`
4. Rafraîchissement automatique toutes les 5 minutes

---

## 8. Email de réponse — format mailto

L'email de réponse s'ouvre dans le client Gmail du membre via un lien `mailto:`. Il ne s'envoie pas automatiquement — le membre relit et envoie manuellement.

**Format du lien :**
```
mailto:{email}?subject={sujet encodé}&body={corps encodé}
```

**Sujet selon décision :**
- QUALIFIÉ → `Votre demande de financement Lina Finance — Suite favorable`
- À ÉTUDIER → `Votre demande de financement Lina Finance — Compléments nécessaires`
- REFUSÉ → `Votre demande de financement Lina Finance`

**Corps selon décision :**
→ voir templates dans SPECS.md v1

---

## 9. Conventions de code

- Tout le JS dans `<script>` en bas de `index.html`
- Tout le CSS dans `<style>` en haut de `index.html`
- Fonctions nommées en camelCase français : `chargerLeads()`, `qualifierDossier()`
- Commentaires en français
- Pas de `console.log` en production
- Gestion d'erreur sur tous les appels API (try/catch + message utilisateur)

---

## 10. Règle anti-scope-creep

Chaque version se code en une seule session. Si une idée émerge pendant le dev :
- La noter dans VERSIONS.md (backlog)
- Ne PAS l'ajouter à la version en cours
- Committer ce qui fonctionne avant d'ouvrir une nouvelle version

---

## 11. Workflow Git

```bash
# Branche unique : main
git add .
git commit -m "v1 : description courte en français"
git push origin main
```

GitHub Pages déploie automatiquement depuis main.
URL : `https://djamel-lab.github.io/detectus/`

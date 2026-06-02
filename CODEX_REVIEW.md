# Revue Codex du plan Detectus v2

Date : 02/06/2026  
Branche revue : `claude/relaxed-carson-GkaSS`  
Objet : avis sur le plan v2 avant implementation

## Conclusion courte

Le plan est globalement solide et peut servir de base. Je le valide sous reserves.

Le choix Supabase + Netlify + front vanilla est coherent pour un CRM interne Lina Capital. Les bons garde-fous sont presents : login obligatoire, donnees partagees, secrets cote serveur, region Europe, conservation de l'esprit v1.

Le principal risque n'est pas le choix technique, mais le volume de la v2. Elle regroupe trop de sujets a la fois : authentification, base partagee, CRM, notes, champs confidentiels, Typeform temps reel, Fathom, backfill historique et page admin.

## Points a corriger avant de coder

### 1. Reduire le perimetre de la v2

Recommandation : livrer une v2 plus courte, puis une v2.1.

Perimetre recommande pour v2 :
- login obligatoire
- import Typeform via Supabase
- dossiers partages
- statuts partages en temps reel
- notes internes
- champs confidentiels
- rattachement Fathom courant
- vue "A rattacher"

A reporter en v2.1 :
- page admin complete
- backfill historique Fathom
- automatisation avancee de l'invitation membre

Raison : mieux vaut une premiere version stable et testable qu'une grosse version ou chaque integration peut bloquer les autres.

### 2. Ne jamais rattacher automatiquement une reunion ambigue

Le plan dit : si plusieurs dossiers correspondent a un email Fathom, rattacher au dossier le plus recent.

Je recommande de changer cette regle.

Nouvelle regle :
- 1 seul match : rattachement automatique
- 0 match : liste "A rattacher"
- plusieurs matchs : liste "A rattacher", avec mention de l'ambiguite

Raison : une reunion mal rattachee a un mauvais dossier est plus dangereuse qu'un clic manuel.

### 3. Clarifier l'usage du transcript Fathom

Le plan dit que le transcript n'est pas stocke. C'est une bonne decision.

Mais pour scorer correctement une reunion avec Claude Haiku, le transcript complet peut etre utile. Recommandation :
- recuperer le transcript uniquement pendant l'analyse
- envoyer le transcript a Claude pour produire les scores
- ne jamais stocker le transcript en base
- ne pas le conserver dans `payload_brut`

Raison : on garde la qualite d'analyse sans alourdir la base ni conserver inutilement des donnees sensibles.

### 4. Revoir la visibilite des champs confidentiels

Le plan actuel dit que tous les membres voient les montants, valorisations et notes de due diligence.

Decision recommandee :
- si l'equipe reste Adrien / Djamel / Mahefa : OK pour la v2
- si d'autres membres sont invites : masquer les champs confidentiels aux non-admins ou creer un role dedie

Raison : ces informations sont sensibles. Il faut eviter qu'un simple compte invite voie tout par defaut.

### 5. Attention RGPD et Anthropic

Supabase en region Europe est une bonne decision.

Mais si les comptes-rendus Fathom ou transcripts sont envoyes a Anthropic pour analyse, il faut accepter explicitement ce traitement. La region Supabase ne suffit pas a elle seule a garantir que toute la chaine reste strictement europeenne.

Decision a prendre avant implementation :
- confirmer que l'usage d'Anthropic pour analyser les reunions est accepte
- sinon, limiter l'analyse automatique ou prevoir une alternative

### 6. Corriger `config.example.js`

Incoherence trouvee : `config.example.js` est encore au format v1 et contient des exemples de cles Typeform, Anthropic et Google Sheets cote navigateur.

Or le plan v2 dit exactement l'inverse : plus aucun secret dans le front.

Correction recommandee avant de coder :
- `config.example.js` ne doit contenir que :
  - `SUPABASE_URL`
  - `SUPABASE_ANON_KEY`
- retirer les exemples :
  - `TYPEFORM_TOKEN`
  - `ANTHROPIC_API_KEY`
  - `SHEETS_API_KEY`
  - `SHEETS_ID`

### 7. Utiliser un modele Claude versionne

Le plan mentionne `claude-haiku-4-5`.

Pour un outil metier, je recommande d'utiliser une version precise :

`claude-haiku-4-5-20251001`

Raison : eviter qu'un changement silencieux de modele modifie les scores Fathom sans prevenir.

## Reponses aux questions ouvertes du HANDOFF

### Q1 - Reunion non rattachee : creer un dossier automatiquement ?

Recommandation : non.

Garder la liste "A rattacher". Creation manuelle si besoin.

### Q2 - Perimetre Fathom : seulement `my_recordings` ou aussi les reunions partagees ?

Recommandation : commencer par `my_recordings`, puis ajouter les reunions partagees seulement apres test.

Raison : les reunions partagees peuvent vite ajouter du bruit.

### Q3 - Repartir de zero pour les statuts v1 ?

Recommandation : oui, mais faire une capture avant.

Les statuts v1 sont stockes localement par navigateur, donc ils ne sont pas fiables comme source officielle. En revanche, il peut etre utile de faire une capture manuelle des statuts d'Adrien ou Djamel avant bascule.

### Q4 - Les membres non-admin voient-ils les champs confidentiels ?

Recommandation : oui uniquement si l'equipe reste tres restreinte. Sinon, non.

### Q5 - Verification Fathom live

Oui, a faire avant implementation. Les champs documentes actuellement incluent notamment `recording_id`, `calendar_invitees`, `recorded_by`, `default_summary`, `action_items`, et les signatures `webhook-id`, `webhook-timestamp`, `webhook-signature`.

Reference : https://developers.fathom.ai/webhooks

### Q6 - Verification signature Typeform

Oui, a faire. La signature Typeform utilise `Typeform-Signature` avec un HMAC SHA-256 prefixe par `sha256=`.

Reference : https://www.typeform.com/developers/webhooks/secure-your-webhooks/

### Q7 - Mapping Typeform

Oui, a verifier sur le formulaire `pUE5Jgae` avant implementation. C'est un point fragile : si une question Typeform a ete modifiee, le mapping peut casser silencieusement.

### Q8 - Choix du modele Haiku

Recommandation : `claude-haiku-4-5-20251001`.

### Q9 - Scope v2

Recommandation : reduire.

Je reporterais au moins :
- page admin complete
- backfill Fathom historique

## Ordre d'implementation recommande

### Lot 1 - Socle

- Supabase schema + securite
- login
- import Typeform manuel
- affichage des dossiers depuis Supabase

Critere : l'equipe se connecte et voit les dossiers.

### Lot 2 - CRM partage

- changement de statut partage
- notes internes
- champs confidentiels
- timeline simple

Critere : le CRM remplace vraiment le localStorage.

### Lot 3 - Fathom courant

- webhook Fathom
- analyse Claude
- rattachement automatique seulement si un seul match
- vue "A rattacher"

Critere : une reunion test se rattache correctement, ou apparait a rattacher si ambiguë.

### Lot 4 - Finitions v2

- Typeform webhook temps reel
- tests de securite
- deploiement Netlify
- verification sans secret dans le front

## Avis final

Le plan est bon, mais il doit etre resserre avant implementation.

Validation recommandee : oui, sous reserves des corrections ci-dessus.

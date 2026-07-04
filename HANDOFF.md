# HANDOFF — Plan Detectus v2 (révisé après revue Codex)

> **Destinataire :** l'équipe Lina Capital (Adrien, Djamel, Mahefa)
> **Objet :** plan v2 révisé suite à la revue Codex — prêt pour validation finale avant implémentation
> **Date :** 02/06/2026

---

## 0. Cycle de revue

| Étape | Statut |
|---|---|
| Plan initial (SPECS, CLAUDE, VERSIONS, HANDOFF) | ✅ commit `cb70736` |
| Revue Codex (`CODEX_REVIEW.md`) | ✅ commit `b852da6` — **« validé sous réserves »** |
| Révision du plan selon la revue | ✅ commit `2a3aea5` |
| Décision D11 (analyse Anthropic) tranchée par Adrien | ✅ **OUI** — 02/06/2026 (résumé + transcript, comme Lina_fathom_CRM) |
| Implémentation (4 lots) | ✅ Lot 1 `c42c464` · Lot 2 `5a65d9b` · Lot 3 `d95b405` · Lot 4 `5ed979f` |
| Revue Codex du code (PR #1) | ✅ 2 commentaires P2 + correctif `18f960e` (XSS, grants SQL, publication Netlify restreinte, signatures à temps constant) |
| Merge de la PR #1 vers `main` | ✅ commit `8968038` — 02/06/2026, autorisé par Adrien |
| **Mise en production** (guide README.md + HANDOFF §10) | ✅ **EN PRODUCTION** — site Netlify + Supabase branchés ; mise à jour templates/santé à appliquer |

### Corrections Codex appliquées

| # | Demande Codex | Application dans le plan révisé |
|---|---|---|
| 1 | Réduire le périmètre v2 | Page admin, `inviter-membre` et `fathom-backfill` reportés en **v2.1** (SPECS « Hors scope », VERSIONS.md) |
| 2 | Jamais de rattachement automatique ambigu | Nouvelle règle de matching : 1 match = auto · 0 ou plusieurs = « À rattacher » (SPECS F6, statut `ambigu` + `matchs_candidats`) |
| 3 | Transcript : analyser sans stocker | Transcript reçu par webhook, utilisé en mémoire pour Claude, expurgé de `payload_brut` avant stockage (SPECS F6 + non-négociable #7) |
| 4 | Visibilité des champs confidentiels | Sans objet en v2 : les seuls comptes sont les 3 admins. Le masquage par rôle est **obligatoire en v2.1** avant toute invitation de non-admin |
| 5 | RGPD / envoi des données à Anthropic | Décision **D11 tranchée par Adrien : OUI** (voir §6) |
| 6 | Corriger `config.example.js` | ✅ Fait : ne contient plus que `SUPABASE_URL` + `SUPABASE_ANON_KEY` (plus aucun exemple de secret) |
| 7 | Modèle Claude versionné | `claude-haiku-4-5-20251001` épinglé partout (SPECS, CLAUDE.md) |

---

## 1. Contexte et état du repo

**Demande d'Adrien** : transformer detectus (outil de qualification deal-flow créé par Djamel) en vrai CRM pour Lina Capital — login obligatoire, suivi des dossiers, infos confidentielles, et récupération automatique des réunions Fathom — tout en gardant la base et l'esprit de l'app v1.

> ⚠️ **Section historique (phase de planification).** L'état réel et à jour du projet est dans la section **« État actuel »** en fin de document.

**Au démarrage, ce repo contenait** (avant l'écriture du code v2) :

| Commit | Contenu |
|---|---|
| `5fec7c7` — v1 baseline | Le code v1 de Djamel copié tel quel (index.html, config.example.js, docs v1) |
| `cb70736` — plan v2 | Les documents de plan v2 : SPECS.md, CLAUDE.md, VERSIONS.md, README.md, HANDOFF.md |
| `b852da6` — revue Codex | CODEX_REVIEW.md : validation sous réserves + réponses aux questions ouvertes |
| (ce commit) — plan révisé | Tous les documents mis à jour selon la revue |

**Sources analysées pour ce plan :**
- Le code complet de detectus v1 (zip fourni par Adrien)
- Le code complet de `Lina_fathom_CRM` (zip fourni par Adrien) — pipeline Python Fathom → Google Sheets existant
- Les conventions publiques de Djamel (repos djamel-lab : definus, lina-fonds-halal)

---

## 2. ⚠️ Point de vigilance : la doc v1 ne correspond pas au code v1

La documentation v1 (SPECS.md/CLAUDE.md d'origine) décrit des choses que le code ne fait pas. **La référence pour la v2 est le CODE v1, pas sa doc.**

| Sujet | Ce que dit la doc v1 | Ce que fait le code v1 (`index.html`) |
|---|---|---|
| Scoring | API Claude (claude-sonnet) avec system prompt | `autoScore()` 100 % local (santé +25, entreprise +15, CA +15, doc +10) |
| Persistance | Google Sheets multi-utilisateurs | localStorage uniquement (par navigateur) |
| Source Typeform | API directe avec Bearer token | Proxy Cloudflare Worker (`typeform-proxy.djamel-753.workers.dev`) |
| Statuts | nouveau / en_cours / repondu / archive | nouveau / info / pitch / attente / accepte / refuse |

La v2 reprend les statuts et le scoring **du code**, et règle le problème de persistance avec Postgres.

---

## 3. Décisions (mises à jour après revue Codex)

| # | Décision | Justification |
|---|---|---|
| D1 | **Backend Supabase** (Postgres + Auth + Realtime + Edge Functions) | Validé par Adrien et Codex. Login + données partagées + RLS + webhooks sans gérer de serveur. Gratuit à ce volume. |
| D2 | **Front vanilla JS conservé** (un seul index.html, pas de framework) | Esprit v1 de Djamel = interdit absolu de framework. supabase-js via CDN est la seule dépendance ajoutée. |
| D3 | **Prompts Claude Haiku repris à l'identique** de Lina_fathom_CRM | Logique métier (3 scores, classification prospect/interne) déjà validée par l'équipe en production. |
| D4 | **Les secrets passent tous côté serveur** (Edge Functions) | Corrige la faille v1 (clés API dans config.js côté client). |
| D5 | **Le scoring autoScore reste côté front** (et porté dans typeform-sync) | Logique simple et dérivable, pas une donnée à protéger. |
| D6 | **Transcript Fathom jamais stocké** — utilisé en mémoire pour l'analyse Claude uniquement | ⬆ Renforcée par la revue Codex : le transcript alimente le scoring Haiku puis est jeté ; `payload_brut` est expurgé. |
| D7 | **Rattachement automatique uniquement si match unique** — 0 ou plusieurs matchs → « À rattacher » | ⬆ Modifiée par la revue Codex : une réunion mal rattachée est plus dangereuse qu'un clic manuel. |
| D8 | **Hébergement front : Netlify** | Repo privé compatible. Déploiement auto sur push. |
| D9 | **Statuts localStorage v1 non migrés** (repart de zéro) **avec capture préalable** | ⬆ Complétée par la revue Codex : faire une capture manuelle des statuts v1 d'Adrien/Djamel avant la bascule (filet de sécurité). |
| D10 | **Région Supabase EU** | RGPD — données financières et personnelles. |
| D11 | ✅ **Analyse des réunions par l'API Anthropic — CONFIRMÉE par Adrien (02/06/2026)** | Le résumé + transcript de chaque réunion prospect part vers l'API Anthropic pour produire les 3 scores — même traitement que `Lina_fathom_CRM` (déjà en production). La revue Codex demandait une acceptation explicite (RGPD : la chaîne ne reste pas 100 % européenne) : c'est fait. |
| D12 | **Périmètre v2 réduit** : page admin, invitations in-app et backfill Fathom → v2.1 | Revue Codex : mieux vaut une v2 courte et stable qu'une grosse version où chaque intégration peut bloquer les autres. |
| D13 | **Périmètre Fathom = `my_recordings` uniquement** | Revue Codex Q2 : les réunions partagées ajoutent du bruit ; à élargir en v2.1 après test. |
| D14 | **Sanctuarisation des réponses Typeform** (ajoutée le 02/06/2026 suite à la question d'Adrien) | La donnée des porteurs de projet est l'actif principal : import **exhaustif** (suppression de la limite v1 de 1 000 réponses), réponse brute conservée dans `deals.payload_brut`, historique propriété de Lina Capital dans son Postgres (Typeform n'est plus un point de défaillance unique). |
| D15 | **Professions de santé conservées mais non traitées pour l'instant** (03/06/2026) | Les dossiers santé ne sont plus qualifiés comme priorité immédiate. Ils restent en base avec le statut `sante` / « Santé plus tard » et un email poli dédié explique que Lina ne finance pas encore ce segment mais garde le dossier pour réouverture future. |

---

## 4. Architecture proposée (résumé)

```
Front statique (Netlify) ── anon key + JWT ──▶ Supabase EU
                                               ├── Auth (signups désactivés, 3 admins)
                                               ├── Postgres + RLS (profiles, deals,
                                               │   deal_events, notes, meetings)
                                               ├── Realtime (sync live entre membres)
                                               └── Edge Functions (3 en v2) :
                                                   ├── typeform-sync     ──▶ Typeform API
                                                   ├── typeform-webhook  ◀── Typeform (temps réel)
                                                   └── fathom-webhook    ◀── Fathom (réunion traitée)
                                                       └─▶ Claude Haiku (classification + 3 scores)

                                               (v2.1 : fathom-backfill, inviter-membre)
```

Détails complets : **SPECS.md** (schéma SQL, RLS, pipeline Fathom 6 étapes, critères d'acceptation).

---

## 5. Checklist des pré-requis humains avant la session de code

Ces éléments doivent être prêts **avant** de démarrer l'implémentation. Répartition par personne :

### 5a. À fournir par Djamel — Typeform uniquement (message WhatsApp, voir §5c)

- [ ] **Token Typeform tous scopes** : Personal Access Token du compte qui possède le form `pUE5Jgae` (admin.typeform.com → Settings → Personal tokens — **cocher tous les scopes** : lecture des réponses + gestion des webhooks). Avec ce seul token, l'import de l'historique **et** la création du webhook temps réel se font par l'API — Djamel n'a rien d'autre à faire
- [ ] *Alternative* : ajouter Adrien (adrien@prouesse.vc) comme admin du workspace Typeform — il génère le token lui-même
- [ ] **Après la mise en service de la v2** : couper le Worker Cloudflare `typeform-proxy.djamel-753.workers.dev` et la page GitHub Pages v1 (`djamel-lab/detectus`) — ils exposent la donnée des porteurs sans authentification, c'est la faille que la v2 corrige

### 5b. Côté Adrien / Mahefa

- [x] **Décision D11 tranchée** (envoi des réunions à l'API Anthropic) → **OUI**, confirmé par Adrien le 02/06/2026
- [ ] **Clé API Anthropic** : celle de `Lina_fathom_CRM` — **c'est la clé d'Adrien**
- [ ] **Clé API Fathom** : le compte Fathom qui enregistre les calls prospects est celui d'**Adrien ou de Mahefa** (Settings → API Access) + vérifier que le plan Fathom inclut l'API publique et les webhooks
- [ ] **Projet Supabase créé** (région EU) — décider qui en est propriétaire (recommandation : compte/orga Lina Capital)
- [ ] **Compte Netlify** relié au repo GitHub `adrien416/detectusv2`
- [ ] **Inviter Djamel et Mahefa** comme collaborateurs du repo GitHub `adrien416/detectusv2`
- [ ] *(Optionnel, D9)* Capture des statuts v1 avant la bascule (console navigateur → `copy(localStorage.getItem('detectus-statuts'))`) — pour garder une trace du tri actuel
- [ ] Les 3 admins disponibles pour définir leur mot de passe (email d'invitation Dashboard Supabase)

### 5c. Message type envoyé à Djamel (WhatsApp)

> Salut Djamel 👋
>
> On lance la v2 de Detectus (login + base de données partagée + réunions Fathom rattachées aux dossiers).
>
> J'ai juste besoin du Typeform de ta part, tout le reste je gère :
>
> → Un **Personal Access Token** de ton compte Typeform avec **tous les scopes** : admin.typeform.com → Settings → Personal tokens → Generate a new token (coche tout)
>
> → Ou plus simple : ajoute-moi en admin sur le workspace (adrien@prouesse.vc) et je le génère moi-même
>
> Avec ça je récupère tout l'historique des réponses ET je branche le webhook temps réel — tu n'as rien d'autre à faire.
>
> Merci 🙏

Une fois reçu, le token (et les clés Fathom/Anthropic d'Adrien et Mahefa) sont mis dans les **secrets des Edge Functions Supabase** (`supabase secrets set`) — jamais dans le code ni dans le repo.

---

## 6. Questions ouvertes → réponses Codex → décisions appliquées

| # | Question | Réponse Codex | Décision appliquée |
|---|---|---|---|
| Q1 | Réunion non rattachée : créer un dossier automatiquement ? | **Non** — garder la liste « À rattacher » | ✅ D7 confirmée (création manuelle si besoin, F13) |
| Q2 | Périmètre Fathom : `my_recordings` seul ou aussi les réunions partagées ? | **`my_recordings` d'abord**, élargir après test | ✅ D13 — réunions partagées reportées en v2.1 |
| Q3 | Repartir de zéro pour les statuts v1 ? | **Oui, avec capture préalable** | ✅ D9 complétée — capture ajoutée à la checklist §5 |
| Q4 | Les non-admins voient-ils les champs confidentiels ? | Oui **seulement** si l'équipe reste très restreinte | ✅ Sans objet en v2 (3 admins seulement) ; masquage par rôle obligatoire en v2.1 avec les invitations |
| Q5 | Vérifier le payload webhook Fathom sur la doc live | Champs confirmés : `recording_id`, `calendar_invitees`, `recorded_by`, `default_summary`, `action_items` + signature svix ([doc](https://developers.fathom.ai/webhooks)) | ✅ À re-vérifier au début du Lot 3 (tâche d'implémentation) |
| Q6 | Vérifier la signature webhook Typeform | Header `Typeform-Signature`, HMAC SHA-256, préfixe `sha256=` ([doc](https://www.typeform.com/developers/webhooks/secure-your-webhooks/)) | ✅ Intégré dans SPECS F5 ; à re-vérifier au Lot 4 |
| Q7 | Vérifier le mapping des refs Typeform (form `pUE5Jgae`) | Oui, point fragile — un changement de question casse le mapping silencieusement | ✅ Tâche obligatoire au début du Lot 1 (avant d'écrire typeform-sync) |
| Q8 | Quel modèle Haiku ? | **`claude-haiku-4-5-20251001`** (version épinglée) | ✅ Appliqué partout (SPECS, CLAUDE.md) |
| Q9 | Réduire le scope v2 ? | **Oui** — reporter page admin + backfill Fathom | ✅ D12 — v2.1 créée dans VERSIONS.md |

**Toutes les décisions sont tranchées** — D11 (Anthropic) confirmée par Adrien le 02/06/2026.

---

## 7. Ordre d'implémentation (4 lots — ordre validé par Codex)

```
Lot 1 — Socle
  1. Vérification du mapping Typeform sur le form pUE5Jgae (Q7)
  2. supabase/migrations/001_schema.sql (tables, enums, RLS, triggers)
  3. supabase/seed.sql (promotion des 3 admins)
  4. Setup projet Supabase + comptes admin (Dashboard) + désactivation signups
  5. index.html : écran de login + gestion de session
  6. Edge Function typeform-sync + bouton Synchroniser branché dessus
  7. chargerDeals() depuis Postgres (remplace localStorage)
  ✓ Critère : l'équipe se connecte et voit les dossiers Typeform

Lot 2 — CRM partagé
  8. Changements de statut → update deals + deal_events (+ Kanban)
  9. Realtime (sync live entre membres)
  10. Bloc Confidentiel + notes + timeline dans le panneau détail
  11. Création manuelle de dossier
  12. Événement timeline au clic sur le bouton email (mailto)
  ✓ Critère : le CRM remplace vraiment le localStorage, le suivi est partagé et tracé

Lot 3 — Fathom courant
  13. Vérification du payload webhook Fathom sur la doc live (Q5)
  14. Edge Function fathom-webhook (pipeline 6 étapes + Haiku + matching strict)
  15. UI : réunions dans le panneau détail + vue « À rattacher » (avec cas ambigu)
  16. Enregistrement du webhook Fathom (my_recordings, transcript + summary + action items)
  ✓ Critère : une réunion test à 1 match se rattache automatiquement ;
              une réunion ambiguë apparaît dans « À rattacher » sans rattachement

Lot 4 — Finitions v2
  17. Webhook Typeform temps réel (typeform-webhook + signature)
  18. Tests de sécurité (RLS sans JWT, navigation privée, pas de secret dans le front)
  19. netlify.toml + déploiement Netlify
  20. Vérification de tous les critères d'acceptation SPECS.md
  ✓ Critère : tous les critères d'acceptation cochés
```

**Reporté en v2.1** : page admin, Edge Function `inviter-membre`, Edge Function `fathom-backfill`, masquage des champs confidentiels par rôle, réunions Fathom partagées.

---

## 8. Critères de « done » de la session de code

La v2 est terminée quand **tous les critères d'acceptation de SPECS.md** sont vérifiés, et en particulier :
- Aucune donnée accessible sans login (test en navigation privée)
- Les 3 admins peuvent se connecter et ont le rôle admin
- Un lead Typeform de test apparaît en temps réel
- Une réunion Fathom de test (match unique) se rattache au bon dossier avec ses 3 scores
- Une réunion Fathom ambiguë (plusieurs matchs) n'est PAS rattachée et apparaît dans « À rattacher »
- Aucun transcript stocké en base
- Le drag & drop Kanban se propage entre deux navigateurs connectés
- Aucun secret dans le code front ni dans le repo

---

## 9. Historique du projet (résumé)

Le cycle complet plan → revue → implémentation → revue du code → merge est terminé (voir §0). Le code v2 est sur `main`. Le token Typeform a été fourni par Djamel le 02/06/2026.

---

## 10. Mise en production — suivi d'avancement

> Guide détaillé : **README.md** (chaque étape avec les commandes exactes).
> Réalisée par Adrien (non-développeur) avec assistance Claude — terminal nécessaire uniquement pour les Edge Functions et les webhooks.

### Mise à jour Codex du 03/06/2026 — templates emails + santé

Objectif : améliorer le CRM sans perdre les données déjà en production.

Inclus dans la mise à jour :
- Mode admin « Emails » : les admins peuvent modifier les templates depuis l'app.
- Variables disponibles dans les emails : `{{prenom}}`, `{{nom}}`, `{{email}}`, `{{activite}}`, `{{societe}}`, `{{entreprise}}`.
- Le bouton « Ouvrir dans ma messagerie » ouvre un nouvel onglet pour ne pas perdre Detectus.
- Les compteurs du haut deviennent cliquables et filtrent les dossiers.
- Le template pitch reprend le format validé : remerciement Typeform + lien `prouesse.vc/cal/30min`.
- Nouveau statut `sante` / « Santé plus tard ».
- Nouveau bouton « Refuser santé » avec email poli : Lina ne finance pas encore les professions de santé, mais conserve le dossier pour réouverture future.
- Le bouton « Relancer » ouvre maintenant la messagerie avec l'email prêt à envoyer ; il n'envoie pas automatiquement l'email.
- Les dossiers déjà marqués santé seront déplacés vers « Santé plus tard » lors de la migration Supabase.

Commandes manuelles à lancer après le push sur `main` :

```powershell
cd C:\Users\PC\Documents\detectusv2
git pull
npx supabase db push
npx supabase functions deploy typeform-sync
npx supabase functions deploy typeform-webhook --no-verify-jwt
```

Après ces commandes :
- vérifier que Netlify a terminé son deploy ;
- ouvrir `https://detectus2.netlify.app` ;
- se connecter en admin ;
- vérifier que le bouton « Emails » apparaît ;
- vérifier qu'un dossier santé affiche « Santé plus tard » et le bouton « Refuser santé ».

### Checklist de déploiement

**A. Supabase — via le Dashboard (sans terminal)**
- [x] A1. Projet Supabase créé : ref `qobmctcloqekfascyrqs` (PC Windows, PowerShell)
- [ ] A2. URL du projet + anon key + mot de passe BDD notés en lieu sûr
- [x] A3. Schéma de base appliqué via `npx supabase db push` — succès confirmé par Adrien le 03/06/2026
- [ ] A4. Seed appliqué (SQL Editor → contenu de `supabase/seed.sql` → Run)
- [ ] A5. Les 3 comptes admin créés (Authentication → Users) : adrien@prouesse.vc, djamel@lina.finance, mahefa@prouesse.vc
- [ ] A6. ⚠️ Inscriptions publiques désactivées (Authentication → Sign In / Up → « Allow new users to sign up » : OFF)
- [x] A7. Secrets configurés via `npx supabase secrets set` — succès confirmé le 03/06/2026

**B. Edge Functions — via le terminal**
- [x] B1. Environnement PC Windows utilisé : PowerShell + `npx supabase`
- [x] B2. Code du repo cloné dans `C:\Users\PC\Documents\detectusv2`, branche `main`
- [x] B3. `npx supabase login` + `npx supabase link --project-ref qobmctcloqekfascyrqs` effectués
- [x] B3bis. Secrets Edge Functions relancés après token CLI Supabase
- [x] B4. Les 3 fonctions déployées : typeform-sync, typeform-webhook (--no-verify-jwt), fathom-webhook (--no-verify-jwt)
- [ ] B5. Après push Codex templates/santé : redéployer `typeform-sync` + `typeform-webhook` pour appliquer la nouvelle règle santé

**C. Webhooks externes — via le terminal**
- [x] C1. Webhook Typeform créé (curl PUT, form pUE5Jgae → typeform-webhook) — résolu après régénération du token Typeform avec les droits suffisants
- [x] C2. Webhook Fathom créé (curl POST → fathom-webhook) + secret reçu mis dans les secrets Supabase + fonction redéployée

**D. Front — via le Dashboard Netlify (sans terminal)**
- [x] D1. Site Netlify créé depuis le repo `adrien416/detectusv2`, branche `main`
- [x] D2. Variables d'environnement SUPABASE_URL + SUPABASE_ANON_KEY renseignées
- [x] D3. Site déployé et accessible : `https://detectus2.netlify.app`

**E. Vérifications finales (critères d'acceptation SPECS.md)**
- [ ] E1. Login obligatoire (navigation privée → rien sans connexion)
- [ ] E2. Premier import : nombre de dossiers = nombre de réponses du Dashboard Typeform
- [ ] E3. Soumission Typeform de test → apparaît en < 30 s sans recharger
- [ ] E4. Drag & drop visible chez un autre membre en < 2 s
- [ ] E5. Réunion Fathom de test → rattachée (1 match) ou dans « À rattacher »
- [ ] E6. Après push Codex templates/santé : bouton admin « Emails » visible pour Adrien
- [ ] E7. Après push Codex templates/santé : dossiers santé dans « Santé plus tard » + email dédié ouvrable dans la messagerie

**F. Après quelques jours de v2 stable**
- [ ] F1. Couper la page GitHub Pages v1 (`djamel-lab/detectus`) — action Djamel
- [ ] F2. Supprimer le Worker Cloudflare `typeform-proxy.djamel-753.workers.dev` — action Djamel

### Incident de déploiement du 03/06/2026

Adrien a tenté de lancer `npx supabase secrets set ...` depuis PowerShell avec les variables locales déjà renseignées (`TYPEFORM_TOKEN`, `ANTHROPIC_KEY`, `TYPEFORM_SECRET`). La commande a échoué avec :

```text
Access token not provided. Supply an access token by running `supabase login`
or setting the SUPABASE_ACCESS_TOKEN environment variable.
```

Cause probable : le login Supabase CLI n'est plus disponible pour la commande `npx supabase secrets set`, même si `login` avait fonctionné auparavant.

Reprise recommandée :
1. Relancer `npx supabase login` dans PowerShell.
2. Si l'erreur persiste, créer un token personnel Supabase dans le Dashboard Supabase, puis le mettre dans PowerShell avec `$env:SUPABASE_ACCESS_TOKEN="..."`.
3. Relancer uniquement la commande `npx supabase secrets set ...`, puis continuer avec le déploiement des 3 fonctions.

Résolu : un token personnel Supabase a permis de reprendre. Les secrets ont été posés et les 3 fonctions ont été déployées.

### Incident Typeform du 03/06/2026

Adrien a tenté de créer le webhook Typeform avec le token fourni, via :

```powershell
Invoke-RestMethod -Method Put -Uri "https://api.typeform.com/forms/pUE5Jgae/webhooks/detectus-v2" ...
```

Erreur reçue :

```text
INSUFFICIENT_PERMISSIONS — not enough permissions to complete the action
```

Cause probable : le token Typeform n'a pas le scope `webhooks:write` ou son propriétaire n'a pas les droits suffisants sur le formulaire `pUE5Jgae`.

Reprise recommandée :
1. Régénérer un token Typeform depuis le compte propriétaire/admin du formulaire `pUE5Jgae`, avec au minimum les droits réponses + webhooks.
2. Mettre à jour `$TYPEFORM_TOKEN` dans PowerShell.
3. Mettre à jour le secret Supabase `TYPEFORM_TOKEN`.
4. Relancer uniquement la commande de création du webhook Typeform.

---

## 11. Branche `claude/revue-securite-ux` (04/06/2026) — revue + ajustements

Branche **hors prod**, créée depuis `main`. Elle regroupe deux blocs distincts. **Un seul déploiement** (un push Netlify pour le front + les commandes Supabase pour la base et les fonctions) pour ne pas consommer de crédits inutilement.

### Bloc A — Revue sécurité / UX → **à revoir par Codex**

- **Sécurité — messages d'erreur** : plus aucun détail technique brut (Postgres/Supabase/API) n'est affiché à l'utilisateur ni renvoyé dans les réponses HTTP des webhooks. Helper `toastErreur()` côté front (détail en `console.error` uniquement) ; côté Edge Functions, réponses génériques `{erreur:"code", message:"…"}` + `console.error` (visible dans les logs Supabase).
- **UX — états explicites de la liste** : « Chargement des dossiers… », « Aucun dossier pour l'instant → cliquez sur Synchroniser », « Aucun dossier ne correspond à ce filtre ». Évite l'écran vide qui ressemble à un bug.
- **UX — identité du compte connecté** : visible au survol du bouton Déconnexion (outil partagé entre 3 personnes).

> Reste de la revue (constats, non bloquants, **pas** codés ici) : le temps réel diffuse les champs confidentiels à tous les comptes connectés — sans objet en v2 (3 admins), **à traiter en v2.1** avant toute invitation ; messages d'erreur des webhooks à surveiller dans les logs ; vérifs « terrain » Fathom/Typeform au premier test réel.

### Bloc B — Ajustements produit → **déjà décidés, PAS à revoir par Codex**

- **Classification santé par IA** : à l'import (Edge Functions `typeform-sync` et `typeform-webhook`), un appel Claude Haiku (modèle épinglé) complète la détection par mots-clés et envoie les professions de santé manquées vers le statut **« Santé plus tard »**. Conservateur (n'ajoute jamais qu'au segment santé, ne retire rien) ; non bloquant en cas d'erreur (on garde le résultat mots-clés) ; plafonné à 80 appels par synchronisation (sécurité temps/coût — les syncs courantes ne ramènent que quelques dossiers). Nouveau fichier `supabase/functions/_shared/sante.ts`.
- **Site lina.capital** ajouté à la fin des 6 templates emails : dans les valeurs par défaut du front (`index.html`) **et** en base via la migration `005_lina_capital_url.sql` (idempotente, préserve les modifications admin).

### Déploiement de cette branche (après validation, un seul passage)

1. **Front (Netlify)** : merge de la branche dans `main` → un seul build Netlify (index.html).
2. **Base (Supabase)** : `npx supabase db push` → applique la migration `005` (URL templates).
3. **Fonctions (Supabase)** : redéployer les 3 fonctions (santé IA + messages d'erreur) :
   `npx supabase functions deploy typeform-sync` · `typeform-webhook --no-verify-jwt` · `fathom-webhook --no-verify-jwt`.

> Les étapes 2 et 3 (Supabase) ne consomment **aucun** crédit Netlify.

### Ajout 04/06/2026 — Journal d'activité (admin)

Bouton **« Journal »** dans la topbar (admin only, comme « Emails »). Vue globale de qui a fait quoi et quand, alimentée par la table `deal_events` existante (aucune migration nécessaire) : statut, note, confidentiel, email, réunion, import — avec auteur + horodatage. Filtre par membre (+ « Système » pour les imports/webhooks), clic sur une ligne → ouvre le dossier concerné. Lecture seule. *(Front uniquement → couvert par le build Netlify, pas de déploiement Supabase requis pour cette partie.)*

### Correctifs 04/06/2026 — branche `claude/fix-classif-sante`

1. **Fiabilité (suite revue Codex)** — la classification santé par IA ne bloque plus l'enregistrement : les dossiers Typeform sont **insérés d'abord**, l'IA tourne **en arrière-plan** (`enArrierePlan` via `EdgeRuntime.waitUntil`) et repasse en « Santé plus tard » après coup. Appel IA borné par un **délai d'abandon de 7 s, sans retry** (`sante.ts`). Concerne `typeform-sync` et `typeform-webhook`.
2. **UI / lisibilité (mode sombre)** — les boîtes « accent » navy (Action recommandée, en-tête email, badge structure) gardaient un fond clair en thème sombre → texte blanc illisible. Fond sombre forcé en thème sombre (même correctif que le bloc Confidentiel).

### Lot 04/06/2026 (soir) — finitions UI + LinkedIn gratuit + régularisation santé

- **UI** : libellé colonne « Santé ⏳ » (1 ligne) + en-têtes de Board compacts (ex-PR #6).
- **#1 FullEnrich → LinkedIn gratuit** : `fullenrich-webhook` enregistre aussi le profil
  LinkedIn renvoyé par FullEnrich (même crédit), sans écraser un profil déjà validé.
- **#3 Parsing durci** : extraction téléphone + LinkedIn défensive (plusieurs formats de
  réponse FullEnrich gérés). Le brut reste dans `fullenrich_requests.resultats` (audit /
  ajustement au 1ᵉʳ vrai run).
- **#2 Régularisation santé** : migration `007_sante_historique.sql` bascule les dossiers
  santé historiques (scorés avant D15) en « Santé plus tard », hors `accepte`/`sante`.

**Déploiement** : 1 build Netlify (front) + `npx supabase db push` (migration 007) +
`npx supabase functions deploy fullenrich-webhook`.

---

## État actuel (04/06/2026) — TOUT EN PRODUCTION ✅

Detectus v2 et ses extensions sont **en production** (Netlify + Supabase EU, projet `qobmctcloqekfascyrqs`).

### Fonctionnalités live
- **Auth** (login obligatoire, 3 admins, inscriptions désactivées) · **CRM partagé** (statuts, Board Kanban, notes, champs confidentiels, timeline) · **Realtime** entre membres · **responsive mobile/tablette**.
- **Typeform** : import exhaustif (`typeform-sync`) + temps réel (`typeform-webhook`), `payload_brut` conservé (D14).
- **Fathom** : `fathom-webhook` → matching strict + 3 scores Claude Haiku, transcript jamais stocké (D6).
- **Journal d'activité** admin (qui a fait quoi/quand) · **Templates emails** éditables (admin) + URL `lina.capital`.
- **Santé** (D15) : statut **« Santé ⏳ »**, classification par IA à l'import (hors chemin critique), email dédié, régularisation de l'historique (migration 007).
- **Téléphones** : affichés (Typeform) + **FullEnrich** (`fullenrich-credits` / `-phone` / `-webhook`) — admin-only, pas d'écrasement, idempotent, crédits dans le webhook, **capture aussi le LinkedIn** au passage.
- **Recherche LinkedIn** (`linkedin-search`) : multi-sources best-effort (DuckDuckGo/Bing), admin-only, gratuit. Clé `SERPER_API_KEY` **optionnelle** pour fiabiliser (non utilisée — scraping gratuit retenu).

### Edge Functions déployées
`typeform-sync` · `typeform-webhook` · `fathom-webhook` · `fullenrich-credits` · `fullenrich-phone` · `fullenrich-webhook` · `linkedin-search`

### Migrations
`001` → `008`. ⚠️ Historique de migration désynchronisé sur la prod : appliquer avec **`npx supabase db push --include-all`** (003/004 non enregistrées → **rejouées à chaque push**). ⚠️ **Bascule santé en masse RETIRÉE de `004`/`007` le 05/06/2026** (revue Codex) : ces migrations ne modifient plus aucun statut (la `004` ne fait plus que (ré)installer le modèle d'email ; la `007` est un no-op). Plus aucune migration rejouable ne peut écraser le tri manuel. La classification santé est faite à l'import (`reponseVersDeal`) + IA en arrière-plan (garde `nouveau`). **Toujours pull `main` avant un `db push`.**

### Décisions ajoutées après la v2 initiale
- **D15** — Professions de santé conservées mais non financées (« Santé ⏳ »).
- **D16/D17** (FullEnrich) — tranchées *de fait* par la mise en prod : enrichissement téléphone via société/domaine **ou** LinkedIn (pas de reverse-email pur) ; envoi de données porteurs à FullEnrich (sous-traitant tiers) → **à acter formellement côté conformité (DPA + registre RGPD)**, comme D11/Anthropic.
- **Serper abandonné** : recherche LinkedIn gratuite par scraping retenue (pas de service tiers payant).

### Répartition des rôles
Codex et Claude codent indifféremment selon les sessions ; **chaque PR est relue par l'autre** avant/après mise en prod (XSS, RLS, idempotence, non-écrasement, chemin critique). Plusieurs allers-retours déjà appliqués (classif santé hors chemin critique, garde anti-écrasement, anti-bot LinkedIn).

### Points ouverts / à surveiller
- **1ᵉʳ vrai run FullEnrich** : vérifier le format de réponse (le brut est dans `fullenrich_requests.resultats`) ; ajuster le parsing tel/LinkedIn si besoin.
- **Webhook Typeform temps réel** : à confirmer en place (token Djamel avec scope webhooks) ; sinon le bouton « Synchroniser » couvre.
- **RGPD FullEnrich** (D17) à formaliser.
- **v2.1** (toujours en backlog) : page admin/invitations + backfill Fathom. **Champs confidentiels** : l'*écriture* est désormais admin-only (migration `008` + gardes front, livré par Codex) ; la *lecture* par un non-admin reste possible (SELECT + Realtime non filtrés par colonne) → **à fermer avant tout compte non-admin**.

### Mobile (04/06/2026)
Le front est désormais **responsive** (mobile/tablette) : viewport adaptatif, topbar compacte (boutons en icônes, KPIs masqués, onglets sur une ligne), vue **liste OU détail** plein écran avec bouton **« ← Tous les dossiers »**, board en défilement horizontal, modales plein écran. Le desktop est inchangé (overrides bornés à `@media ≤768px`).

### Ménage repo (04/06/2026) — ⚠️ à finir par Adrien
Le doc AMF (`docs/grille-scoring-lina-capital.docx`) est **préservé sur `main`**. Les branches de travail mergées/obsolètes **n'ont PAS pu être supprimées** depuis l'environnement d'assistance (proxy git : 403 sur les suppressions). **À supprimer par Adrien** (toutes mergées dans `main`, aucun risque) :
- via GitHub → `…/branches` → icône 🗑️, ou
- `git push origin --delete claude/docs-grille-amf claude/fix-board-sante-label claude/fix-classif-sante claude/fix-race-sante claude/handoff-fullenrich claude/linkedin-search-amelioration claude/lot-final-amf claude/menage-handoff claude/relaxed-carson-GkaSS claude/revue-securite-ux`

---

## Ajout 04/06/2026 soir - reprise Codex avant nouveau push

### Deja fait et verifie
- **Mobile prod** : commit `470cfdc` pousse sur `main`, Netlify verifie. Le HTML prod contient `mobile-detail-open`, le board mobile horizontal et le message login ameliore.
- **Compte Djamel** : `djamel@lina.finance` existait en `admin`, mais n'etait pas confirme cote Supabase Auth. Correction appliquee en prod : `email_confirme=true`, `confirme=true`, `role=admin`.
- **Login** : le front distingue maintenant mieux les erreurs de connexion : mauvais identifiants/compte absent, email non confirme, limite de tentatives, erreur temporaire.

### Lot demande ensuite par Adrien : "passer toutes les modifs indiquees"
Applique dans le tour suivant :
- **FullEnrich UX** : remplacement du `confirm()` natif par une vraie modale Detectus, avec cout maximum, dossiers ignores et rappel que le retour est asynchrone par webhook.
- **LinkedIn search** : requetes plus tolerantes (`fr.linkedin.com`, contexte sans guillemets) et scoring renforce pour accents/noms composes. Fonction `linkedin-search` redeployee.
- **Champs confidentiels** : garde front admin-only + migration `008_confidential_admin_guard.sql` appliquee en prod. Un non-admin ne peut plus modifier les champs de due diligence meme en appelant Supabase directement.
- **Deploiement Supabase effectue** : `npx supabase db push --include-all --yes` puis `npx supabase functions deploy linkedin-search`.
- Reste a faire dans ce tour : push front/HANDOFF sur `main`, puis verification Netlify. ✅ Fait.

---

## Ajout 05/06/2026 — session Claude (header, Journal, incident santé)

### En prod (mergé sur `main`, build Netlify)
- **Header surchargé corrigé** (PR #15) : pastilles KPI en libellés courts (Nouveau · Info · Pitch · Attente · Santé · Accepté · Refusé), plus de retour à la ligne, la bande de pastilles défile au lieu de couper les boutons (Synchroniser/Emails/Journal/Credits).
- **Journal d'activité** (PR #16) : le filtre « membre » liste maintenant **toute l'équipe** (depuis `PROFILS`) + tout auteur du journal, trié par nom — un membre sans action enregistrée apparaît quand même. (Avant : seuls les auteurs présents dans les 400 derniers events → en pratique Adrien seul.)

### Incident santé — dossiers « Refusé / Attente Pitch / Info demandée » aspirés en « Santé ⏳ »
- **Symptôme** : des dossiers triés à la main avaient disparu de leurs colonnes pour atterrir en « Santé ⏳ ». Dernier *event de statut* = le choix humain, mais statut réel = `sante`, **sans trace** de l'opération.
- **Cause réelle** : la migration de données **`004`** (`set statut='sante' where sante and statut<>'sante'`) n'est **pas enregistrée comme appliquée** → rejouée à chaque `npx supabase db push --include-all` (lancé la veille par Codex). Elle re-balaie **tous** les dossiers santé, y compris ceux déplacés à la main, et **ne logue aucun event** (d'où l'absence de trace). `007` avait le même défaut. (Ce n'était PAS la classification IA : son garde anti-écrasement PR #5 était déjà en place.)
- **Restauration** : SQL ponctuel dans le **SQL Editor** (pas une migration) — chaque dossier `sante` remis dans sa colonne d'origine d'après son dernier *event de statut humain* (`type='statut'`, `auteur_id` non nul, cible `→ Refusé/Attente Pitch/Info demandée`), avec un event `correction_sante_glitch`. **Fait par Adrien le 05/06/2026.**
- **Correctif de fond (2 itérations de revue Codex)** : d'abord garde `statut='nouveau'`, puis garde « aucun event de statut humain ». Codex a justement noté que ce dernier repose sur les `deal_events` écrits en best-effort côté client (insert non attendu `index.html:1604-1615`, appel non bloquant `changerStatut` `index.html:1627-1636`) → un dossier déplacé puis remis en « Nouveau » dont l'event a été perdu (fermeture page / réseau / RLS) serait reclassé à tort. **Résolution finale : la bascule en masse est SUPPRIMÉE** de `004` (ne garde que le modèle d'email) et `007` (no-op). Plus d'opération destructive rejouable → le problème disparaît à la racine. La classification santé reste faite à l'import (atomique) et par l'IA en arrière-plan (garde `nouveau`, ne touche jamais un dossier déplacé à la main). ⚠️ **Effet au prochain `db push` depuis un `main` à jour.**

### Revue du travail de Codex (commit `8c50275`) — RAS
- **Migration `008`** (garde écriture confidentiel admin-only) : correcte, idempotente, `security definer` + `search_path` fixé, autorise service_role (`auth.uid()` null) et admins. Comble un vrai trou (le grant UPDATE colonne était ouvert à tous les connectés).
- **Front** : modale FullEnrich (coût/ignorés/asynchrone), gardes `blocConfidentiel`/`sauvegarderConfidentiel` admin-only, ordre `chargerProfils` avant `chargerDeals`. OK.
- **`linkedin-search`** : matching noms composés/accentués + variantes de requêtes. OK.
- **Recoupement `chargerDeals`** : le correctif chargement (payload_brut) est passé après celui de Codex et garde sa séparation admin/non-admin sur le confidentiel tout en retirant `payload_brut` pour les admins (cause de la lenteur Djamel). Cohérent, rien à refaire.

### Reste à faire
- **Supprimer les branches mortes** (toujours pas fait — proxy git 403 côté assistant) : liste plus haut + `claude/fix-chargement`, `claude/fix-header`, `claude/journal-equipe`, `claude/handoff-maj`.
- **1ᵉʳ vrai run FullEnrich** : confirmer le format de réponse.
- **Fermer la lecture des champs confidentiels** avant tout compte non-admin (v2.1).
---

## Ajout 05/06/2026 - polish topbar responsive

Contexte : la barre haute etait trop chargee et pouvait etre coupee sur PC/Mac, surtout autour de 1280-1880 px, avec un rendu mobile encore trop serre.

Applique dans `index.html` :
- Topbar transformee en grille responsive : marque, onglets, KPIs et actions ont chacun une zone dediee.
- KPIs passes sur une deuxieme ligne sous 1880 px, au lieu de forcer tous les compteurs sur une seule ligne.
- Actions compactees sur petits ecrans : icones seules sous 1180 px, credit FullEnrich plus court en mobile.
- Onglet mobile `A rattacher` raccourci visuellement en `Ratt.` pour eviter la coupe.
- Largeur mobile verrouillee : pas de scroll horizontal de page.

Tests locaux :
- Captures topbar 1440 px et 1280 px : plus de coupe a droite, actions visibles.
- Test navigateur mobile force en 390 px et 360 px : `docWidth == innerWidth`, onglets visibles, pas de debordement horizontal.
- Changement front uniquement : aucune migration Supabase et aucun redeploiement Edge Function requis.

---

## Ajout 05/06/2026 - formulaire maison Lina Capital

Objectif : garder le Typeform de Djamel en parallele, sans le modifier, et ajouter un formulaire public controle par Lina Capital.

Ajouts prevus/appliques :
- Page publique `formulaire.html` : UX une question a la fois, style Lina Capital, telephone obligatoire, consentement RGPD obligatoire.
- Upload optionnel dans le formulaire : fichier PDF/PowerPoint/Word/image, 15 Mo max, ou lien Drive/Notion/deck.
- Edge Function publique `formulaire-maison-submit` (`verify_jwt=false`) : validation serveur, honeypot, delai minimum, upload prive Supabase Storage, insertion via service_role.
- Edge Function admin `formulaire-maison-document` (`verify_jwt=true`) : ouvre les documents uploades via lien temporaire, sans rendre le bucket public.
- Migration `009_formulaire_maison.sql` : `submission_source_id`, `ethique_financement`, consentement RGPD et horodatage + bucket prive `formulaire-maison-documents`.
- Netlify copie maintenant aussi `formulaire.html` et expose `/formulaire`.
- Detectus : bouton admin `Formulaire`, filtre `Source`, libelle source dans la fiche dossier, bouton `Ouvrir document` dans la fiche Projet.

Mapping :
- `source='formulaire_maison'`
- `societe` = "societe ou nom du projet"
- `telephone` obligatoire, `telephone_source='formulaire_maison'`
- `linkedin_url` + `linkedin_source='formulaire_maison'` si fourni
- `montant_demande` si fourni
- `document_url` = lien saisi ou chemin prive `storage://formulaire-maison-documents/...` si upload
- preference finance ethique/islamique stockee dans `ethique_financement` et `payload_brut`
- `payload_brut` conserve toute la soumission + texte de consentement

Attention deploiement :
- Appliquer `npx supabase db push --include-all --yes`
- Deployer `npx supabase functions deploy formulaire-maison-submit --no-verify-jwt`
- Deployer `npx supabase functions deploy formulaire-maison-document`
- Pousser le front Netlify seulement apres migration 009, sinon `index.html` selectionnera une colonne encore absente.

## Ajout 05/06/2026 (suite) — revue du lot Codex + 8 corrections

Revue du lot « formulaire maison » de Codex (verdict : bon, propre, mais anti-spam faible et pas de branchements). 8 corrections appliquees :

1. **Anti-spam robuste, sans cle externe** : le `started_at` (falsifiable cote client) est remplace par un **jeton serveur a usage unique**, emis a l'ouverture (`GET formulaire-maison-submit`) et consomme une seule fois a la soumission. Horodatage cote serveur → anti-remplissage-trop-rapide non falsifiable, anti-rejeu et anti-double-clic.
2. **Limite de debit par IP** (IP hashee, RGPD) : max 20 ouvertures et 8 envois / IP / heure. Nouvelle table `formulaire_soumissions` (migration `010_formulaire_anti_spam.sql`, RLS active sans policy = service_role uniquement).
3. **Branchements conditionnels** dans le formulaire (`data-visible-si`) : 1re application = question « anciennete » affichee seulement si l'entreprise est deja creee. (Editeur de questions no-code pour l'equipe = chantier separe, non inclus ici.)
4. **Upload privilegie (et non le lien)** — choix d'Adrien : un fichier sur nos serveurs vaut mieux qu'un lien qui perime et reste analysable par l'IA. Mise en oeuvre : **upload DIRECT vers Storage** via URL signee (le fichier ne transite plus par la fonction → plus de limite de corps), plafond **50 Mo**, l'upload est l'option **recommandee** et le lien devient un secours. Page : supabase-js charge en CDN ; fonction : `GET ?action=upload` emet l'URL signee (gate par jeton), le submit accepte `document_storage_path` (prefixe verrouille sur le jeton).
5. **Dedup telephone** : comparaison sur les **variantes FR** du numero (+33 / 0033 / 06…) au lieu d'une egalite stricte.
6. **Scoring** calcule sur la **description brute** du porteur (et non le bloc concatene) → moins de faux positifs « sante » et bonus « description detaillee » plus juste.
7. **Notification equipe** : toast distinct dans Detectus quand un dossier arrive via le formulaire maison (Realtime).
8. **CA precis conserve** : le libelle exact du CA + l'anciennete sont ajoutes a la description lisible et a `payload_brut` (la colonne `ca_tranche` reste +50K/<50K pour le Board).

Deploiement de ces corrections :
- `npx supabase db push --include-all --yes` (migration `010`)
- `npx supabase functions deploy formulaire-maison-submit --no-verify-jwt`
- Repousser le front Netlify (`formulaire.html`, `index.html`)
- Aucun secret ni cle externe a configurer.

## Ajout 09/06/2026 — revue complete (securite + UX/UI) + corrections

> ⚠️ **Le deploiement est une tache PC** (CLI Supabase). Le week-end Adrien est sur iPhone → a faire depuis un ordinateur, jamais depuis le telephone.

Branche : `claude/revue-corrections`. Corrections appliquees :

**Evenement 19 juin (priorite absolue — ne doit pas tomber)**
- `config.toml` : `event-registration-submit` passe en `verify_jwt=false` (sinon le prochain deploiement le casse en 401).
- Inscription idempotente : insert AVANT l'email + index unique `(event_slug, lower(email))` (migration `017`) → plus de doublon ni d'inscription perdue.
- Email Brevo APRES l'enregistrement, avec timeout 8 s → une lenteur/erreur Brevo ne bloque plus l'inscription.
- Page : consentement/notice RGPD + lien, touche Entree ne vole plus la selection des choix, safe-area iPhone, balises OG (partage WhatsApp/LinkedIn).

**Formulaire candidature + securite**
- 🔴 Brevo : header `xkeysib-key` → `api-key` (tous les emails du formulaire maison echouaient en silence) + timeout.
- Lien « politique de confidentialite » repare (pointait sur le formulaire) → nouvelle page `confidentialite.html`.
- Reponse publique minimale (anti-enumeration email/telephone) ; liberation du jeton si echec d'upload/insert (candidature non perdue).
- `typeform-sync` reserve aux admins (import massif + appels IA).

**Deploiement de ces corrections (PC, dans l'ordre) :**
1. Merger `claude/revue-corrections` dans `main`, puis `git checkout main && git pull`.
2. `npx supabase login` puis `npx supabase link --project-ref qobmctcloqekfascyrqs`.
3. `npx supabase db push` (applique la migration `017`).
4. `npx supabase functions deploy event-registration-submit --no-verify-jwt`
5. `npx supabase functions deploy formulaire-maison-submit --no-verify-jwt`
6. `npx supabase functions deploy typeform-sync`
7. Front Netlify : republie automatiquement au merge sur `main`.

**Restant a traiter (issu de la revue, NON inclus — a decider) :**
- 🔴 Cloisonnement des champs confidentiels : un compte `membre` (non-admin) peut lire `notes_dd`/`valorisation`/`montant_*` via l'API (le masquage actuel est seulement visuel). A corriger (table/vue gardee par `est_admin()`) **avant d'inviter un non-admin** ; necessite une migration + un test.
- 🟠 Rate-limit par IP contournable (X-Forwarded-For) : volontairement NON modifie ici (un mauvais choix de hop bloquerait de vrais inscrits) → a traiter avec un vrai limiteur.
- CSP absente + polish UX/UI du CRM (contraste du score, accessibilite clavier, double rendu de la liste, Board qui ignore les filtres, charte DM Sans vs Afacad/Chivo).

## Ajout 16/06/2026 — revue complète Fable 5 appliquée (4 lots)

> ⚠️ Règle respectée : **rien du 19 juin n'a été modifié** (`paris-19juin.html` et
> `event-registration-submit` intacts — événement dans 3 jours). Décision Adrien :
> téléphone **obligatoire** conservé sur l'inscription événement.
> Décision appliquée (reco des revues) : marque unique **« Lina Capital »** dans
> tous les emails — réversible par une migration inverse si Djamel préfère autrement.

**Lot A — fiabilité invisible**
- Plafond PostgREST 1000 lignes neutralisé : `chargerDeals` (CRM), matching `fathom-webhook` et lecture `typeform-sync` paginés — plus de troncature silencieuse au-delà de 1000 dossiers.
- `fetchAvecRetry` : timeout 15 s PAR tentative (un blocage Anthropic/Typeform ne gèle plus une fonction).
- `fathom-webhook` : réponse rapide à Fathom — la réunion est stockée immédiatement, l'analyse Haiku (3 scores) tourne en arrière-plan et met à jour la ligne (Realtime) ; insertion idempotente (`upsert` sur `fathom_recording_id`) ; `share_url` validé http(s).
- `montantOptionnel` : « 10,000 » ne devient plus 10 € (séparateurs de milliers gérés).

**Lot B — quick wins UX**
- Board : respecte enfin recherche + filtres (comme la Liste).
- Marque « Lina Capital » partout (défauts front + **migration 018** pour les templates déjà en base) ; fin du « rempli le typeform ».
- Accents corrigés (CRM + formulaire public) ; onglets « Avis IA » / « Pipeline ».
- Fiche dossier : bloc email/relance remonté sous les boutons de statut.
- Formulaire : « Étape x sur y », succès sans jargon + mention email de confirmation, balises OG.
- Divers : noindex CRM/document, recherche type=search, toast aria-live, scrollIntoView j/k, retour confidentialité réparé.

**Lot C — sécurité**
- CSP sur le CRM uniquement (`/` et `/index.html`) — pages publiques volontairement non touchées.
- Anti-spam : l'IP est lue sur le DERNIER segment de x-forwarded-for (non falsifiable) — formulaire candidature uniquement, fonction événement non modifiée.
- `document.html` : plus d'auto-redirection vers un lien externe du porteur (anti-phishing, l'admin voit l'adresse et clique).
- `fullenrich-webhook` : comparaison du secret à temps constant + erreurs d'écriture loggées.
- Lien LinkedIn rendu via `urlHttp()` (anti `javascript:`).

**Lot D — hygiène des données**
- **Migration 019** : `deals.telephone_norm` (colonne générée chiffres-uniquement + index) → dédup téléphone fiable ; CHECK sur `deals.source` (NOT VALID) ; purge quotidienne pg_cron des jetons anti-spam périmés (> 7 jours, sans effet sur les formulaires en cours).
- Dédup email : jokers `_`/`%` échappés (plus de faux doublons), erreurs loggées.
- Classification santé IA sur la description BRUTE (cohérence Typeform/formulaire).
- Brevo (formulaire) : retry 3x + timeout par tentative, en arrière-plan.

**Déploiement (PC, dans l'ordre — jamais depuis l'iPhone) :**
1. `git checkout main && git pull`
2. `npx supabase db push` (migrations **018** et **019** — AVANT les fonctions : la dédup téléphone utilise la colonne de la 019)
3. `npx supabase functions deploy formulaire-maison-submit --no-verify-jwt`
4. `npx supabase functions deploy fathom-webhook --no-verify-jwt`
5. `npx supabase functions deploy typeform-sync`
6. `npx supabase functions deploy fullenrich-webhook --no-verify-jwt`
7. Front Netlify : republie automatiquement au merge sur `main`.
8. **Ne PAS redéployer `event-registration-submit`** avant le 19 juin (aucun changement dedans, on ne touche pas à ce qui marche).

**Restant (backlog priorisé)** : cloisonnement confidentiel (🔴 avant toute invitation non-admin), vue « Inscriptions événement » dans le CRM, éditeur de questions du formulaire, accessibilité structurelle (modales/clavier/landmarks), autosave Confidentiel, unification de la charte (DM Sans vs Afacad/Chivo), heartbeat webhooks, tests Deno sur `_shared/`, nettoyage Storage orphelin.

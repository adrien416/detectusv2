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
| Implémentation (4 lots) | ⏳ prête à démarrer |

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

**Ce repo contient actuellement** (aucun code v2 n'a été écrit) :

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

Ces éléments doivent être prêts **avant** de démarrer l'implémentation :

- [x] **Décision D11 tranchée** (envoi des réunions à l'API Anthropic) → **OUI**, confirmé par Adrien le 02/06/2026
- [ ] **Projet Supabase créé** (région EU) — et décider qui en est propriétaire (compte/orga, facturation)
- [ ] **Accès admin au formulaire Typeform `pUE5Jgae`** (pour configurer le webhook) — sinon on garde uniquement le polling
- [ ] **Clé API Fathom** (Settings → API Access du compte qui enregistre les calls) + vérifier que le plan Fathom inclut l'API publique et les webhooks
- [ ] **Clé API Anthropic** (pour la classification/extraction Haiku)
- [ ] **Compte Netlify** relié au repo GitHub `adrien416/detectusv2`
- [ ] **Capture des statuts v1** (revue Codex Q3) : export ou capture d'écran du board d'Adrien et/ou Djamel avant la bascule (les statuts localStorage ne seront pas migrés)
- [ ] Les 3 admins disponibles pour définir leur mot de passe (email d'invitation Dashboard)

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

## 9. Prochaine étape

Le plan est complet : revue Codex appliquée, toutes les décisions tranchées (D1 → D13).

La session d'implémentation peut démarrer sur cette même branche, en suivant les 4 lots du §7 (un commit par lot minimum). Les pré-requis humains du §5 (projet Supabase, clés API, compte Netlify) doivent être prêts au moment d'attaquer le lot concerné — le Lot 1 ne nécessite que le projet Supabase et le token Typeform.

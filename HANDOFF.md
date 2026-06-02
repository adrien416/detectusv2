# HANDOFF — Revue du plan Detectus v2 avant implémentation

> **Destinataire :** Codex (relecteur du plan) et l'équipe Lina Capital (Adrien, Djamel, Mahefa)
> **Objet :** valider le plan de la v2 avant d'écrire la moindre ligne de code applicatif
> **Date :** 02/06/2026

---

## 1. Contexte et état du repo

**Demande d'Adrien** : transformer detectus (outil de qualification deal-flow créé par Djamel) en vrai CRM pour Lina Capital — login obligatoire, suivi des dossiers, infos confidentielles, et récupération automatique des réunions Fathom — tout en gardant la base et l'esprit de l'app v1.

**Ce repo contient actuellement** (aucun code v2 n'a été écrit) :

| Commit | Contenu |
|---|---|
| 1 — `v1 : baseline detectus` | Le code v1 de Djamel copié tel quel (index.html, config.example.js, docs v1) |
| 2 — `v2 : plan et spécifications` | Les documents de plan v2 : SPECS.md, CLAUDE.md, VERSIONS.md, README.md, ce HANDOFF.md |

Le diff entre les deux commits montre exactement ce que le plan change par rapport à la v1.

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

## 3. Décisions prises (à challenger si besoin)

| # | Décision | Justification |
|---|---|---|
| D1 | **Backend Supabase** (Postgres + Auth + Realtime + Edge Functions) | Validé par Adrien. Permet login + données partagées + RLS + webhooks sans gérer de serveur. Gratuit à ce volume. |
| D2 | **Front vanilla JS conservé** (un seul index.html, pas de framework) | Esprit v1 de Djamel = interdit absolu de framework. supabase-js via CDN est la seule dépendance ajoutée. |
| D3 | **Prompts Claude Haiku repris à l'identique** de Lina_fathom_CRM | Logique métier (3 scores, classification prospect/interne) déjà validée par l'équipe en production. |
| D4 | **Les secrets passent tous côté serveur** (Edge Functions) | Corrige la faille v1 (clés API dans config.js côté client). |
| D5 | **Le scoring autoScore reste côté front** | Logique simple et dérivable, pas une donnée à protéger. Évite de dupliquer la logique en 2 langages. Porté aussi dans typeform-sync pour le calcul à l'import. |
| D6 | **Transcript Fathom non stocké** | Volumineux. Le résumé + action items + lien share_url suffisent. |
| D7 | **Réunion sans deal correspondant → liste « À rattacher »** (pas de création auto de dossier) | Évite de polluer le pipeline avec des réunions hors deal-flow. Rattachement manuel en 2 clics. |
| D8 | **Hébergement front : Netlify** | Repo privé compatible (GitHub Pages exigerait un plan payant ou un repo public). Déploiement auto sur push. |
| D9 | **Statuts localStorage v1 non migrés** (repart de zéro) | Les statuts v1 sont par navigateur, non fiables. Le volume de dossiers permet une reclassification rapide. |
| D10 | **Région Supabase EU** | RGPD — données financières et personnelles. |

---

## 4. Architecture proposée (résumé)

```
Front statique (Netlify) ── anon key + JWT ──▶ Supabase EU
                                               ├── Auth (invite-only, 3 admins)
                                               ├── Postgres + RLS (profiles, deals,
                                               │   deal_events, notes, meetings)
                                               ├── Realtime (sync live entre membres)
                                               └── Edge Functions :
                                                   ├── typeform-webhook  ◀── Typeform (temps réel)
                                                   ├── typeform-sync     ──▶ Typeform API
                                                   ├── fathom-webhook    ◀── Fathom (réunion traitée)
                                                   ├── fathom-backfill   ──▶ Fathom API
                                                   └── inviter-membre    (admin)
                                                   (+ Claude Haiku pour classification/extraction)
```

Détails complets : **SPECS.md** (schéma SQL, RLS, pipeline Fathom 6 étapes, critères d'acceptation).

---

## 5. Checklist des pré-requis humains avant la session de code

Ces éléments doivent être prêts **avant** de démarrer l'implémentation :

- [ ] **Projet Supabase créé** (région EU) — et décider qui en est propriétaire (compte/orga, facturation)
- [ ] **Accès admin au formulaire Typeform `pUE5Jgae`** (pour configurer le webhook) — sinon on garde uniquement le polling
- [ ] **Clé API Fathom** (Settings → API Access du compte qui enregistre les calls) + vérifier que le plan Fathom inclut l'API publique et les webhooks
- [ ] **Clé API Anthropic** (pour la classification/extraction Haiku)
- [ ] **Compte Netlify** relié au repo GitHub `adrien416/detectusv2`
- [ ] Les 3 admins disponibles pour définir leur mot de passe (email d'invitation)

---

## 6. Questions ouvertes pour la revue

**Décisions produit :**
1. La stratégie « réunion non rattachée → liste À rattacher » (D7) convient-elle, ou faut-il créer automatiquement un dossier pour tout prospect inconnu ?
2. Périmètre Fathom : seulement les réunions enregistrées par l'équipe (`my_recordings`) ou aussi celles partagées avec l'équipe (`my_shared_with_team_recordings`) ?
3. Repart-on de zéro pour les statuts (D9) ou faut-il migrer le localStorage d'un des membres ?
4. Les membres non-admin doivent-ils voir les champs confidentiels (montants, valorisation) ? Le plan actuel dit **oui** (équipe de confiance) — le cloisonnement par rôle est en backlog v6.

**Vérifications techniques à faire à l'implémentation :**
5. Confirmer sur la doc Fathom live (developers.fathom.ai) : noms exacts des champs du payload webhook (`calendar_invitees`, `is_external`, `default_summary`, `action_items`), nom du header de signature, événements disponibles. Le plan se base sur le code de Lina_fathom_CRM (qui fonctionne en production) — l'API a pu évoluer.
6. Confirmer l'algorithme de signature du webhook Typeform (header `Typeform-Signature`, HMAC-SHA256 base64).
7. Vérifier que le mapping des refs Typeform (CLAUDE.md §6) est toujours valide sur le form `pUE5Jgae`.
8. Choisir le modèle Haiku : `claude-haiku-4-5` (recommandé) vs le modèle utilisé dans Lina_fathom_CRM.

**Risque de scope :**
9. La v2 est volumineuse (auth + BDD + 5 Edge Functions + refonte persistance + UI Fathom). Le plan la découpe en **4 sous-lots** committés séparément (voir VERSIONS.md). Ce découpage convient-il, ou faut-il réduire le périmètre de la v2 (ex. reporter la page admin et fathom-backfill en v2.1) ?

---

## 7. Ordre d'implémentation proposé (session de code, après validation)

```
Sous-lot 1 — Socle (fondations)
  1. supabase/migrations/001_schema.sql (tables, enums, RLS, triggers)
  2. supabase/seed.sql (promotion des 3 admins)
  3. Setup projet Supabase + comptes admin + désactivation signups
  4. index.html : écran de login + gestion de session
  5. Edge Function typeform-sync + bouton Synchroniser branché dessus
  6. chargerDeals() depuis Postgres (remplace localStorage)
  ✓ Critère : l'équipe se connecte et voit les dossiers Typeform

Sous-lot 2 — CRM
  7. Changements de statut → update deals + deal_events (+ Kanban)
  8. Realtime (sync live entre membres)
  9. Bloc Confidentiel + notes + timeline dans le panneau détail
  10. Création manuelle de dossier
  ✓ Critère : le suivi des dossiers est partagé et tracé

Sous-lot 3 — Fathom
  11. Edge Function fathom-webhook (pipeline 6 étapes + Haiku)
  12. Edge Function fathom-backfill
  13. UI : réunions dans le panneau détail + vue « À rattacher »
  14. Enregistrement du webhook Fathom
  ✓ Critère : une réunion test se rattache automatiquement à un dossier

Sous-lot 4 — Admin et finitions
  15. Page admin (liste profils, inviter-membre, rôles)
  16. Webhook Typeform temps réel
  17. netlify.toml + déploiement + tests des critères d'acceptation SPECS.md
  ✓ Critère : tous les critères d'acceptation de SPECS.md cochés
```

---

## 8. Critères de « done » de la session de code

La v2 est terminée quand **tous les critères d'acceptation de SPECS.md** sont vérifiés, et en particulier :
- Aucune donnée accessible sans login (test en navigation privée)
- Les 3 admins peuvent se connecter et ont le rôle admin
- Un lead Typeform de test apparaît en temps réel
- Une réunion Fathom de test se rattache au bon dossier avec ses 3 scores
- Le drag & drop Kanban se propage entre deux navigateurs connectés
- Aucun secret dans le code front ni dans le repo

---

## 9. Comment répondre à cette revue

Merci de commenter directement :
- soit en ouvrant une **issue GitHub** sur ce repo,
- soit en ouvrant une **PR de commentaires** sur les documents,
- soit en répondant point par point aux questions du §6 dans un document de réponse.

Une fois les questions tranchées et le plan validé, la session d'implémentation démarre sur cette même branche en suivant l'ordre du §7.

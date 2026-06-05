-- =============================================================================
-- Detectus v2 — Régularisation des dossiers santé historiques
--
-- Les dossiers santé importés AVANT la décision D15 ont pu être scorés
-- « QUALIFIÉ » et rester dans des colonnes actives (Nouveau, Refusé…).
-- On les bascule en « Santé plus tard » (statut `sante`) avec le scoring santé,
-- en préservant les dossiers déjà acceptés ou déjà en `sante`.
-- Naturellement idempotent (le filtre exclut les dossiers déjà traités).
-- =============================================================================

with reclasses as (
  update public.deals
  set
    statut = 'sante',
    decision = 'REFUSÉ',
    score = 15,
    motif = 'Santé — segment conservé en base, non financé pour l''instant',
    points_forts = '["Dossier conservé pour réouverture future"]'::jsonb,
    points_faibles = '["Professions de santé non financées pour l''instant"]'::jsonb,
    action_reco = 'Refuser santé — garder le dossier en suivi'
  where sante is true
    and statut not in ('sante', 'accepte')
  returning id
)
insert into public.deal_events (deal_id, type, resume, payload, auteur_id)
select
  id,
  'champ',
  'Régularisation : dossier santé basculé en « Santé plus tard »',
  '{"source":"migration_007"}'::jsonb,
  null
from reclasses;

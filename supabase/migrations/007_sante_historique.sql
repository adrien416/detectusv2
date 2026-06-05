-- =============================================================================
-- Detectus v2 — Régularisation des dossiers santé historiques
--
-- Les dossiers santé importés AVANT la décision D15 ont pu être scorés
-- « QUALIFIÉ » et rester en colonne « Nouveau ».
-- On bascule en « Santé plus tard » (statut `sante`) UNIQUEMENT les dossiers
-- santé encore non triés (statut `nouveau`) : tout dossier déjà déplacé à la main
-- (refuse/info/pitch/attente/accepte) est préservé — on ne touche jamais au tri
-- de l'équipe (incident du 05/06/2026). Idempotent.
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
    and statut = 'nouveau'
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

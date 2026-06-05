-- =============================================================================
-- Detectus v2 — Régularisation des dossiers santé historiques
--
-- Les dossiers santé importés AVANT la décision D15 ont pu être scorés
-- « QUALIFIÉ » et rester en colonne « Nouveau ».
-- On bascule en « Santé plus tard » (statut `sante`) UNIQUEMENT les dossiers
-- santé JAMAIS triés par un humain (aucun event de statut humain) : tout dossier
-- déplacé à la main — même remis volontairement en « Nouveau » — est préservé.
-- On ne touche jamais au tri de l'équipe (incident du 05/06/2026, revue Codex). Idempotent.
-- =============================================================================

with reclasses as (
  update public.deals d
  set
    statut = 'sante',
    decision = 'REFUSÉ',
    score = 15,
    motif = 'Santé — segment conservé en base, non financé pour l''instant',
    points_forts = '["Dossier conservé pour réouverture future"]'::jsonb,
    points_faibles = '["Professions de santé non financées pour l''instant"]'::jsonb,
    action_reco = 'Refuser santé — garder le dossier en suivi'
  where d.sante is true
    and d.statut = 'nouveau'
    and not exists (
      select 1 from public.deal_events e
      where e.deal_id = d.id and e.type = 'statut' and e.auteur_id is not null
    )
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

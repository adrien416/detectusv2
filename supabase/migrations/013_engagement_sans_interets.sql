-- =============================================================================
-- Detectus v2 - Engagement sans financement portant intérêts
-- =============================================================================

alter table public.deals
  add column if not exists engagement_sans_interets text;

comment on column public.deals.engagement_sans_interets is
  'Réponse du porteur : prêt ou non à s engager à ne pas recourir à un financement portant intérêts si Lina Capital accompagne le projet.';

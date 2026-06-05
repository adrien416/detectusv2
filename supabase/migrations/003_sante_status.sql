-- =============================================================================
-- Detectus v2 — Statut séparé pour les professions de santé
-- =============================================================================

alter type public.deal_statut add value if not exists 'sante';

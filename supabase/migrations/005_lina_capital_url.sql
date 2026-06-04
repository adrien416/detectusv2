-- =============================================================================
-- Detectus v2 — Ajout du site lina.capital à la fin de tous les templates emails
-- Idempotent : n'ajoute l'URL que si elle n'est pas déjà présente (préserve les
-- éventuelles modifications faites par un admin dans l'app).
-- =============================================================================

update public.email_templates
set body = body || E'\n\nhttps://lina.capital',
    updated_at = now()
where body not like '%lina.capital%';

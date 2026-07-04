-- =============================================================================
-- Detectus v2 - Hygiène des données (revue Fable 5 du 16/06/2026)
--
-- 1. deals.telephone_norm : colonne générée (chiffres uniquement) pour que la
--    détection de doublons reconnaisse « +33 6 12 34 56 78 » = « 0612345678 ».
-- 2. Garde-fou sur deals.source (NOT VALID : n'impacte pas l'existant).
-- 3. Purge quotidienne des jetons anti-spam périmés (croissance non bornée).
--    La purge ne touche QUE des jetons non consommés vieux de 7 jours —
--    aucun effet sur les formulaires en cours (jetons valables 2 h).
-- =============================================================================

-- ── 1. Téléphone normalisé (dédup fiable) ────────────────────────────────────
alter table public.deals
  add column if not exists telephone_norm text
  generated always as (regexp_replace(coalesce(telephone, ''), '\D', '', 'g')) stored;

create index if not exists idx_deals_telephone_norm
  on public.deals(telephone_norm)
  where telephone_norm <> '';

-- ── 2. Garde-fou sur la source (nouvelles écritures uniquement) ──────────────
do $garde$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'deals_source_valide' and conrelid = 'public.deals'::regclass
  ) then
    alter table public.deals
      add constraint deals_source_valide
      check (source in ('typeform', 'formulaire_maison', 'manuel')) not valid;
  end if;
end
$garde$;

comment on column public.deals.source is
  'Origine du dossier : typeform, formulaire_maison ou manuel.';

-- ── 3. Purge quotidienne des jetons anti-spam périmés ────────────────────────
-- pg_cron est disponible sur Supabase ; si l'extension manque, la migration
-- continue sans planifier (notice), rien ne casse.
do $purge$
begin
  begin
    create extension if not exists pg_cron;
  exception when others then
    raise notice 'pg_cron indisponible, purge non planifiée : %', sqlerrm;
    return;
  end;

  -- Reprogrammation idempotente (rejouable sans doublonner les jobs)
  perform cron.unschedule(jobid)
    from cron.job
    where jobname in ('detectus-purge-jetons-formulaire', 'detectus-purge-jetons-evenement');

  perform cron.schedule(
    'detectus-purge-jetons-formulaire',
    '17 3 * * *',
    'delete from public.formulaire_soumissions where consomme_le is null and emis_le < now() - interval ''7 days'''
  );
  perform cron.schedule(
    'detectus-purge-jetons-evenement',
    '23 3 * * *',
    'delete from public.event_registration_tokens where consumed_at is null and created_at < now() - interval ''7 days'''
  );
exception when others then
  raise notice 'planification pg_cron impossible : %', sqlerrm;
end
$purge$;

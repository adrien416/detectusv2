-- =============================================================================
-- Detectus v2 - Grants prudents pour fonctions appelees par triggers
--
-- Les fonctions restent hors API publique, mais les roles qui declenchent les
-- triggers doivent pouvoir les executer sans risque de regression.
-- =============================================================================

grant execute on function public.set_modifie_le() to authenticated, service_role;

grant execute on function app_private.guard_deals_confidentiel_admin() to authenticated, service_role;
grant execute on function app_private.handle_new_user() to authenticated, service_role;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    grant usage on schema app_private to supabase_auth_admin;
    grant execute on function app_private.handle_new_user() to supabase_auth_admin;
  end if;
end $$;

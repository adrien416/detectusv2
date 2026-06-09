-- =============================================================================
-- Detectus v2 - Security Advisor hardening
--
-- Objectif :
-- - retirer les fonctions internes de l'API publique quand elles n'ont pas
--   vocation a etre appelees directement ;
-- - garder le RPC LinkedIn public cote API, mais le rendre non SECURITY DEFINER ;
-- - remplacer les policies UPDATE litteralement "true" par une verification
--   equivalent pour les utilisateurs connectes ;
-- - optimiser les appels auth.uid() dans les policies.
-- =============================================================================

create schema if not exists app_private;

revoke all on schema app_private from public;
grant usage on schema app_private to authenticated, service_role;

-- Helper admin hors schema public expose par l'API.
create or replace function app_private.est_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists(
    select 1
    from public.profiles
    where id = auth.uid()
      and role = 'admin'
  );
$$;

revoke all on function app_private.est_admin() from public, anon;
grant execute on function app_private.est_admin() to authenticated, service_role;

-- Trigger de creation de profil, deplace hors public.
create or replace function app_private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, nom_complet, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'nom_complet', split_part(new.email, '@', 1)),
    case
      when lower(new.email) in ('adrien@prouesse.vc', 'djamel@lina.finance', 'mahefa@prouesse.vc')
        then 'admin'::public.user_role
      else 'membre'::public.user_role
    end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

revoke all on function app_private.handle_new_user() from public, anon, authenticated;
grant execute on function app_private.handle_new_user() to service_role;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function app_private.handle_new_user();

-- Trigger de protection des champs confidentiels, deplace hors public.
create or replace function app_private.guard_deals_confidentiel_admin()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or app_private.est_admin() then
    return new;
  end if;

  if new.montant_demande is distinct from old.montant_demande
    or new.valorisation is distinct from old.valorisation
    or new.montant_investi is distinct from old.montant_investi
    or new.notes_dd is distinct from old.notes_dd
    or new.prochaine_etape is distinct from old.prochaine_etape
    or new.date_prochaine_etape is distinct from old.date_prochaine_etape
  then
    raise exception 'confidential_fields_admin_only';
  end if;

  return new;
end;
$$;

revoke all on function app_private.guard_deals_confidentiel_admin() from public, anon, authenticated;
grant execute on function app_private.guard_deals_confidentiel_admin() to service_role;

drop trigger if exists trg_guard_deals_confidentiel_admin on public.deals;
create trigger trg_guard_deals_confidentiel_admin
  before update on public.deals
  for each row execute function app_private.guard_deals_confidentiel_admin();

-- La fonction privee garde les droits eleves, le RPC public devient un wrapper simple.
create or replace function app_private.admin_update_deal_linkedin(
  p_deal_id uuid,
  p_linkedin_url text
)
returns public.deals
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url text;
  v_deal public.deals;
begin
  if not app_private.est_admin() then
    raise exception 'Acces reserve aux admins';
  end if;

  v_url := nullif(btrim(coalesce(p_linkedin_url, '')), '');

  if v_url is not null and v_url !~* '^https?://([a-z]{2,3}\.)?linkedin\.com/in/[^[:space:]]+' then
    raise exception 'URL LinkedIn invalide';
  end if;

  update public.deals
  set
    linkedin_url = v_url,
    linkedin_source = case when v_url is null then null else 'admin' end,
    linkedin_valide_le = case when v_url is null then null else now() end
  where id = p_deal_id
  returning * into v_deal;

  if v_deal.id is null then
    raise exception 'Dossier introuvable';
  end if;

  insert into public.deal_events (deal_id, type, resume, payload, auteur_id)
  values (
    p_deal_id,
    'champ',
    case when v_url is null then 'Profil LinkedIn retire' else 'Profil LinkedIn valide' end,
    jsonb_build_object('linkedin_url', v_url),
    auth.uid()
  );

  return v_deal;
end;
$$;

revoke all on function app_private.admin_update_deal_linkedin(uuid, text) from public, anon;
grant execute on function app_private.admin_update_deal_linkedin(uuid, text) to authenticated, service_role;

create or replace function public.admin_update_deal_linkedin(
  p_deal_id uuid,
  p_linkedin_url text
)
returns public.deals
language sql
security invoker
set search_path = public, app_private
as $$
  select app_private.admin_update_deal_linkedin(p_deal_id, p_linkedin_url);
$$;

revoke all on function public.admin_update_deal_linkedin(uuid, text) from public, anon;
grant execute on function public.admin_update_deal_linkedin(uuid, text) to authenticated;

-- Fonction de trigger : search_path fixe et pas d'appel direct via API.
alter function public.set_modifie_le() set search_path = public;
revoke all on function public.set_modifie_le() from public, anon, authenticated;

-- Anciennes fonctions publiques : conservees pour compatibilite historique,
-- mais plus appelees directement et non executables depuis l'API.
revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.guard_deals_confidentiel_admin() from public, anon, authenticated;
revoke all on function public.est_admin() from public, anon, authenticated;

-- Policies : meme logique fonctionnelle, mais plus de USING(true) sur UPDATE.
alter policy "profiles_update_admin"
  on public.profiles
  using ((select app_private.est_admin()))
  with check ((select app_private.est_admin()));

alter policy "deals_insert_authentifie"
  on public.deals
  with check (cree_par = (select auth.uid()));

alter policy "deals_update_authentifie"
  on public.deals
  using ((select auth.uid()) is not null)
  with check ((select auth.uid()) is not null);

alter policy "deals_delete_admin"
  on public.deals
  using ((select app_private.est_admin()));

alter policy "events_insert_authentifie"
  on public.deal_events
  with check (auteur_id = (select auth.uid()));

alter policy "notes_insert_authentifie"
  on public.notes
  with check (auteur_id = (select auth.uid()));

alter policy "notes_update_auteur_ou_admin"
  on public.notes
  using (auteur_id = (select auth.uid()) or (select app_private.est_admin()))
  with check (auteur_id = (select auth.uid()) or (select app_private.est_admin()));

alter policy "notes_delete_auteur_ou_admin"
  on public.notes
  using (auteur_id = (select auth.uid()) or (select app_private.est_admin()));

alter policy "meetings_update_authentifie"
  on public.meetings
  using ((select auth.uid()) is not null)
  with check ((select auth.uid()) is not null);

alter policy "email_templates_update_admin"
  on public.email_templates
  using ((select app_private.est_admin()))
  with check ((select app_private.est_admin()));

alter policy "fullenrich_requests_select_admin"
  on public.fullenrich_requests
  using ((select app_private.est_admin()));

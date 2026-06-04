-- =============================================================================
-- Detectus v2 - Telephones, LinkedIn assiste et suivi FullEnrich
-- =============================================================================

alter table public.deals
  add column if not exists telephone_source text,
  add column if not exists telephone_enrichi_le timestamptz,
  add column if not exists linkedin_url text,
  add column if not exists linkedin_source text,
  add column if not exists linkedin_valide_le timestamptz;

update public.deals
set telephone_source = 'typeform'
where telephone_source is null
  and telephone is not null
  and btrim(telephone) <> '';

create table if not exists public.fullenrich_requests (
  id             uuid primary key default gen_random_uuid(),
  deal_id        uuid not null references public.deals(id) on delete cascade,
  enrichment_id  text,
  statut         text not null default 'prepare',
  mode           text not null default 'phone',
  entree         jsonb not null default '{}'::jsonb,
  resultats      jsonb,
  cout_credits   numeric(12,2),
  credits_avant  numeric(12,2),
  credits_apres  numeric(12,2),
  demande_par    uuid references public.profiles(id),
  cree_le        timestamptz not null default now(),
  modifie_le     timestamptz not null default now()
);

create index if not exists idx_fullenrich_requests_deal
  on public.fullenrich_requests(deal_id, cree_le desc);

create index if not exists idx_fullenrich_requests_enrichment
  on public.fullenrich_requests(enrichment_id);

drop trigger if exists trg_fullenrich_requests_modifie_le on public.fullenrich_requests;
create trigger trg_fullenrich_requests_modifie_le
  before update on public.fullenrich_requests
  for each row execute function public.set_modifie_le();

alter table public.fullenrich_requests enable row level security;

drop policy if exists "fullenrich_requests_select_admin" on public.fullenrich_requests;
create policy "fullenrich_requests_select_admin"
  on public.fullenrich_requests for select
  to authenticated
  using (public.est_admin());

grant select on public.fullenrich_requests to authenticated;

comment on table public.fullenrich_requests is 'Audit des demandes FullEnrich : dossier, cout, credits et resultat brut.';
comment on column public.deals.telephone_source is 'Origine du telephone affiche : typeform ou fullenrich.';
comment on column public.deals.linkedin_url is 'Profil LinkedIn valide manuellement avant enrichissement.';

create or replace function public.admin_update_deal_linkedin(
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
  if not public.est_admin() then
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

grant execute on function public.admin_update_deal_linkedin(uuid, text) to authenticated;

do $$
begin
  alter publication supabase_realtime add table public.fullenrich_requests;
exception
  when duplicate_object then null;
end $$;

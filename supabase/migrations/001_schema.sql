-- =============================================================================
-- Detectus v2 — Lina Capital
-- Migration 001 : schéma complet (enums, tables, triggers, RLS, Realtime)
--
-- Tables : profiles, deals, deal_events, notes, meetings
-- Règle d'or : le front n'utilise que l'anon key + JWT (RLS), les Edge Functions
-- utilisent la service_role key (bypass RLS, jamais exposée côté client).
-- =============================================================================

-- ── Enums ────────────────────────────────────────────────────────────────────

create type public.deal_statut as enum
  ('nouveau', 'info', 'pitch', 'attente', 'accepte', 'refuse');

create type public.user_role as enum ('admin', 'membre');

-- ── profiles : utilisateurs (1-1 avec auth.users) ────────────────────────────

create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text unique not null,
  nom_complet text,
  role        public.user_role not null default 'membre',
  cree_le     timestamptz not null default now()
);

comment on table public.profiles is 'Profils utilisateurs — créés automatiquement par trigger à l''inscription';

-- ── deals : les dossiers (table centrale) ────────────────────────────────────

create table public.deals (
  id                   uuid primary key default gen_random_uuid(),

  -- Champs Typeform (mapping v1 conservé, form pUE5Jgae)
  typeform_id          text unique,              -- token de réponse = clé de déduplication
  prenom               text not null default 'Inconnu',
  nom                  text not null default '—',
  email                text,                     -- clé de matching Fathom
  telephone            text,
  activite             text default 'Non précisée',
  entreprise_creee     boolean default false,
  ca_tranche           text,                     -- '+ 50K' / '< 50K'
  description          text,
  document_url         text,
  date_soumission      timestamptz,
  payload_brut         jsonb,                    -- réponse Typeform complète et brute (D14 : la donnée du porteur ne dépend jamais du mapping)

  -- Scoring (autoScore v1, recalculé à l'import)
  score                int default 0,
  decision             text,                     -- 'QUALIFIÉ' | 'À ÉTUDIER' | 'REFUSÉ'
  motif                text,
  points_forts         jsonb default '[]'::jsonb,
  points_faibles       jsonb default '[]'::jsonb,
  action_reco          text,
  sante                boolean default false,

  -- CRM v2
  statut               public.deal_statut not null default 'nouveau',
  societe              text,
  proprietaire_id      uuid references public.profiles(id),
  source               text not null default 'typeform',  -- 'typeform' | 'manuel'

  -- Confidentiel v2 (due diligence)
  montant_demande      numeric(14,2),
  valorisation         numeric(14,2),
  montant_investi      numeric(14,2),
  notes_dd             text,
  prochaine_etape      text,
  date_prochaine_etape date,

  -- Méta
  cree_le              timestamptz not null default now(),
  modifie_le           timestamptz not null default now(),
  cree_par             uuid references public.profiles(id)
);

create index idx_deals_statut    on public.deals(statut);
create index idx_deals_email     on public.deals(lower(email));
create index idx_deals_typeform  on public.deals(typeform_id);
create index idx_deals_date_soum on public.deals(date_soumission desc);

comment on table public.deals is 'Dossiers du deal-flow — importés de Typeform ou créés manuellement';
comment on column public.deals.payload_brut is 'Réponse Typeform brute complète — sanctuarisation de la donnée porteur (décision D14)';

-- ── deal_events : timeline d'activité (append-only) ──────────────────────────

create table public.deal_events (
  id        uuid primary key default gen_random_uuid(),
  deal_id   uuid not null references public.deals(id) on delete cascade,
  type      text not null,   -- 'statut' | 'note' | 'reunion' | 'email' | 'import' | 'champ'
  resume    text not null,   -- ex : « Statut : nouveau → pitch »
  payload   jsonb,
  auteur_id uuid references public.profiles(id),  -- null = action système (webhook)
  cree_le   timestamptz not null default now()
);

create index idx_events_deal on public.deal_events(deal_id, cree_le desc);

comment on table public.deal_events is 'Timeline append-only — aucune modification ni suppression possible';

-- ── notes : notes internes éditables ─────────────────────────────────────────

create table public.notes (
  id         uuid primary key default gen_random_uuid(),
  deal_id    uuid not null references public.deals(id) on delete cascade,
  contenu    text not null,
  auteur_id  uuid references public.profiles(id),
  cree_le    timestamptz not null default now(),
  modifie_le timestamptz not null default now()
);

create index idx_notes_deal on public.notes(deal_id, cree_le desc);

-- ── meetings : réunions Fathom ────────────────────────────────────────────────

create table public.meetings (
  id                    uuid primary key default gen_random_uuid(),
  fathom_recording_id   text unique not null,   -- clé de déduplication
  deal_id               uuid references public.deals(id) on delete set null,  -- null = non rattachée
  titre                 text,
  share_url             text,
  debut                 timestamptz,
  fin                   timestamptz,
  duree_minutes         int,
  enregistre_par        text,                   -- email du membre Lina qui a enregistré
  invitees              jsonb default '[]'::jsonb,  -- calendar_invitees complet
  resume                text,                   -- summary Fathom (markdown)
  action_items          jsonb default '[]'::jsonb,

  -- Extraction Claude Haiku (3 scores, logique reprise de Lina_fathom_CRM)
  score_interet_lina    jsonb,   -- {note: 1-5, explication: "..."}
  score_interet_porteur jsonb,
  score_conformite      jsonb,
  score_global          numeric(3,1),
  structure_recommandee text,
  alertes_charia        text,
  prochaine_etape       text,
  date_prochaine_etape  date,

  -- Matching (règle revue Codex : jamais de rattachement automatique ambigu)
  matched_email         text,
  statut_match          text not null default 'non_rattache',
                        -- 'auto' (1 seul match) | 'manuel' | 'non_rattache' (0 match) | 'ambigu' (plusieurs matchs) | 'ignore'
  matchs_candidats      jsonb default '[]'::jsonb,  -- si ambigu : [{deal_id, email, prenom, nom}]

  payload_brut          jsonb,   -- payload webhook complet SANS le transcript (rejouabilité)
  recu_le               timestamptz not null default now()
);

create index idx_meetings_deal      on public.meetings(deal_id);
create index idx_meetings_unmatched on public.meetings(statut_match) where deal_id is null;

comment on column public.meetings.payload_brut is 'Payload webhook Fathom SANS le transcript — le transcript n''est jamais stocké (décision D6)';

-- =============================================================================
-- Triggers
-- =============================================================================

-- ── set_modifie_le : horodatage automatique des updates ──────────────────────

create or replace function public.set_modifie_le()
returns trigger
language plpgsql
as $$
begin
  new.modifie_le = now();
  return new;
end;
$$;

create trigger trg_deals_modifie_le
  before update on public.deals
  for each row execute function public.set_modifie_le();

create trigger trg_notes_modifie_le
  before update on public.notes
  for each row execute function public.set_modifie_le();

-- ── handle_new_user : création du profil à l'inscription ─────────────────────
-- Les 3 admins par défaut reçoivent le rôle admin directement.

create or replace function public.handle_new_user()
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

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- =============================================================================
-- Row Level Security
-- =============================================================================

-- ── Helper : est_admin() ─────────────────────────────────────────────────────
-- SECURITY DEFINER pour éviter toute récursion RLS sur profiles.

create or replace function public.est_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists(
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

-- ── Activation RLS sur toutes les tables ─────────────────────────────────────

alter table public.profiles    enable row level security;
alter table public.deals       enable row level security;
alter table public.deal_events enable row level security;
alter table public.notes       enable row level security;
alter table public.meetings    enable row level security;

-- ── profiles : lecture pour tous les connectés, modification admin ───────────

create policy "profiles_select_authentifie"
  on public.profiles for select
  to authenticated
  using (true);

create policy "profiles_update_admin"
  on public.profiles for update
  to authenticated
  using (public.est_admin());

-- ── deals : lecture/écriture pour tous les connectés, suppression admin ──────

create policy "deals_select_authentifie"
  on public.deals for select
  to authenticated
  using (true);

create policy "deals_insert_authentifie"
  on public.deals for insert
  to authenticated
  with check (cree_par = auth.uid());

create policy "deals_update_authentifie"
  on public.deals for update
  to authenticated
  using (true);

-- Les membres modifient les champs CRM, pas la donnee Typeform ni le scoring.
revoke update on public.deals from anon, authenticated;
grant update (
  statut,
  societe,
  montant_demande,
  valorisation,
  montant_investi,
  notes_dd,
  prochaine_etape,
  date_prochaine_etape
) on public.deals to authenticated;

create policy "deals_delete_admin"
  on public.deals for delete
  to authenticated
  using (public.est_admin());

-- ── deal_events : append-only (lecture + insertion, jamais de modif) ─────────

create policy "events_select_authentifie"
  on public.deal_events for select
  to authenticated
  using (true);

create policy "events_insert_authentifie"
  on public.deal_events for insert
  to authenticated
  with check (auteur_id = auth.uid());

-- Pas de policy UPDATE/DELETE → opérations impossibles pour authenticated.

-- ── notes : chacun édite/supprime les siennes, l'admin peut tout ─────────────

create policy "notes_select_authentifie"
  on public.notes for select
  to authenticated
  using (true);

create policy "notes_insert_authentifie"
  on public.notes for insert
  to authenticated
  with check (auteur_id = auth.uid());

create policy "notes_update_auteur_ou_admin"
  on public.notes for update
  to authenticated
  using (auteur_id = auth.uid() or public.est_admin());

create policy "notes_delete_auteur_ou_admin"
  on public.notes for delete
  to authenticated
  using (auteur_id = auth.uid() or public.est_admin());

-- ── meetings : lecture + rattachement pour les connectés ─────────────────────
-- Pas de policy INSERT → seules les Edge Functions (service_role) insèrent.

create policy "meetings_select_authentifie"
  on public.meetings for select
  to authenticated
  using (true);

create policy "meetings_update_authentifie"
  on public.meetings for update
  to authenticated
  using (true);

-- Les membres peuvent seulement rattacher/ignorer une reunion.
-- Le resume, les scores, le payload et les invites restent ecrits par les Edge Functions.
revoke update on public.meetings from anon, authenticated;
grant update (deal_id, statut_match) on public.meetings to authenticated;

-- =============================================================================
-- Realtime
-- =============================================================================

-- Publication des changements vers les clients connectés (RLS respectée).
alter publication supabase_realtime add table public.deals;
alter publication supabase_realtime add table public.meetings;
alter publication supabase_realtime add table public.notes;
alter publication supabase_realtime add table public.deal_events;

-- Les UPDATE transmettent la ligne complète (nécessaire pour mettre à jour l'UI).
alter table public.deals    replica identity full;
alter table public.meetings replica identity full;
alter table public.notes    replica identity full;

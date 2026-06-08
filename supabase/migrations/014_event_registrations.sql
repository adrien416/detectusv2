-- =============================================================================
-- Detectus v2 - Inscriptions événement Paris 19 juin 2026
-- =============================================================================

create table if not exists public.event_registration_tokens (
  id uuid primary key default gen_random_uuid(),
  event_slug text not null default 'paris-19juin-2026',
  token text not null unique,
  ip_hash text,
  created_at timestamptz not null default now(),
  consumed_at timestamptz
);

create table if not exists public.event_registrations (
  id uuid primary key default gen_random_uuid(),
  event_slug text not null default 'paris-19juin-2026',
  created_at timestamptz not null default now(),
  prenom text not null,
  nom text not null,
  email text not null,
  telephone text not null,
  organisation text,
  fonction text,
  profil text not null,
  diner text not null,
  newsletter boolean not null default false,
  message text,
  source text not null default 'netlify_qr',
  ip_hash text,
  user_agent text,
  email_notification_ok boolean not null default false,
  email_notification_message text
);

create index if not exists event_registration_tokens_event_created_idx
  on public.event_registration_tokens(event_slug, created_at desc);

create index if not exists event_registrations_event_created_idx
  on public.event_registrations(event_slug, created_at desc);

create index if not exists event_registrations_email_idx
  on public.event_registrations(email);

alter table public.event_registration_tokens enable row level security;
alter table public.event_registrations enable row level security;

comment on table public.event_registrations is
  'Inscriptions publiques à la conférence Startups, diasporas et finance éthique du 19 juin 2026.';

comment on table public.event_registration_tokens is
  'Jetons anti-spam publics pour le formulaire événement Netlify.';

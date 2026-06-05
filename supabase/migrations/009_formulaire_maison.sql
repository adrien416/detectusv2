-- =============================================================================
-- Detectus v2 - Formulaire maison Lina Capital
-- =============================================================================

alter table public.deals
  add column if not exists submission_source_id text,
  add column if not exists ethique_financement text,
  add column if not exists consentement_rgpd boolean not null default false,
  add column if not exists consentement_rgpd_le timestamptz;

create unique index if not exists idx_deals_submission_source_id
  on public.deals(submission_source_id)
  where submission_source_id is not null;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'formulaire-maison-documents',
  'formulaire-maison-documents',
  false,
  15728640,
  array[
    'application/pdf',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'image/jpeg',
    'image/png',
    'image/webp'
  ]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

comment on column public.deals.submission_source_id is
  'Identifiant technique de soumission pour les formulaires non-Typeform, ex. formulaire_maison.';
comment on column public.deals.ethique_financement is
  'Preference exprimee sur la finance ethique/islamique et l absence d interets.';
comment on column public.deals.consentement_rgpd is
  'Consentement explicite donne par le porteur via un formulaire public.';
comment on column public.deals.consentement_rgpd_le is
  'Horodatage du consentement RGPD du formulaire public.';
comment on column public.deals.source is
  'Origine du dossier : typeform, formulaire_maison ou manuel.';

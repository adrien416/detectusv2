-- =============================================================================
-- Detectus v2 - Formulaire maison : anti-spam robuste (sans clé externe)
--
-- Jeton serveur a usage unique + limite par IP. Le jeton est emis a l'ouverture
-- du formulaire (horodatage cote serveur, donc non falsifiable par le client),
-- puis consomme une seule fois a la soumission. La meme table sert de base a la
-- limite de debit par IP (IP hashee, jamais stockee en clair — RGPD).
-- =============================================================================

create table if not exists public.formulaire_soumissions (
  id          uuid primary key default gen_random_uuid(),
  jeton       text not null unique,
  ip_hash     text,
  emis_le     timestamptz not null default now(),
  consomme_le timestamptz,
  deal_id     uuid references public.deals(id) on delete set null
);

-- Limite par IP : jetons emis sur la derniere heure
create index if not exists idx_formulaire_soumissions_ip_emis
  on public.formulaire_soumissions(ip_hash, emis_le desc);

-- Limite par IP : soumissions reellement consommees sur la derniere heure
create index if not exists idx_formulaire_soumissions_ip_consomme
  on public.formulaire_soumissions(ip_hash, consomme_le desc)
  where consomme_le is not null;

-- RLS active sans aucune policy : table technique accessible uniquement via
-- service_role (les Edge Functions). Le front (anon / authenticated) n'y touche jamais.
alter table public.formulaire_soumissions enable row level security;

comment on table public.formulaire_soumissions is
  'Jetons anti-spam du formulaire public : emis a l ouverture, consommes a usage unique a la soumission, base de la limite par IP (IP hashee).';

-- Favorise l'upload : plafond du bucket releve a 50 Mo (upload direct vers Storage,
-- hors limite de corps des Edge Functions). Le fichier reste prive et interne.
update storage.buckets
  set file_size_limit = 52428800
  where id = 'formulaire-maison-documents';

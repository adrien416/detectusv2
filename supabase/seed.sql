-- =============================================================================
-- Detectus v2 — Seed (idempotent)
-- Promotion admin des 3 comptes par défaut.
--
-- Pré-requis : les 3 comptes ont été créés via le Dashboard Supabase
-- (Authentication → Users → Add user). Le trigger handle_new_user() leur a
-- déjà créé une ligne profiles (avec le rôle admin si l'email est dans la
-- liste ci-dessous — ce seed est un filet de sécurité si la liste change).
-- =============================================================================

update public.profiles
set role = 'admin'
where lower(email) in (
  'adrien@prouesse.vc',
  'djamel@lina.finance',
  'mahefa@prouesse.vc'
);

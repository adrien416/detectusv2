-- =============================================================================
-- Detectus v2 - Inscriptions événement : anti-doublon (idempotence)
--
-- Empêche une même personne d'apparaître plusieurs fois (double-clic, deux
-- onglets, ré-inscription). On déduplique d'abord les éventuels doublons
-- existants (on garde la plus ancienne), PUIS on pose l'index unique — ainsi
-- la migration ne peut pas échouer sur des données déjà en place.
-- =============================================================================

delete from public.event_registrations a
  using public.event_registrations b
  where a.event_slug = b.event_slug
    and lower(a.email) = lower(b.email)
    and a.ctid > b.ctid;

create unique index if not exists event_registrations_unique_email_idx
  on public.event_registrations(event_slug, lower(email));

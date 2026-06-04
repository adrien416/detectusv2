-- Detectus v2 - garde serveur sur les champs confidentiels.
-- Objectif : un compte non-admin ne peut pas modifier les champs de due diligence,
-- meme si le front est contourne.

create or replace function public.guard_deals_confidentiel_admin()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or public.est_admin() then
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

drop trigger if exists trg_guard_deals_confidentiel_admin on public.deals;
create trigger trg_guard_deals_confidentiel_admin
  before update on public.deals
  for each row execute function public.guard_deals_confidentiel_admin();

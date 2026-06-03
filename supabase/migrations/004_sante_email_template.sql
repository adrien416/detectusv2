-- =============================================================================
-- Detectus v2 — Email "santé plus tard"
-- =============================================================================

update public.deals
set statut = 'sante'
where sante is true and statut <> 'sante';

insert into public.email_templates (statut, label, subject, body)
values (
  'sante',
  'Refus santé temporaire',
  'Lina Capital — Suite à votre demande de financement',
  'Bonjour {{prenom}},

Merci grandement d''avoir rempli le typeform pour votre demande de financement auprès de Lina Capital.

Nous avons bien étudié votre dossier {{societe}}.

À ce stade, nous ne finançons pas encore les professions de santé. Ce segment fait bien partie de notre feuille de route et nous souhaitons pouvoir revenir vers vous lorsque l''offre sera ouverte.

Nous conservons donc votre dossier dans notre base de suivi afin de pouvoir vous recontacter le moment venu.

Nous vous souhaitons sincèrement le meilleur pour votre recherche de financement.

Cordialement,
L''Équipe Lina Finance'
)
on conflict (statut) do update set
  label = excluded.label,
  subject = excluded.subject,
  body = excluded.body,
  updated_at = now();

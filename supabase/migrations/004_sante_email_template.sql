-- =============================================================================
-- Detectus v2 — Email "santé plus tard"
-- =============================================================================

-- Ne bascule QUE les dossiers santé JAMAIS triés par un humain.
-- ⚠️ Cette migration n'est pas enregistrée comme appliquée : elle est rejouée
-- à chaque `npx supabase db push --include-all`. Elle ne doit JAMAIS toucher un
-- dossier que l'équipe a déplacé à la main — y compris un dossier remis
-- volontairement en « Nouveau » (statut 'nouveau' ne suffit donc pas) : on exclut
-- tout dossier ayant un event de statut humain (incident du 05/06/2026, revue Codex).
update public.deals d
set statut = 'sante'
where d.sante is true
  and d.statut = 'nouveau'
  and not exists (
    select 1 from public.deal_events e
    where e.deal_id = d.id and e.type = 'statut' and e.auteur_id is not null
  );

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

-- =============================================================================
-- Detectus v2 — Templates emails modifiables par les admins
-- =============================================================================

create table public.email_templates (
  statut     public.deal_statut primary key,
  label      text not null,
  subject    text not null,
  body       text not null,
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);

alter table public.email_templates enable row level security;

create policy "email_templates_select_authentifie"
  on public.email_templates for select
  to authenticated
  using (true);

create policy "email_templates_update_admin"
  on public.email_templates for update
  to authenticated
  using (public.est_admin())
  with check (public.est_admin());

grant select on public.email_templates to authenticated;
grant update (label, subject, body, updated_by, updated_at) on public.email_templates to authenticated;

insert into public.email_templates (statut, label, subject, body) values
('info', 'Demande de documents', 'Lina Finance — Compléments nécessaires pour votre dossier',
'Bonjour {{prenom}},

Nous avons bien reçu votre dossier pour {{societe}} et vous remercions de l''intérêt que vous portez à Lina Finance.

Afin de compléter notre analyse, nous aurions besoin des documents suivants :
— Business plan ou prévisionnel financier
— Pitch deck ou présentation du projet

Nous revenons vers vous rapidement après réception.

Cordialement,
L''Équipe Lina Finance'),
('pitch', 'Invitation pitch', 'Lina Finance — Invitation à un appel de présentation',
'Bonjour {{prenom}},

Nous avons bien étudié votre dossier pour {{societe}} et souhaitons aller plus loin.

Nous vous proposons un appel de 30 minutes afin d''échanger sur votre projet et vous présenter nos conditions de financement halal.

Pouvez-vous nous indiquer vos disponibilités cette semaine ?

Cordialement,
L''Équipe Lina Finance'),
('attente', 'Mise en liste d''attente', 'Lina Finance — Votre dossier est en suivi',
'Bonjour {{prenom}},

Nous vous remercions pour la qualité de votre présentation concernant {{societe}}.

Votre dossier est intéressant et nous souhaitons le garder en suivi actif. Nous reviendrons vers vous dès qu''une opportunité de financement adaptée se présentera.

N''hésitez pas à nous tenir informés de l''évolution de votre projet.

Cordialement,
L''Équipe Lina Finance'),
('accepte', 'Confirmation d''acceptation', 'Lina Finance — Votre dossier est accepté',
'Bonjour {{prenom}},

Nous sommes heureux de vous informer que votre dossier pour {{societe}} a été retenu par notre comité.

Nous allons vous adresser sous 48h les documents relatifs aux conditions de financement. Un conseiller dédié prendra contact avec vous pour les prochaines étapes.

Félicitations et bienvenue chez Lina Finance.

Cordialement,
L''Équipe Lina Finance'),
('refuse', 'Notification de refus', 'Lina Finance — Suite à votre demande de financement',
'Bonjour {{prenom}},

Nous vous remercions pour l''intérêt que vous portez à Lina Finance et pour le temps consacré à votre demande concernant {{societe}}.

Après étude attentive de votre dossier, nous ne sommes malheureusement pas en mesure de donner une suite favorable, en raison de critères propres à notre politique de financement.

Nous vous souhaitons plein succès dans votre projet.

Cordialement,
L''Équipe Lina Finance');

alter publication supabase_realtime add table public.email_templates;

-- =============================================================================
-- Detectus v2 - Templates emails automatiques du formulaire maison
--
-- Les templates n'etaient limites qu'aux statuts du pipeline. On passe la cle en
-- texte pour ajouter des emails automatiques editables dans le meme onglet Emails.
-- =============================================================================

alter table public.email_templates
  alter column statut type text using statut::text;

insert into public.email_templates (statut, label, subject, body)
values
(
  'formulaire_porteur_recu',
  'Accusé réception formulaire',
  'Lina Capital - Votre demande a bien été reçue',
  'Bonjour {{prenom}},

Nous avons bien reçu votre demande de financement pour {{societe}}.

Notre équipe va étudier les informations transmises. Si le dossier entre dans notre périmètre, nous reviendrons vers vous avec les prochaines étapes.

Bien cordialement,
L''Équipe Lina Capital

https://lina.capital'
),
(
  'formulaire_equipe_nouveau',
  'Notification équipe formulaire',
  'Nouveau dossier Lina Capital - {{societe}}',
  'Nouveau dossier reçu via le formulaire maison.

Porteur : {{prenom}} {{nom}}
Email : {{email}}
Telephone : {{telephone}}
Projet : {{societe}}
Activité : {{activite}}
CA : {{ca}}
Score : {{score}}/100 - {{decision}}

Ouvrir Detectus :
{{lien_detectus}}'
)
on conflict (statut) do nothing;

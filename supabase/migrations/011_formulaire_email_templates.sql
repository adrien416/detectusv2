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
  'Accuse reception formulaire',
  'Lina Capital - Votre demande a bien ete recue',
  'Bonjour {{prenom}},

Nous avons bien recu votre demande de financement pour {{societe}}.

Notre equipe va etudier les informations transmises. Si le dossier entre dans notre perimetre, nous reviendrons vers vous avec les prochaines etapes.

Bien cordialement,
L''Equipe Lina Capital

https://lina.capital'
),
(
  'formulaire_equipe_nouveau',
  'Notification equipe formulaire',
  'Nouveau dossier Lina Capital - {{societe}}',
  'Nouveau dossier recu via le formulaire maison.

Porteur : {{prenom}} {{nom}}
Email : {{email}}
Telephone : {{telephone}}
Projet : {{societe}}
Activite : {{activite}}
CA : {{ca}}
Score : {{score}}/100 - {{decision}}

Ouvrir Detectus :
{{lien_detectus}}'
)
on conflict (statut) do nothing;

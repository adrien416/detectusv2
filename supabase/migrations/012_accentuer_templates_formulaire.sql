-- =============================================================================
-- Detectus v2 - Accents des templates automatiques du formulaire maison
-- =============================================================================

update public.email_templates
set
  label = 'Accusé réception formulaire',
  subject = 'Lina Capital - Votre demande a bien été reçue',
  body = 'Bonjour {{prenom}},

Nous avons bien reçu votre demande de financement pour {{societe}}.

Notre équipe va étudier les informations transmises. Si le dossier entre dans notre périmètre, nous reviendrons vers vous avec les prochaines étapes.

Bien cordialement,
L''Équipe Lina Capital

https://lina.capital',
  updated_at = now()
where statut = 'formulaire_porteur_recu';

update public.email_templates
set
  label = 'Notification équipe formulaire',
  subject = 'Nouveau dossier Lina Capital - {{societe}}',
  body = 'Nouveau dossier reçu via le formulaire maison.

Porteur : {{prenom}} {{nom}}
Email : {{email}}
Telephone : {{telephone}}
Projet : {{societe}}
Activité : {{activite}}
CA : {{ca}}
Score : {{score}}/100 - {{decision}}

Ouvrir Detectus :
{{lien_detectus}}',
  updated_at = now()
where statut = 'formulaire_equipe_nouveau';

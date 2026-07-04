-- =============================================================================
-- Detectus v2 - Marque unique « Lina Capital » dans les emails
--
-- Décision revue Fable 5 (16/06/2026) : les templates mélangeaient
-- « Lina Finance » (4 emails sur 8) et « Lina Capital » — le porteur recevait
-- deux marques selon le statut de son dossier. Le nom officiel (CLAUDE.md)
-- est Lina Capital ; « lina.finance » ne reste qu'un domaine email.
-- On retire aussi « rempli le typeform », faux pour les dossiers du
-- formulaire maison et jargon pour tous.
--
-- replace() ne touche que les chaînes exactes : les personnalisations
-- faites par l'équipe dans l'éditeur d'emails sont préservées.
-- =============================================================================

update public.email_templates set
  subject = replace(subject, 'Lina Finance', 'Lina Capital'),
  body = replace(
    replace(body, 'Lina Finance', 'Lina Capital'),
    'Merci grandement d''avoir rempli le typeform pour votre demande de financement auprès de Lina Capital.',
    'Merci grandement pour votre demande de financement auprès de Lina Capital.'
  );

-- =============================================================================
-- Detectus v2 — Email "santé plus tard"
-- =============================================================================

-- NB (05/06/2026, revue Codex) : la bascule en masse des dossiers santé vers
-- « Santé plus tard » a été RETIRÉE d'ici. Cette migration n'est pas enregistrée
-- comme appliquée → rejouée à chaque `db push --include-all`. Quel que soit le
-- garde, il s'appuyait sur les events `deal_events` écrits en best-effort côté
-- client (insert non attendu, erreurs avalées) : une bascule rejouée pouvait donc
-- réécraser le tri manuel de l'équipe (incident santé du 05/06/2026).
-- La classification santé se fait désormais UNIQUEMENT là où c'est atomique et sûr :
--   • à l'import — `reponseVersDeal` pose directement `statut='sante'` ;
--   • via l'IA en arrière-plan — garde `statut='nouveau'`, ne touche jamais un
--     dossier déplacé à la main.
-- Cette migration ne fait plus que (ré)installer le modèle d'email (idempotent).

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

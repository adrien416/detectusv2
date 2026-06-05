// Classification « profession de santé » par IA (Claude Haiku).
//
// Complète la détection par mots-clés de autoScore : appelée uniquement pour les
// dossiers que les mots-clés n'ont PAS déjà classés en santé, afin de rattraper
// les cas manqués (ex. « cabinet d'ostéopathie », « téléconsultation »…).
//
// Conservateur : ne sert qu'à AJOUTER des dossiers au segment santé, jamais à en
// retirer. En cas d'erreur, de doute, de délai dépassé ou d'absence de clé API →
// retourne null (on garde alors le résultat des mots-clés, sans rien changer).
//
// Robustesse (revue Codex) : un seul essai, AUCUN retry, et un délai d'abandon
// strict — cette classification est best-effort et ne doit jamais retarder
// l'enregistrement d'un dossier (elle tourne en arrière-plan, voir les Edge Functions).

// Modèle épinglé — cohérent avec fathom-webhook (jamais d'alias non versionné).
const MODELE_CLAUDE = "claude-haiku-4-5-20251001";

// Délai d'abandon de l'appel IA (best-effort, jamais bloquant).
const DELAI_ABANDON_MS = 7000;

const PROMPT_SANTE =
  `Tu es un classifieur pour Lina Capital, un fonds de financement participatif.
À partir de l'activité et de la description d'un porteur de projet, détermine si son
activité relève d'une PROFESSION DE SANTÉ ou du secteur médical / paramédical :
médecin, infirmier, kinésithérapeute, dentiste, pharmacie, clinique, cabinet médical,
ambulance, optique, vétérinaire, psychologue, sage-femme, ostéopathe, laboratoire
d'analyses, téléconsultation, dispositif médical, EHPAD, soins à domicile, etc.

Réponds UNIQUEMENT par un objet JSON, sans aucun texte autour :
{"sante": true} si c'est une profession/activité de santé, sinon {"sante": false}`;

export async function classifierSanteIA(
  activite: string,
  description: string,
  apiKey: string | undefined,
): Promise<boolean | null> {
  if (!apiKey) return null;
  try {
    const contenu = `Activité : ${activite || "(non précisée)"}\nDescription : ${description || "(vide)"}`;
    // Un seul appel, borné par un délai d'abandon : ne peut jamais hanger.
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODELE_CLAUDE,
        max_tokens: 20,
        system: PROMPT_SANTE,
        messages: [{ role: "user", content: contenu }],
      }),
      signal: AbortSignal.timeout(DELAI_ABANDON_MS),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const texte = data.content?.[0]?.text ?? "";
    const match = texte.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]);
    return parsed.sante === true;
  } catch (_e) {
    // Non bloquant : on conserve le résultat des mots-clés.
    return null;
  }
}

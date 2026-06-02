// fetch avec retry (3 essais, backoff exponentiel 2s/4s/8s) pour les API externes.
// Convention CLAUDE.md : toute API externe (Typeform, Fathom, Anthropic) passe par ici.

export async function fetchAvecRetry(
  url: string,
  options: RequestInit,
  essaisMax = 3,
): Promise<Response> {
  let derniereErreur: Error | null = null;

  for (let essai = 0; essai < essaisMax; essai++) {
    try {
      const res = await fetch(url, options);
      // Pas de retry sur les erreurs client (4xx) : elles ne se résoudront pas seules.
      if (res.ok || (res.status >= 400 && res.status < 500)) return res;
      derniereErreur = new Error(`HTTP ${res.status} sur ${url}`);
    } catch (e) {
      derniereErreur = e instanceof Error ? e : new Error(String(e));
    }
    // Backoff exponentiel : 2s, 4s (le 3e échec sort de la boucle)
    if (essai < essaisMax - 1) {
      await new Promise((r) => setTimeout(r, 2000 * Math.pow(2, essai)));
    }
  }

  throw derniereErreur ?? new Error(`Échec après ${essaisMax} essais sur ${url}`);
}

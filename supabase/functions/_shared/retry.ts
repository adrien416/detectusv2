// fetch avec retry (3 essais, backoff exponentiel 2s/4s/8s) pour les API externes.
// Convention CLAUDE.md : toute API externe (Typeform, Fathom, Anthropic) passe par ici.

// Exécute une tâche APRÈS avoir renvoyé la réponse HTTP, sans bloquer le client.
// Sur Supabase Edge Runtime, EdgeRuntime.waitUntil garde l'instance vivante le
// temps que la tâche se termine. Sinon, on la lance sans l'attendre (best-effort).
export function enArrierePlan(tache: Promise<unknown>): void {
  const securisee = tache.catch((e) => console.error("tâche arrière-plan:", e));
  // deno-lint-ignore no-explicit-any
  const edge = (globalThis as any).EdgeRuntime;
  if (edge && typeof edge.waitUntil === "function") {
    edge.waitUntil(securisee);
  }
  // Sinon : la promesse tourne en arrière-plan (déjà protégée par .catch).
}

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

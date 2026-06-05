import { fetchAvecRetry } from "./retry.ts";

export const FULLENRICH_API = "https://app.fullenrich.com/api/v2";
const FULLENRICH_API_V1 = "https://app.fullenrich.com/api/v1";

export async function appelerFullEnrich(
  chemin: string,
  apiKey: string,
  options: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(options.headers ?? {});
  headers.set("Authorization", `Bearer ${apiKey}`);
  if (!headers.has("Content-Type") && options.body) headers.set("Content-Type", "application/json");

  return fetchAvecRetry(`${FULLENRICH_API}${chemin}`, {
    ...options,
    headers,
  });
}

export async function lireCreditsFullEnrich(apiKey: string): Promise<number | null> {
  const res = await fetchAvecRetry(`${FULLENRICH_API_V1}/account/credits`, {
    method: "GET",
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) return null;
  const data = await res.json();
  return typeof data.balance === "number" ? data.balance : null;
}

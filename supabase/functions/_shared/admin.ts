import { createClient } from "npm:@supabase/supabase-js@2";
import { reponseJson } from "./cors.ts";

export interface AdminContext {
  user: { id: string; email?: string };
  profile: { id: string; email: string; nom_complet: string | null; role: string };
  sb: ReturnType<typeof createClient>;
}

export async function contexteAdmin(req: Request): Promise<AdminContext | Response> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");

  if (!supabaseUrl || !serviceRoleKey || !anonKey) {
    return reponseJson({ erreur: "Configuration serveur incomplete" }, 500);
  }

  const authorization = req.headers.get("Authorization") ?? "";
  const clientUtilisateur = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
  });
  const { data: { user }, error: erreurUser } = await clientUtilisateur.auth.getUser();

  if (erreurUser || !user) {
    return reponseJson({ erreur: "Utilisateur non authentifie" }, 401);
  }

  const sb = createClient(supabaseUrl, serviceRoleKey);
  const { data: profile, error: erreurProfil } = await sb
    .from("profiles")
    .select("id, email, nom_complet, role")
    .eq("id", user.id)
    .maybeSingle();

  if (erreurProfil) {
    return reponseJson({ erreur: `Lecture du profil impossible : ${erreurProfil.message}` }, 500);
  }
  if (!profile || profile.role !== "admin") {
    return reponseJson({ erreur: "Acces reserve aux admins" }, 403);
  }

  return { user: { id: user.id, email: user.email ?? undefined }, profile, sb };
}

import { createClient } from "@/lib/supabase/server";
import { apiError, createApiToken, json } from "@/lib/colosseum/api-auth";

// node runtime: createApiToken hashes with node:crypto.
export const runtime = "nodejs";

// Mint an API token for the logged-in user. Runs as the user's session (RLS
// insert policy applies); the plaintext token is returned exactly once and is
// not stored — only its hash is. The browser settings UI lists/revokes tokens
// directly under RLS, so only creation needs this server route.
export async function POST(req: Request) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return apiError("Unauthorized.", 401);
  }

  let name: string | null = null;
  try {
    const body = (await req.json()) as Record<string, unknown>;
    if (typeof body.name === "string" && body.name.trim()) {
      name = body.name.trim().slice(0, 100);
    }
  } catch {
    // No/invalid body is fine — name is optional.
  }

  try {
    const { token, row } = await createApiToken({ userId: user.id, name });
    return json({ token, ...row }, 201);
  } catch (e) {
    console.error(e);
    return apiError("Could not create token.", 500);
  }
}

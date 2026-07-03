import { getSessionUser } from "@/lib/auth";
import { apiError, createApiToken, json } from "@/lib/colosseum/api-auth";

// node runtime: createApiToken hashes with node:crypto.
export const runtime = "nodejs";

// Mint an API token for the logged-in user (resolved from their session
// cookie). The plaintext token is returned exactly once and is not stored —
// only its hash is.
export async function POST(req: Request) {
  const user = await getSessionUser();

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

import { NextResponse } from "next/server";

import { authenticateApiToken, apiError, authorizeAdmin, json } from "@/lib/colosseum/api-auth";
import { getAppSettings, redactSettings, updateAppSettings } from "@/lib/colosseum/admin";
import { logError, logInfo } from "@/lib/log";

export const runtime = "nodejs";

// GET /api/v1/admin/settings — instance-wide settings.
//
// The mail credentials come back redacted to `"__set__"` or `""`. The admin
// page reads the stored values so it can pre-fill its form behind a browser
// session; a bearer token is a longer-lived credential that can sit in an
// agent's context, so it gets to know whether a provider is configured and not
// what the key is.
export async function GET(req: Request) {
  const auth = await authenticateApiToken(req);
  if (auth instanceof NextResponse) return auth;

  const admin = await authorizeAdmin(auth.userId);
  if (admin instanceof NextResponse) return admin;

  try {
    return json({ settings: redactSettings(await getAppSettings()) });
  } catch (e) {
    logError("admin.settings.GET", "failed to read settings", e);
    return apiError("Failed to read settings.", 500);
  }
}

// PATCH /api/v1/admin/settings — the per-user caps.
//
// Body: `{ "max_invites_per_user": 5, "max_columns_per_user": null }`, where
// null means unlimited. Email configuration is deliberately not settable here:
// it would mean accepting secrets over the API and, with a `from` address and
// an SMTP host, repointing the instance's outbound mail.
export async function PATCH(req: Request) {
  const auth = await authenticateApiToken(req);
  if (auth instanceof NextResponse) return auth;

  const admin = await authorizeAdmin(auth.userId);
  if (admin instanceof NextResponse) return admin;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return apiError("Invalid JSON body.", 400);
  }

  const current = await getAppSettings();
  const limit = (key: string, fallback: number | null): number | null | undefined => {
    if (!(key in body)) return fallback;
    const value = body[key];
    if (value === null) return null;
    if (typeof value === "number" && Number.isInteger(value) && value >= 0) return value;
    return undefined;
  };

  const invites = limit("max_invites_per_user", current.max_invites_per_user);
  const columns = limit("max_columns_per_user", current.max_columns_per_user);
  if (invites === undefined || columns === undefined) {
    return apiError("Limits must be a non-negative integer, or null for unlimited.", 400);
  }

  try {
    // `email` omitted, so updateAppSettings preserves the stored block.
    await updateAppSettings({
      max_invites_per_user: invites,
      max_columns_per_user: columns,
    });
    logInfo("admin.settings.PATCH", `admin ${auth.userId} updated the instance limits`);
    return json({ settings: redactSettings(await getAppSettings()) });
  } catch (e) {
    logError("admin.settings.PATCH", "failed to update settings", e);
    return apiError("Failed to update settings.", 500);
  }
}

// Read-side check for the one-time token in a password reset link, so an
// expired or already-used link is caught when the page renders instead of after
// the user has chosen a new password.
//
// Better Auth has no endpoint that reports a token's validity without
// consuming it, so this reads the row it wrote: `POST /request-password-reset`
// stores `identifier = "reset-password:<token>"` in the verification table with
// an expiry, and `POST /reset-password` deletes it on use. A missing row means
// the link was never issued, was already spent, or has been cleaned up.
import "server-only";

import { desc, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { verification } from "@/lib/db/schema";

// "unknown" is not a third kind of token — it means the check itself couldn't
// run. Submitting still validates the token authoritatively, so the caller
// shows the form rather than turning a database hiccup into a dead end.
export type ResetTokenState = "valid" | "invalid" | "unknown";

export async function checkPasswordResetToken(token: string): Promise<ResetTokenState> {
  if (!token) {
    return "invalid";
  }
  try {
    const [row] = await db
      .select({ expiresAt: verification.expiresAt })
      .from(verification)
      .where(eq(verification.identifier, `reset-password:${token}`))
      .orderBy(desc(verification.createdAt))
      .limit(1);
    if (!row) {
      return "invalid";
    }
    return row.expiresAt > new Date() ? "valid" : "invalid";
  } catch (e) {
    console.error("Failed to check the password reset token:", e);
    return "unknown";
  }
}

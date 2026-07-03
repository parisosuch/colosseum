// Better Auth, running in-process against the app's own Postgres via Drizzle.
// Owns the user/session/account/verification tables in lib/db/schema.ts.
// Email/password only — no OAuth providers were configured under Supabase, so
// none are carried over.

import "server-only";

import { headers } from "next/headers";
import { cache } from "react";

import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";

import { db } from "@/lib/db";
import { account, session, user, verification } from "@/lib/db/schema";
import { signupsDisabled } from "@/lib/colosseum/config";
import { claimInviteCode, inviteRequired, recordInviteRedemption } from "@/lib/colosseum/invite";

export const auth = betterAuth({
  secret: process.env.AUTH_SECRET,
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: { user, session, account, verification },
  }),
  // "uuid" keeps ids compatible with the pre-existing uuid owner/creator
  // columns; Postgres generates them via the columns' defaultRandom().
  advanced: {
    database: { generateId: "uuid" },
  },
  emailAndPassword: {
    enabled: true,
    // ponytail: no mail provider is wired up, so the reset link is logged to
    // the server console — enough for a self-hoster to recover an account.
    // Swap in a real email sender here when SMTP exists.
    sendResetPassword: async ({ user, url }) => {
      console.log(`Password reset requested for ${user.email}: ${url}`);
    },
  },
  databaseHooks: {
    user: {
      create: {
        // Invite gate (formerly a Postgres trigger on auth.users): every
        // sign-up after the first must present a valid code, claimed
        // atomically so a code can never be redeemed past max_uses. This hook
        // runs after Better Auth's duplicate-email and password checks, so a
        // claimed use is only lost if the user insert itself fails.
        // ponytail: claim + user insert aren't one transaction; a crash in
        // between burns a use. Wrap both in db.transaction if that ever bites.
        before: async (_user, ctx) => {
          // Authoritative DISABLE_SIGNUPS block (the UI hides sign-up, this
          // stops direct API calls — sign-up runs through our server now).
          if (signupsDisabled()) {
            throw new APIError("FORBIDDEN", { message: "Sign-ups are closed." });
          }
          if (!(await inviteRequired())) return;
          const raw = (ctx?.body as { inviteCode?: unknown } | undefined)?.inviteCode;
          const code = typeof raw === "string" ? raw.trim() : "";
          if (!code) {
            throw new APIError("BAD_REQUEST", {
              message: "An invite code is required to create an account.",
            });
          }
          if (!(await claimInviteCode(code))) {
            throw new APIError("BAD_REQUEST", {
              message: "That invite code is invalid or has already been used.",
            });
          }
        },
        // Audit trail only — best effort, never fails the sign-up.
        after: async (newUser, ctx) => {
          const raw = (ctx?.body as { inviteCode?: unknown } | undefined)?.inviteCode;
          const code = typeof raw === "string" ? raw.trim() : "";
          if (!code) return;
          try {
            await recordInviteRedemption(code, newUser.id);
          } catch (e) {
            console.error("Failed to record invite redemption:", e);
          }
        },
      },
    },
  },
  plugins: [nextCookies()],
});

// The signed-in user from the request's session cookie, or null. Wrapped in
// React cache() so the nav bar and the page share one session lookup per
// request. Server components, actions, and route handlers all resolve the
// caller through this.
export const getSessionUser = cache(async () => {
  const result = await auth.api.getSession({ headers: await headers() });
  return result?.user ?? null;
});

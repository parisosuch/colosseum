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
import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { renderEmail, sendEmail } from "@/lib/email";
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
  // Surface the admin flags on the session user. `input: false` keeps them
  // server-owned — a client can't set them at sign-up. The per-user invite/
  // column limit overrides aren't declared here; they're read directly via the
  // admin data layer, not needed on every session.
  user: {
    additionalFields: {
      is_admin: { type: "boolean", input: false, defaultValue: false },
      banned: { type: "boolean", input: false, defaultValue: false },
    },
    changeEmail: {
      enabled: true,
      // An address nobody has proven they own is usually a sign-up typo, and
      // it's the one thing an account can't recover from — the reset link goes
      // to the wrong inbox forever. So while it's unverified it can be
      // corrected in place, which also keeps the escape hatch open on an
      // instance with no mail provider configured at all.
      updateEmailWithoutVerification: true,
      // Once the address is verified, the change is confirmed from the old
      // inbox first, so a stolen session can't quietly take the account with it.
      sendChangeEmailConfirmation: async ({ user, newEmail, url }) => {
        const { html, text } = renderEmail({
          heading: "Confirm your new email",
          body: `A request was made to change this account's email to ${newEmail}. Approve it below — the address only changes once you do.`,
          buttonLabel: "Approve the change",
          buttonUrl: url,
          footnote: "If you didn't request this, ignore this email and nothing will change.",
        });
        await sendEmail({
          to: user.email,
          subject: "Confirm your new Colosseum email",
          text,
          html,
        });
      },
    },
  },
  emailAndPassword: {
    enabled: true,
    // Delivered through whichever provider lib/email.ts finds configured
    // (Resend, SMTP, or console when neither is set up).
    sendResetPassword: async ({ user, url }) => {
      const { html, text } = renderEmail({
        heading: "Reset your password",
        body: "We received a request to reset your Colosseum password. Use the button below to choose a new one — the link expires shortly.",
        buttonLabel: "Reset password",
        buttonUrl: url,
        footnote: "If you didn't request this, you can safely ignore this email.",
      });
      await sendEmail({ to: user.email, subject: "Reset your Colosseum password", text, html });
    },
  },
  // Verification is offered, never required: `requireEmailVerification` would
  // gate sign-in on an email arriving, and a self-hosted instance may have no
  // mail provider set up yet (lib/email.ts logs to the server console then).
  // What it buys is proof of the address — the account's only recovery channel
  // — and, once proven, a safe email-change flow in settings.
  emailVerification: {
    sendOnSignUp: true,
    // Called with `user.email` already set to the address the link should go
    // to, including on an email change, so this always mails the right inbox.
    sendVerificationEmail: async ({ user, url }) => {
      const { html, text } = renderEmail({
        heading: "Confirm your email",
        body: "Confirm this address so it can be used to get back into your Colosseum account if you ever lose the password.",
        buttonLabel: "Confirm email",
        buttonUrl: url,
        footnote: "If you didn't create a Colosseum account, you can safely ignore this email.",
      });
      await sendEmail({ to: user.email, subject: "Confirm your Colosseum email", text, html });
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
        // Audit trail + first-user promotion — best effort, never fails sign-up.
        after: async (newUser, ctx) => {
          // The very first account (the self-hoster) becomes the instance admin.
          // ponytail: "exactly one user row" == first sign-up; safe for the
          // single-operator case a self-host implies.
          try {
            const rows = await db.select({ id: user.id }).from(user).limit(2);
            if (rows.length === 1) {
              await db.update(user).set({ is_admin: true }).where(eq(user.id, newUser.id));
            }
          } catch (e) {
            console.error("Failed to promote first user to admin:", e);
          }
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
  const sessionUser = result?.user ?? null;
  // ponytail: a banned user is treated as signed out — every gate already
  // rejects a null session. Their session row survives until it expires; add
  // explicit revocation if a hard, immediate kill is ever needed.
  if (sessionUser?.banned) return null;
  return sessionUser;
});

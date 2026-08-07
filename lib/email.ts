// Outbound email, one function for every caller (password resets, notifications).
// Configuration lives in the app_settings row (edited in the admin panel), so an
// operator can switch providers at runtime without a rebuild:
//   provider "resend" -> Resend HTTP API (just fetch, no SMTP client)
//   provider "smtp"   -> any SMTP server (custom or a provider's) via nodemailer
//   provider null     -> logged to the server console (mail not set up yet)
import "server-only";

import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { appSettings, type EmailSettings } from "@/lib/db/schema";
import { logInfo } from "@/lib/log";

export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
  html?: string;
};

// Public origin the instance is served from, used to build absolute asset URLs
// (email clients can't load inline SVG or relative paths). Matches the base
// Better Auth builds its links from.
function baseUrl(): string {
  return (process.env.BETTER_AUTH_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

// Every interpolated field is plain text, so it is escaped on the way into the
// HTML. Notification emails quote user-written comment bodies; without this a
// comment containing markup would render as markup in the recipient's inbox.
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Renders a transactional email in the Colosseum look: logo mark, serif heading,
// an optional CTA button, and a muted footnote — all inline-styled on a white
// card (the only layout email clients render reliably). Returns both the HTML
// and a plain-text fallback. `heading`/`body`/`footnote` are plain text.
export function renderEmail(t: {
  heading: string;
  body: string;
  buttonLabel?: string;
  buttonUrl?: string;
  footnote?: string;
}): { html: string; text: string } {
  const button =
    t.buttonLabel && t.buttonUrl
      ? `<tr><td style="padding:4px 0 24px;"><a href="${escapeHtml(t.buttonUrl)}" style="display:inline-block;background:#171717;color:#fafafa;text-decoration:none;font-size:15px;font-weight:600;padding:12px 22px;border-radius:8px;">${escapeHtml(t.buttonLabel)}</a></td></tr>`
      : "";
  const footnote = t.footnote
    ? `<tr><td style="padding-top:8px;color:#737373;font-size:13px;line-height:20px;">${escapeHtml(t.footnote)}</td></tr>`
    : "";
  const sans = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#fafafa;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fafafa;padding:32px 12px;font-family:${sans};">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border:1px solid #e5e5e5;border-radius:12px;padding:32px;color:#0a0a0a;">
        <tr><td style="padding-bottom:20px;"><img src="${baseUrl()}/icon-512.png" alt="Colosseum" width="40" height="40" style="display:block;border:0;" /></td></tr>
        <tr><td style="font-family:Georgia,'Times New Roman',serif;font-size:22px;font-weight:600;line-height:28px;padding-bottom:12px;">${escapeHtml(t.heading)}</td></tr>
        <tr><td style="font-size:15px;line-height:24px;padding-bottom:20px;">${escapeHtml(t.body).replace(/\n/g, "<br />")}</td></tr>
        ${button}${footnote}
      </table>
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;"><tr><td style="padding:16px 8px;color:#737373;font-size:12px;">Colosseum</td></tr></table>
    </td></tr>
  </table>
</body></html>`;
  const text = [
    t.heading,
    "",
    t.body,
    t.buttonUrl ? `\n${t.buttonLabel ?? "Open"}: ${t.buttonUrl}` : "",
    t.footnote ? `\n${t.footnote}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  return { html, text };
}

async function emailSettings(): Promise<EmailSettings | null> {
  const [row] = await db
    .select({ email: appSettings.email })
    .from(appSettings)
    .where(eq(appSettings.id, 1))
    .limit(1);
  return row?.email ?? null;
}

// From address for outbound mail. Providers reject unverified senders, so a real
// deploy must set this in the admin panel; the fallback only keeps dev valid.
function fromAddress(cfg: EmailSettings): string {
  return cfg.from?.trim() || "Colosseum <noreply@localhost>";
}

export async function sendEmail(msg: EmailMessage): Promise<void> {
  const cfg = await emailSettings();
  if (cfg?.provider === "resend" && cfg.resend_api_key) return sendViaResend(cfg, msg);
  if (cfg?.provider === "smtp" && cfg.smtp_host) return sendViaSmtp(cfg, msg);
  logInfo("email", `No mail provider configured; not sending "${msg.subject}" to ${msg.to}`, {
    text: msg.text,
  });
}

async function sendViaResend(cfg: EmailSettings, msg: EmailMessage): Promise<void> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.resend_api_key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: fromAddress(cfg),
      to: msg.to,
      subject: msg.subject,
      text: msg.text,
      html: msg.html,
    }),
  });
  if (!res.ok) {
    throw new Error(`Resend send failed (${res.status}): ${await res.text()}`);
  }
}

async function sendViaSmtp(cfg: EmailSettings, msg: EmailMessage): Promise<void> {
  // Imported lazily so nodemailer only loads when SMTP is actually configured.
  const nodemailer = (await import("nodemailer")).default;
  const port = cfg.smtp_port ?? 587;
  const transport = nodemailer.createTransport({
    host: cfg.smtp_host,
    port,
    // 465 is implicit TLS; 587/25 start plaintext and upgrade via STARTTLS.
    secure: port === 465,
    auth: cfg.smtp_user ? { user: cfg.smtp_user, pass: cfg.smtp_pass } : undefined,
  });
  await transport.sendMail({
    from: fromAddress(cfg),
    to: msg.to,
    subject: msg.subject,
    text: msg.text,
    html: msg.html,
  });
}

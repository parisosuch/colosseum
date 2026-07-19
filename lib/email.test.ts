import { afterEach, beforeAll, expect, mock, test } from "bun:test";

import { seed } from "@/scripts/seed";
import { getAppSettings, updateAppSettings } from "@/lib/colosseum/admin";
import { renderEmail, sendEmail } from "./email";

const BLANK = {
  provider: null,
  from: "",
  resend_api_key: "",
  smtp_host: "",
  smtp_port: null,
  smtp_user: "",
  smtp_pass: "",
} as const;

beforeAll(async () => {
  await seed();
});

afterEach(async () => {
  await updateAppSettings({ max_invites_per_user: null, max_columns_per_user: null, email: BLANK });
  mock.restore();
});

test("Resend provider posts to the API with the stored key and from", async () => {
  await updateAppSettings({
    max_invites_per_user: null,
    max_columns_per_user: null,
    email: { ...BLANK, provider: "resend", from: "C <no@reply>", resend_api_key: "re_test" },
  });
  const fetchMock = mock(async () => new Response("{}", { status: 200 }));
  globalThis.fetch = fetchMock as unknown as typeof fetch;

  await sendEmail({ to: "a@b.com", subject: "Hi", text: "body" });

  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe("https://api.resend.com/emails");
  expect((init.headers as Record<string, string>).Authorization).toBe("Bearer re_test");
  expect(JSON.parse(init.body as string)).toMatchObject({ from: "C <no@reply>", to: "a@b.com" });
});

test("getAppSettings returns the stored secret as-is", async () => {
  await updateAppSettings({
    max_invites_per_user: null,
    max_columns_per_user: null,
    email: { ...BLANK, provider: "resend", resend_api_key: "re_keep" },
  });
  const s = await getAppSettings();
  expect(s.email.resend_api_key).toBe("re_keep");
});

test("a limit-only update leaves the stored email config untouched", async () => {
  await updateAppSettings({
    max_invites_per_user: null,
    max_columns_per_user: null,
    email: { ...BLANK, provider: "resend", resend_api_key: "re_keep" },
  });
  await updateAppSettings({ max_invites_per_user: 5, max_columns_per_user: null });
  const s = await getAppSettings();
  expect(s.email.resend_api_key).toBe("re_keep");
  expect(s.max_invites_per_user).toBe(5);
});

test("Resend send throws on a non-ok response", async () => {
  await updateAppSettings({
    max_invites_per_user: null,
    max_columns_per_user: null,
    email: { ...BLANK, provider: "resend", resend_api_key: "re_test" },
  });
  globalThis.fetch = mock(
    async () => new Response("nope", { status: 422 }),
  ) as unknown as typeof fetch;

  await expect(sendEmail({ to: "a@b.com", subject: "Hi", text: "x" })).rejects.toThrow(/422/);
});

test("renderEmail embeds the heading, CTA link, and a text fallback", () => {
  const { html, text } = renderEmail({
    heading: "Reset your password",
    body: "b",
    buttonLabel: "Reset",
    buttonUrl: "https://x.test/y",
    footnote: "ignore if not you",
  });
  expect(html).toContain("Reset your password");
  expect(html).toContain('href="https://x.test/y"');
  expect(html).toContain("/icon-512.png");
  expect(text).toContain("https://x.test/y");
  expect(text).toContain("ignore if not you");
});

test("no provider configured neither sends nor throws", async () => {
  const fetchMock = mock(async () => new Response("{}", { status: 200 }));
  globalThis.fetch = fetchMock as unknown as typeof fetch;

  await sendEmail({ to: "a@b.com", subject: "Hi", text: "x" });

  expect(fetchMock).not.toHaveBeenCalled();
});

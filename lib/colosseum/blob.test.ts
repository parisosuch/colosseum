import { describe, expect, test } from "bun:test";

import { putFileBlobFromUrl, putImageBlobFromUrl } from "./blob";
import { BlockedUrlError } from "./guarded-fetch";

// The fetch is refused before any connection or DB write, so no user or seed
// is needed. Redirects into these addresses are covered in
// guarded-fetch.test.ts, against a local stand-in host.
describe("fetching a URL into blob storage refuses private addresses", () => {
  const cases = [
    ["http://127.0.0.1/a.png", "loopback"],
    ["http://10.0.0.1/a.png", "private"],
    ["http://169.254.169.254/latest/meta-data/", "link-local"],
    ["http://[::1]/a.png", "loopback"],
    ["http://localhost:5432/", "loopback"],
  ] as const;

  for (const [url, reason] of cases) {
    test(`image ${url}`, async () => {
      const err = await putImageBlobFromUrl(url, "nobody", "public").catch((e) => e);
      expect(err).toBeInstanceOf(BlockedUrlError);
      expect(err.message).toContain(`${reason} address`);
    });
  }

  test("pdf and video fetches go through the same guard", async () => {
    for (const kind of ["pdf", "video"] as const) {
      const err = await putFileBlobFromUrl(
        "http://169.254.169.254/x",
        kind,
        "nobody",
        "public",
      ).catch((e) => e);
      expect(err).toBeInstanceOf(BlockedUrlError);
    }
  });

  test("a non-http URL is still refused", async () => {
    await expect(putImageBlobFromUrl("file:///etc/passwd", "nobody", "public")).rejects.toThrow(
      "Unsupported image URL.",
    );
  });
});

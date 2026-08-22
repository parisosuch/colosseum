import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Linting is handled by oxlint (see .oxlintrc.json), not Next's ESLint
  // integration, so don't run ESLint during `next build`.
  eslint: {
    ignoreDuringBuilds: true,
  },
  // Keep the puppeteer-extra chain out of the webpack bundle. Next externalizes
  // `puppeteer` by default but not these; bundling them fails on clone-deep's
  // dynamic require(). They run server-side only, so leave them as node requires.
  serverExternalPackages: ["puppeteer-extra", "puppeteer-extra-plugin-stealth"],
  experimental: {
    // React Compiler auto-memoizes components, so the board and grid stop
    // re-rendering on state they don't read. It replaces reaching for memo() by
    // hand — components/column.tsx is wrapped that way today.
    reactCompiler: true,
    // Media uploads (image/PDF/video) go through server actions, which default
    // to a 1MB body cap. Keep this above the largest client-side cap — the 100MB
    // video limit (MAX_VIDEO_BYTES; images 10MB, PDFs 25MB) — with headroom for
    // multipart overhead. If it's below a client cap, files in the gap fail with
    // an opaque "Body exceeded N mb limit" *before* the action's own validation
    // runs, so the client-side size toast never gets to fire.
    // ponytail: server actions buffer the whole body in memory, so a 100MB cap
    // means ~100MB per concurrent upload — fine at self-host scale. Move to a
    // streaming upload route if that memory pressure ever bites.
    serverActions: {
      bodySizeLimit: "110mb",
    },
  },
};

export default nextConfig;

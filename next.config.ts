import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Linting is handled by oxlint (see .oxlintrc.json), not Next's ESLint
  // integration, so don't run ESLint during `next build`.
  eslint: {
    ignoreDuringBuilds: true,
  },
  experimental: {
    // Image uploads go through a server action (uploadImageColumnAction), which
    // defaults to a 1MB body cap. Keep this above the 10MB client-side image
    // limit (MAX_IMAGE_BYTES) with headroom for multipart overhead, or larger
    // pastes/drops fail with a 413 "Body exceeded 1 MB limit".
    serverActions: {
      bodySizeLimit: "12mb",
    },
  },
};

export default nextConfig;

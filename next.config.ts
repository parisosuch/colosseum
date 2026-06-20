import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Linting is handled by oxlint (see .oxlintrc.json), not Next's ESLint
  // integration, so don't run ESLint during `next build`.
  eslint: {
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;

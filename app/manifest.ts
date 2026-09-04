import type { MetadataRoute } from "next";

// Served at /manifest.webmanifest. Makes the app installable to the home
// screen and launch standalone. iOS uses apple-touch-icon (see the layout's
// metadata) for the home-screen icon rather than these, but Android and the
// install prompt read them.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Colosseum",
    short_name: "Colosseum",
    description: "Visualize the web.",
    start_url: "/",
    display: "standalone",
    // Both stay light. The manifest format has no media-query form for either
    // colour, so there is no dark path to add here — the theme-aware value is
    // the <meta name="theme-color"> pair in the root layout's viewport export,
    // which browsers prefer over theme_color where both are present. This is
    // the fallback, and background_color only paints the launch splash before
    // the first render.
    background_color: "#ffffff",
    theme_color: "#ffffff",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}

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
    background_color: "#ffffff",
    theme_color: "#ffffff",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}

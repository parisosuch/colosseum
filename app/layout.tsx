import type { Metadata, Viewport } from "next";
import { Fraunces, Geist } from "next/font/google";
import { ThemeProvider } from "next-themes";
import "./globals.css";
import NavBar from "@/components/nav-bar";
import { NavBarGate } from "@/components/nav-bar-gate";
import { HeroFrame } from "@/components/hero-frame";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ServiceWorkerRegister } from "@/components/service-worker-register";
import SiteFooter from "@/components/site-footer";
import MobileBottomNav from "@/components/mobile-bottom-nav";

// The public origin every absolute URL in metadata is resolved against — most
// visibly og:image and og:url on a share card, which a crawler has to be able
// to fetch from the outside.
//
// VERCEL_URL alone was a leftover from the starter template. It is never set on
// a self-hosted deployment, which is how colosseum is meant to run, so every
// card told Slack and friends that its image lived at http://localhost:3000 and
// no unfurl could ever load one. BETTER_AUTH_URL is the public URL a deployment
// behind a domain already has to set (auth rejects mismatched origins without
// it), so it is the value that is actually correct here.
//
// Read at server start, so changing it needs a container restart — the same as
// it already is for auth.
function publicOrigin(): string {
  const configured =
    process.env.BETTER_AUTH_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null);
  if (!configured) return "http://localhost:3000";
  try {
    return new URL(configured).origin;
  } catch {
    // A malformed value shouldn't take every page down with it; cards degrade
    // to relative-to-localhost, which is no worse than not setting it at all.
    return "http://localhost:3000";
  }
}

const defaultUrl = publicOrigin();

export const metadata: Metadata = {
  metadataBase: new URL(defaultUrl),
  title: "Colosseum",
  description: "Visualize the web.",
  applicationName: "Colosseum",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Colosseum",
    statusBarStyle: "default",
  },
  // Declaring `icons` here overrides Next's file-based icon convention, so the
  // browser favicon must be listed explicitly — otherwise only `apple` is
  // emitted and browsers fall back to auto-fetching /favicon.ico. Point it at
  // the SVG logo mark (app/icon.svg) so the tab shows the brand, not a leftover.
  icons: {
    icon: [{ url: "/icon.svg", type: "image/svg+xml" }],
    apple: "/apple-touch-icon.png",
  },
};

// No maximumScale/userScalable: pinch-zoom is the only way a low-vision reader
// can enlarge text that the layout won't, and the app still has controls near
// the size floor plus a 10px unread badge. iOS auto-zoom on input focus — the
// reason the cap was here — is handled instead by keeping text inputs at 16px.
//
// themeColor paints the mobile address bar and the installed PWA's title bar.
// One unconditional white left both of them white against a #0a0a0a page, so
// it's a media-keyed pair tracking --background in each theme. The manifest's
// theme_color has no media form in the spec and stays light; browsers prefer
// this meta tag over it wherever both are present.
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
  viewportFit: "cover",
};

const geistSans = Geist({
  variable: "--font-geist-sans",
  display: "swap",
  subsets: ["latin"],
});

// Serif for the wordmark + headings; body stays sans (Geist).
const fraunces = Fraunces({
  variable: "--font-serif",
  display: "swap",
  subsets: ["latin"],
});

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${geistSans.className} ${fraunces.variable} antialiased`}>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <TooltipProvider>
            {/* App shell lives on a div, not <body>: Next doesn't reconcile
                <body> attributes across client navigations, so hanging the
                flex layout off <body> left pages uncentered until a reload. */}
            {/* h-[100dvh], not h-screen (100vh): in an iOS standalone PWA with
                viewportFit=cover, 100vh overshoots the visible area. */}
            <div className="h-[100dvh] flex flex-col">
              {/* Scrollable content region. The nav lives inside it as a sticky
                child so content scrolls translucently under it (see .chrome);
                a sticky element needs its scroll container as an ancestor.
                Bottom padding on mobile clears the fixed bottom bar so the last
                content isn't hidden behind it. */}
              <div className="flex-1 min-h-0 flex flex-col overflow-y-auto pb-[calc(3.5rem+env(safe-area-inset-bottom))] sm:pb-0">
                <NavBarGate>
                  <NavBar />
                </NavBarGate>
                <HeroFrame>{children}</HeroFrame>
                {/* Last thing in the scroll region, so it sits below the page
                    rather than floating over it and clears the fixed mobile
                    bottom bar via this container's padding. Gated like the nav:
                    the hero routes are full-bleed and drop the chrome. */}
                <NavBarGate>
                  <SiteFooter />
                </NavBarGate>
              </div>
              <NavBarGate>
                <MobileBottomNav />
              </NavBarGate>
            </div>
            <Toaster />
            <ServiceWorkerRegister />
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}

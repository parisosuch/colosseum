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
import { NoZoomGuard } from "@/components/no-zoom-guard";
import MobileBottomNav from "@/components/mobile-bottom-nav";

const defaultUrl = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : "http://localhost:3000";

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

export const viewport: Viewport = {
  themeColor: "#ffffff",
  viewportFit: "cover",
  // App-like on mobile: no page zoom (also stops iOS auto-zoom on input focus).
  // Pinch/double-tap are additionally handled by touch-action and the gesture
  // guard, since iOS Safari ignores these for accessibility.
  maximumScale: 1,
  userScalable: false,
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
              </div>
              <NavBarGate>
                <MobileBottomNav />
              </NavBarGate>
            </div>
            <Toaster />
            <ServiceWorkerRegister />
            <NoZoomGuard />
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}

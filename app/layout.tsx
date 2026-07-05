import type { Metadata, Viewport } from "next";
import { Fraunces, Geist } from "next/font/google";
import { ThemeProvider } from "next-themes";
import "./globals.css";
import NavBar from "@/components/nav-bar";
import { NavBarGate } from "@/components/nav-bar-gate";
import { HeroFrame } from "@/components/hero-frame";
import { Toaster } from "@/components/ui/sonner";
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
  icons: {
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
          {/* App shell lives on a div, not <body>: Next doesn't reconcile
              <body> attributes across client navigations, so hanging the
              flex layout off <body> left pages uncentered until a reload. */}
          <div className="h-screen flex flex-col">
            <NavBarGate>
              <NavBar />
            </NavBarGate>
            {/* Scrollable content region. Bottom padding on mobile clears the
                fixed bottom bar so the last content isn't hidden behind it. */}
            <div className="flex-1 min-h-0 flex flex-col overflow-y-auto pb-[calc(3.5rem+env(safe-area-inset-bottom))] sm:pb-0">
              <HeroFrame>{children}</HeroFrame>
            </div>
            <NavBarGate>
              <MobileBottomNav />
            </NavBarGate>
          </div>
          <Toaster />
          <ServiceWorkerRegister />
          <NoZoomGuard />
        </ThemeProvider>
      </body>
    </html>
  );
}

import type { Metadata } from "next";
import { Fraunces, Geist } from "next/font/google";
import { ThemeProvider } from "next-themes";
import "./globals.css";
import NavBar from "@/components/nav-bar";
import { NavBarGate } from "@/components/nav-bar-gate";
import { HeroFrame } from "@/components/hero-frame";
import { Toaster } from "@/components/ui/sonner";

const defaultUrl = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(defaultUrl),
  title: "Colosseum",
  description: "Visualize the web.",
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
            <HeroFrame>{children}</HeroFrame>
          </div>
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}

import type { Config } from "tailwindcss";
import plugin from "tailwindcss/plugin";

export default {
  darkMode: ["class"],
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        serif: ["var(--font-serif)", "ui-serif", "Georgia", "serif"],
      },
      colors: {
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
          // `text-destructive-text`: the red that reads as text on the page
          // background. DEFAULT is tuned as a fill behind white type, and in
          // dark mode it lands at 1.98:1 when used as a foreground.
          text: "hsl(var(--destructive-text))",
        },
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      screens: {
        "3xl": "2000px", // now 3xl triggers at 1440p monitors
      },
      // shadcn's current registry is written for Tailwind v4, whose vocabulary
      // differs from the v3 we're on. Two of its names have no v3 equivalent
      // but do have a natural home in the theme, so they're defined here rather
      // than rewritten at every call site (a v4 class that doesn't exist
      // compiles to nothing and fails silently).
      //
      // v4 renamed the old `shadow-sm` to `shadow-xs`; same value.
      boxShadow: {
        xs: "0 1px 2px 0 rgb(0 0 0 / 0.05)",
      },
      // v3 ships nine `aria-*` variants and `invalid` isn't one of them, so the
      // `aria-invalid:` styling on Textarea and Checkbox was inert — an invalid
      // field got no red border or ring at all.
      aria: {
        invalid: 'invalid="true"',
      },
    },
  },
  plugins: [
    require("tailwindcss-animate"),
    // `coarse:` — finger-driven pointers only. Lets a control claim the 44px
    // touch floor on phones and tablets without loosening mouse-driven
    // layouts, which stay at their designed density.
    plugin(({ addVariant }) => {
      addVariant("coarse", "@media (pointer: coarse)");
    }),
  ],
} satisfies Config;

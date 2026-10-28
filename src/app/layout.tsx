import type { Metadata, Viewport } from "next"
import type { ReactNode } from "react"

import { Providers } from "@/app/providers"

import "./globals.css"

export const metadata: Metadata = {
  title: "Skills Connect Admin",
  description:
    "Skills Connect admin portal — clients, orders, documents, finance and compliance.",
  icons: {
    icon: [{ url: "/favicon.svg", type: "image/svg+xml" }],
  },
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
}

/**
 * Theme bootstrap: runs before first paint to avoid flash of wrong theme.
 * Stores ONLY the non-sensitive theme preference ("light" | "dark" | "system").
 * First-time users (no stored value) fall back to the OS preference (System).
 */
const themeBootstrap = `(function () {
  try {
    var stored = localStorage.getItem("sc-theme") || "system";
    var dark =
      stored === "dark" ||
      (stored === "system" &&
        window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.classList.toggle("dark", dark);
    document.documentElement.style.colorScheme = dark ? "dark" : "light";
  } catch (e) {
    /* storage unavailable — fall back to OS preference */
    try {
      var osDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      document.documentElement.classList.toggle("dark", osDark);
    } catch (_) {}
  }
})();`

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}

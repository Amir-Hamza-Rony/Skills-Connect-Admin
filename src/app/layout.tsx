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

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
      </head>
      <body suppressHydrationWarning>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}

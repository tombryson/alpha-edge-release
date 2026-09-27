import type React from "react"
import type { Metadata, Viewport } from "next"
import "./globals.css"
import "@/styles/terminal-mobile.css"
import { AccessBoundary } from "@/components/access-boundary"
import { serverAccessMode } from "@/lib/server-access"

export const dynamic = 'force-dynamic';

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
}

export const metadata: Metadata = {
  title: "Alpha Edge",
  description: "Stock Portfolio Monitor",
  icons: {
    icon: {
      url: "/icon",
      sizes: "32x32",
      type: "image/png",
    },
    apple: {
      url: "/apple-icon.png",
      sizes: "180x180",
      type: "image/png",
    },
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  // The bootstrap script applies the saved theme before first paint.
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {serverAccessMode() === 'demo' && <meta httpEquiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; frame-src 'self' https://www.tradingview-widget.com; object-src 'none'; base-uri 'self'; form-action 'self'" />}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function () {
                try {
                  var raw = localStorage.getItem('alpha-edge-theme') || localStorage.getItem('theme') || 'dark';
                  var theme = raw === 'light' ? 'terminal-light-soft' : raw;
                  var allowed = ['terminal-dark', 'terminal-light-soft', 'theme1-dark', 'theme1-light', 'amber-dark', 'amber-light', 'catppuccin-dark', 'catppuccin-light', 'vintage-dark', 'vintage-light'];
                  if (allowed.indexOf(theme) === -1) theme = 'terminal-dark';
                  var root = document.documentElement;
                  root.setAttribute('data-theme', theme);
                  if (theme === 'terminal-light-soft' || theme === 'theme1-light' || theme === 'amber-light' || theme === 'catppuccin-light' || theme === 'vintage-light') {
                    root.classList.add('light');
                  } else {
                    root.classList.remove('light');
                  }
                } catch (e) {}
              })();
            `,
          }}
        />
      </head>
      <body className="font-mono antialiased">
        <AccessBoundary mode={serverAccessMode()}>{children}</AccessBoundary>
      </body>
    </html>
  )
}

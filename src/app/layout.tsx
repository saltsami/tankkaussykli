import type { Metadata, Viewport } from "next";
import "leaflet/dist/leaflet.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "TankkausSykli – löydä halpa tankkaushetki",
  description:
    "Vertaa lähiasemien polttoainehintoja, seuraa hintatrendiä ja löydä edullinen tankkaushetki.",
  applicationName: "TankkausSykli",
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
  themeColor: "#0b3b36",
  colorScheme: "light",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fi">
      <body>{children}</body>
    </html>
  );
}

import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./reference-theme.css";

export const metadata: Metadata = {
  title: "AMG Matchup Portal",
  description: "Connect agents with the right Certified Field Trainer.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0b2e24",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="amg-reference-theme amg-matchup-theme">{children}</body>
    </html>
  );
}

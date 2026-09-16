import type { Metadata } from "next";
import { AppShell } from "@/components/AppShell";
import "./globals.css";

export const metadata: Metadata = {
  title: "Economie-assistent",
  description: "Interne werkruimte voor brononderzoek en beoordeling door de dienst lokale economie.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="nl-BE">
      <body><AppShell municipality={process.env.MUNICIPALITY_NAME ?? 'Schoten'}>{children}</AppShell></body>
    </html>
  );
}

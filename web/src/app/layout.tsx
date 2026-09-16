import type { Metadata } from "next";
import { cookies } from "next/headers";
import { AppShell } from "@/components/AppShell";
import { LanguageProvider } from "@/components/LanguageProvider";
import { LOCALE_COOKIE, localeTag, parseLocale, translate } from "@/lib/i18n";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const locale = parseLocale((await cookies()).get(LOCALE_COOKIE)?.value);
  return {
    title: { default: translate("Economie-assistent · Dienst lokale economie", locale), template: `%s · ${translate('Economie-assistent', locale)}` },
    description: translate("Van ondernemersvraag naar een onderbouwd antwoord. Brononderzoek, heldere verwijzingen en menselijke beoordeling in één gemeentelijke werkruimte.", locale),
  };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = parseLocale((await cookies()).get(LOCALE_COOKIE)?.value);
  return (
    <html lang={localeTag(locale)}>
      <body><LanguageProvider initialLocale={locale}><AppShell municipality={process.env.MUNICIPALITY_NAME ?? 'Schoten'}>{children}</AppShell></LanguageProvider></body>
    </html>
  );
}

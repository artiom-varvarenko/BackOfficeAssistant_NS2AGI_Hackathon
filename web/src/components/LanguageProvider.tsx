'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { LOCALE_COOKIE, localeTag, translate, type Locale, type TranslationValues } from '@/lib/i18n';

interface LanguageContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (source: string, values?: TranslationValues) => string;
}
const LanguageContext = createContext<LanguageContextValue>({ locale: 'nl', setLocale: () => undefined, t: (source, values) => translate(source, 'nl', values) });

export function LanguageProvider({ children, initialLocale = 'nl' }: { children: ReactNode; initialLocale?: Locale }) {
  const [locale, updateLocale] = useState<Locale>(initialLocale);
  const router = useRouter();
  const setLocale = useCallback((nextLocale: Locale) => {
    document.cookie = `${LOCALE_COOKIE}=${nextLocale}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`;
    updateLocale(nextLocale);
    router.refresh();
  }, [router]);
  useEffect(() => { document.documentElement.lang = localeTag(locale); }, [locale]);
  const t = useCallback((source: string, values?: TranslationValues) => translate(source, locale, values), [locale]);
  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t]);
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export const useLocale = () => useContext(LanguageContext);
export const useTranslation = useLocale;

export function LanguageSwitch() {
  const { locale, setLocale, t } = useLocale();
  return <div className="language-switch" role="group" aria-label={t('Taal')}>
    <button type="button" lang="nl" aria-label={t('Nederlandse interface')} aria-pressed={locale === 'nl'} onClick={() => setLocale('nl')}>NL</button>
    <button type="button" lang="en" aria-label={t('Engelse interface')} aria-pressed={locale === 'en'} onClick={() => setLocale('en')}>EN</button>
  </div>;
}

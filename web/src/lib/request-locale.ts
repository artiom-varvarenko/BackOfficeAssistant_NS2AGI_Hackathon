import type { Locale } from './i18n';

export function requestLocale(request: Request): Locale {
  const cookie = request.headers.get('cookie')?.split(';').find((part) => part.trim().startsWith('ea_locale='));
  return cookie?.trim().slice('ea_locale='.length) === 'en' ? 'en' : 'nl';
}

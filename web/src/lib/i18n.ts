import { commonTranslations } from './i18n-common';
import { questionTranslations } from './i18n-question';
import { reviewTranslations } from './i18n-review';
import { sourceTranslations } from './i18n-sources';
import { backendTranslations } from './i18n-backend';

export type Locale = 'nl' | 'en';
export type TranslationValues = Record<string, string | number>;
export const LOCALE_COOKIE = 'ea_locale';
export const localeTag = (locale: Locale) => locale === 'en' ? 'en-GB' : 'nl-BE';
export const parseLocale = (value?: string | null): Locale => value === 'en' ? 'en' : 'nl';

const english: Record<string, string> = {
  ...commonTranslations,
  ...questionTranslations,
  ...reviewTranslations,
  ...sourceTranslations,
  ...backendTranslations,
};
const interpolate = (text: string, values?: TranslationValues) => values
  ? text.replace(/\{(\w+)\}/g, (match, key: string) => values[key] === undefined ? match : String(values[key]))
  : text;
const localizeFieldValues = (values?: TranslationValues): TranslationValues | undefined => values
  ? Object.fromEntries(Object.entries(values).map(([key, value]) => [key, (key === 'field' || key === 'label') && typeof value === 'string' ? english[value] ?? value : value]))
  : undefined;
const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// API warnings and audit events may already contain values when they arrive.
// Match only known full-message templates; never translate arbitrary documents.
const templates = Object.entries(english).filter(([source]) => /\{\w+\}/.test(source)).map(([source, target]) => {
  const names: string[] = [];
  let offset = 0;
  let pattern = '^';
  for (const match of source.matchAll(/\{(\w+)\}/g)) {
    pattern += escapeRegex(source.slice(offset, match.index)) + '([\\s\\S]+?)';
    names.push(match[1]);
    offset = match.index! + match[0].length;
  }
  return { regex: new RegExp(pattern + escapeRegex(source.slice(offset)) + '$'), names, target };
});

export function translate(source: string, locale: Locale, values?: TranslationValues): string {
  if (locale !== 'en') return interpolate(source, values);
  if (english[source] !== undefined) return interpolate(english[source], localizeFieldValues(values));
  if (!values) {
    for (const { regex, names, target } of templates) {
      const match = regex.exec(source);
      if (match) return interpolate(target, localizeFieldValues(Object.fromEntries(names.map((name, index) => [name, match[index + 1]]))));
    }
  }
  return interpolate(source, values);
}

/** Safe to import into client utilities as well as server modules. */
export function getClientLocale(): Locale {
  if (typeof document === 'undefined') return 'nl';
  const value = document.cookie.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${LOCALE_COOKIE}=`))?.slice(LOCALE_COOKIE.length + 1);
  return parseLocale(value);
}

/** Translate system audit labels while preserving staff notes and filenames. */
export function translateEventDetail(detail: string, type: string, locale: Locale): string {
  if (type === 'metadata_edited') return detail.split(', ').map((field) => translate(field, locale)).join(', ');
  if (type === 'applicability_changed') {
    const match = /^([^:]+?) → ([^:]+)(: [\s\S]*)?$/.exec(detail);
    if (match) return `${translate(match[1], locale)} → ${translate(match[2], locale)}${match[3] ?? ''}`;
  }
  return translate(detail, locale);
}

'use client';
import type { ReactNode } from 'react';
import type { AnswerStatus, Applicability, Level, ProviderId } from '@/lib/types';
import { getClientLocale, localeTag, type Locale } from '@/lib/i18n';
import { useLocale } from './LanguageProvider';

export const levelLabels: Record<Level, string> = { municipal: 'Gemeentelijk', provincial: 'Provinciaal', flemish: 'Vlaams', federal: 'Federaal' };
export const providerLabels: Record<ProviderId, string> = { openai: 'OpenAI', anthropic: 'Anthropic', google: 'Google', mistral: 'Mistral', azure: 'Azure OpenAI', custom: 'OpenAI-compatibel' };
export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'green' | 'amber' | 'red' }) { return <span className={`badge badge-${tone}`}>{children}</span>; }
export function StatusBadge({ status }: { status: AnswerStatus }) { const { t } = useLocale(); return <Badge tone={status === 'approved' ? 'green' : status === 'rejected' ? 'red' : 'neutral'}>{t({ draft: 'Concept', approved: 'Goedgekeurd', rejected: 'Afgewezen' }[status])}</Badge>; }
export function ApplicabilityBadge({ value, verifiedAt }: { value: Applicability; verifiedAt?: string | null }) {
  const { locale, t } = useLocale();
  const label = { unverified: t('Toepasselijkheid niet geverifieerd'), verified: verifiedAt ? t('Geverifieerd op {date}', { date: dateLabel(verifiedAt, locale) }) : t('Geverifieerd'), historical: t('Historisch — geen bewijs van huidige regels'), superseded: t('Vervangen door nieuwere versie') }[value];
  return <Badge tone={value === 'unverified' ? 'amber' : value === 'verified' ? 'green' : value === 'historical' ? 'red' : 'neutral'}>{label}</Badge>;
}
export function dateLabel(value: string, locale: Locale = getClientLocale()) { return new Intl.DateTimeFormat(localeTag(locale), { dateStyle: 'medium', timeZone: 'Europe/Brussels' }).format(new Date(value)); }

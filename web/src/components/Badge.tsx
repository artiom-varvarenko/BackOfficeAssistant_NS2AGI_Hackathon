import type { ReactNode } from 'react';
import type { AnswerStatus, Applicability, Level, ProviderId } from '@/lib/types';

export const levelLabels: Record<Level, string> = { municipal: 'Gemeentelijk', provincial: 'Provinciaal', flemish: 'Vlaams', federal: 'Federaal' };
export const providerLabels: Record<ProviderId, string> = { openai: 'OpenAI', anthropic: 'Anthropic', google: 'Google', mistral: 'Mistral', azure: 'Azure OpenAI', custom: 'OpenAI-compatibel' };
export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'green' | 'amber' | 'red' }) { return <span className={`badge badge-${tone}`}>{children}</span>; }
export function StatusBadge({ status }: { status: AnswerStatus }) { return <Badge tone={status === 'approved' ? 'green' : status === 'rejected' ? 'red' : 'neutral'}>{{ draft: 'Concept', approved: 'Goedgekeurd', rejected: 'Afgewezen' }[status]}</Badge>; }
export function ApplicabilityBadge({ value, verifiedAt }: { value: Applicability; verifiedAt?: string | null }) {
  const label = { unverified: 'Toepasselijkheid niet geverifieerd', verified: verifiedAt ? `Geverifieerd op ${dateLabel(verifiedAt)}` : 'Geverifieerd', historical: 'Historisch — geen bewijs van huidige regels', superseded: 'Vervangen door nieuwere versie' }[value];
  return <Badge tone={value === 'unverified' ? 'amber' : value === 'verified' ? 'green' : value === 'historical' ? 'red' : 'neutral'}>{label}</Badge>;
}
export function dateLabel(value: string) { return new Intl.DateTimeFormat('nl-BE', { dateStyle: 'medium', timeZone: 'Europe/Brussels' }).format(new Date(value)); }

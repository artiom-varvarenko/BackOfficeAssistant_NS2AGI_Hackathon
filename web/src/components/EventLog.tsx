'use client';

import Link from 'next/link';
import { useCallback, useState } from 'react';
import { getEvents } from '@/lib/api-client';
import type { EventLogItem } from '@/lib/types';
import { ResourceView } from './ResourceView';
import { useLocale } from './LanguageProvider';
import { localeTag, translateEventDetail, type Locale } from '@/lib/i18n';
import { Icon } from './Icon';

const eventLabels: Record<string, string> = {
  generated: 'Antwoord opgesteld', edited: 'Antwoord aangepast', approved: 'Goedgekeurd',
  rejected: 'Afgewezen', reopened: 'Heropend', email_drafted: 'E-mailconcept gemaakt',
  citation_checked: 'Passagecontrole gewijzigd', regenerated: 'Opnieuw gegenereerd',
  created: 'Bron toegevoegd', enabled: 'Bron ingeschakeld', disabled: 'Bron uitgeschakeld',
  version_added: 'Nieuwe versie toegevoegd', applicability_changed: 'Toepasselijkheid gewijzigd',
  metadata_edited: 'Brongegevens aangepast', summary_generated: 'Samenvatting gemaakt',
};
const timestamp = (value: string, locale: Locale) => new Intl.DateTimeFormat(localeTag(locale), { dateStyle: 'medium', timeStyle: 'medium', timeZone: 'Europe/Brussels' }).format(new Date(value));

function EventTable({ events, kind }: { events: EventLogItem[]; kind: string }) {
  const { locale, t } = useLocale();
  const filtered = [...events].filter((event) => !kind || event.kind === kind).sort((a, b) => b.at.localeCompare(a.at));
  if (!events.length) return <p className="card">{t('Nog geen gebeurtenissen.')}</p>;
  if (!filtered.length) return <p className="card">{t('Geen gebeurtenissen voor deze selectie.')}</p>;
  return <div className="table-scroll"><table><caption className="sr-only">{t('Gebeurtenissen in de werkruimte, nieuwste eerst')}</caption><thead><tr><th>{t('Datum')}</th><th>{t('Soort')}</th><th>{t('Gebeurtenis')}</th><th>{t('Detail')}</th><th>{t('Openen')}</th></tr></thead><tbody>{filtered.map((event) => {
    const href = event.kind === 'answer' && event.answerId ? `/geschiedenis/${encodeURIComponent(event.answerId)}` : event.sourceId ? `/bronnen/${encodeURIComponent(event.sourceId)}` : null;
    return <tr key={`${event.kind}-${event.id}`}><td><time dateTime={event.at}>{timestamp(event.at, locale)}</time></td><td><span className="badge">{t(event.kind === 'answer' ? 'Antwoord' : 'Bron')}</span></td><td>{t(eventLabels[event.type] ?? 'Gebeurtenis')}</td><td>{event.detail ? translateEventDetail(event.detail, event.type, locale) : '—'}</td><td>{href ? <Link href={href}>{event.label}</Link> : event.label}</td></tr>;
  })}</tbody></table></div>;
}

export function EventLog() {
  const { t } = useLocale();
  const [attempt, setAttempt] = useState(0);
  const [limit, setLimit] = useState(200);
  const [kind, setKind] = useState('');
  const load = useCallback(() => getEvents(limit), [limit]);
  return <><div className="page-heading"><div><p className="eyebrow"><Icon name="logbook" size={14} /> {t('Activiteit')}</p><h1>{t('Elke stap, helder vastgelegd.')}</h1><p>{t('Wijzigingen aan antwoorden en bronnen, met de nieuwste gebeurtenis bovenaan.')}</p></div><button onClick={() => setAttempt((value) => value + 1)}><Icon name="refresh" size={16} />{t('Vernieuwen')}</button></div>
    <div className="card form-grid"><label className="field">{t('Soort gebeurtenis')}<select value={kind} onChange={(event) => setKind(event.target.value)}><option value="">{t('Alle gebeurtenissen')}</option><option value="answer">{t('Antwoorden')}</option><option value="source">{t('Bronnen')}</option></select></label><label className="field">{t('Aantal recente gebeurtenissen')}<select value={limit} onChange={(event) => setLimit(Number(event.target.value))}><option value={50}>50</option><option value={100}>100</option><option value={200}>200</option></select></label></div>
    <ResourceView key={`${limit}-${attempt}`} load={load} loading={t('Gebeurtenissen laden…')}>{(events) => <><p className="muted">{t('{count} recente gebeurtenissen geladen · tijden in Brussel.', { count: events.length })}</p><EventTable events={events} kind={kind} /></>}</ResourceView>
  </>;
}

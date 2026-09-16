'use client';

import Link from 'next/link';
import { useCallback, useState } from 'react';
import { getEvents } from '@/lib/api-client';
import type { EventLogItem } from '@/lib/types';
import { ResourceView } from './ResourceView';

const eventLabels: Record<string, string> = {
  generated: 'Antwoord opgesteld', edited: 'Antwoord aangepast', approved: 'Goedgekeurd',
  rejected: 'Afgewezen', reopened: 'Heropend', email_drafted: 'E-mailconcept gemaakt',
  citation_checked: 'Passagecontrole gewijzigd', regenerated: 'Opnieuw gegenereerd',
  created: 'Bron toegevoegd', enabled: 'Bron ingeschakeld', disabled: 'Bron uitgeschakeld',
  version_added: 'Nieuwe versie toegevoegd', applicability_changed: 'Toepasselijkheid gewijzigd',
  metadata_edited: 'Brongegevens aangepast', summary_generated: 'Samenvatting gemaakt',
};
const timestamp = (value: string) => new Intl.DateTimeFormat('nl-BE', { dateStyle: 'medium', timeStyle: 'medium', timeZone: 'Europe/Brussels' }).format(new Date(value));

function EventTable({ events, kind }: { events: EventLogItem[]; kind: string }) {
  const filtered = [...events].filter((event) => !kind || event.kind === kind).sort((a, b) => b.at.localeCompare(a.at));
  if (!events.length) return <p className="card">Nog geen gebeurtenissen.</p>;
  if (!filtered.length) return <p className="card">Geen gebeurtenissen voor deze selectie.</p>;
  return <div className="table-scroll"><table><caption className="sr-only">Gebeurtenissen in de werkruimte, nieuwste eerst</caption><thead><tr><th>Datum</th><th>Soort</th><th>Gebeurtenis</th><th>Detail</th><th>Openen</th></tr></thead><tbody>{filtered.map((event) => {
    const href = event.kind === 'answer' && event.answerId ? `/geschiedenis/${encodeURIComponent(event.answerId)}` : event.sourceId ? `/bronnen/${encodeURIComponent(event.sourceId)}` : null;
    return <tr key={`${event.kind}-${event.id}`}><td><time dateTime={event.at}>{timestamp(event.at)}</time></td><td>{event.kind === 'answer' ? 'Antwoord' : 'Bron'}</td><td>{eventLabels[event.type] ?? 'Gebeurtenis'}</td><td>{event.detail ?? '—'}</td><td>{href ? <Link href={href}>{event.label}</Link> : event.label}</td></tr>;
  })}</tbody></table></div>;
}

export function EventLog() {
  const [attempt, setAttempt] = useState(0);
  const [limit, setLimit] = useState(200);
  const [kind, setKind] = useState('');
  const load = useCallback(() => getEvents(limit), [limit]);
  return <><div className="page-heading"><div><h1>Logboek</h1><p>Wijzigingen aan antwoorden en bronnen, met de nieuwste gebeurtenis bovenaan.</p></div><button onClick={() => setAttempt((value) => value + 1)}>Vernieuwen</button></div>
    <div className="card form-grid"><label className="field">Soort gebeurtenis<select value={kind} onChange={(event) => setKind(event.target.value)}><option value="">Alle gebeurtenissen</option><option value="answer">Antwoorden</option><option value="source">Bronnen</option></select></label><label className="field">Aantal recente gebeurtenissen<select value={limit} onChange={(event) => setLimit(Number(event.target.value))}><option value={50}>50</option><option value={100}>100</option><option value={200}>200</option></select></label></div>
    <ResourceView key={`${limit}-${attempt}`} load={load} loading="Gebeurtenissen laden…">{(events) => <><p className="muted">{events.length} recente gebeurtenissen geladen · tijden in Brussel.</p><EventTable events={events} kind={kind} /></>}</ResourceView>
  </>;
}

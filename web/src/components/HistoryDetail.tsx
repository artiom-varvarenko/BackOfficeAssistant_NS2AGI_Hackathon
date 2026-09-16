'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { getSimilarAnswers } from '@/lib/api-client';
import type { Answer, AnswerEvent, AnswerListItem } from '@/lib/types';
import { CitationChip } from './AnswerView';
import { Badge, providerLabels, StatusBadge } from './Badge';

export function dateTimeLabel(value: string) {
  return new Intl.DateTimeFormat('nl-BE', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Brussels' }).format(new Date(value));
}

export function HistoryAnswerBlocks({ answer, activeMarker, onSelect }: { answer: Answer; activeMarker: number | null; onSelect: (marker: number) => void }) {
  function render(text: string) {
    return text.split(/(\[\d+\])/g).map((part, index) => {
      const match = /^\[(\d+)\]$/.exec(part);
      const marker = match ? Number(match[1]) : null;
      return marker !== null && answer.citations.some((citation) => citation.marker === marker)
        ? <CitationChip key={index} marker={marker} active={activeMarker === marker} onSelect={onSelect} />
        : <span key={index}>{part}</span>;
    });
  }

  return <>
    <section className="card"><div className="section-heading"><h2>Gegenereerd antwoord (AI, ongewijzigd)</h2><Badge>AI-voorstel</Badge></div><p className="muted">{answer.model} · {providerLabels[answer.provider]} · {answer.passagesSent} passages uit {answer.sourcesUsed} bronnen</p>{answer.canAnswer !== 'ja' && <p className="notice notice-amber">{answer.canAnswer === 'nee' ? 'De ingeschakelde bronnen bevatten geen antwoord op deze vraag.' : 'Gedeeltelijk beantwoord — zie ontbrekende informatie.'}</p>}<div className="answer-text">{render(answer.generatedAnswer)}</div></section>
    <section className="card"><div className="section-heading"><h2>Beoordeelde tekst (medewerker)</h2><StatusBadge status={answer.status} /></div>
      {answer.status === 'draft' && <p className="notice notice-amber">Concept — nog niet goedgekeurd.</p>}
      {answer.reviewedAnswer === null && <p className="muted">Ongewijzigd ten opzichte van het gegenereerde antwoord.</p>}
      <div className="answer-text">{render(answer.reviewedAnswer ?? answer.generatedAnswer)}</div>
      <p className="muted">Aangemaakt {dateTimeLabel(answer.createdAt)} · Beoordeeld {answer.reviewedAt ? dateTimeLabel(answer.reviewedAt) : 'nog niet'}</p>
    </section>
  </>;
}

const eventLabels: Record<AnswerEvent['type'], string> = {
  generated: 'Antwoord gegenereerd', edited: 'Tekst aangepast', approved: 'Goedgekeurd', rejected: 'Afgewezen',
  reopened: 'Heropend als concept', email_drafted: 'E-mailconcept gemaakt', citation_checked: 'Passagecontrole gewijzigd', regenerated: 'Opnieuw gegenereerd',
};

function SimilarAnswers({ question, answerId }: { question: string; answerId: string }) {
  const [answers, setAnswers] = useState<AnswerListItem[] | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true;
    getSimilarAnswers(question, answerId).then((items) => { if (alive) { setAnswers(items); setError(''); } }).catch((reason) => { if (alive) setError(reason instanceof Error ? reason.message : 'Vergelijkbare vragen konden niet worden geladen.'); });
    return () => { alive = false; };
  }, [question, answerId, attempt]);
  return <section className="card"><h2>Vergelijkbare eerdere vragen</h2>
    {error ? <div role="alert"><p>{error}</p><button type="button" onClick={() => { setError(''); setAnswers(null); setAttempt((value) => value + 1); }}>Opnieuw proberen</button></div>
      : answers === null ? <p role="status">Vergelijkbare vragen laden…</p>
        : answers.length === 0 ? <p className="muted">Geen vergelijkbare eerdere vragen gevonden.</p>
          : <ul>{answers.map((item) => <li key={item.id}><Link href={`/geschiedenis/${encodeURIComponent(item.id)}`}>{item.question}</Link> <StatusBadge status={item.status} /><p className="muted">{dateTimeLabel(item.createdAt)} · {item.checkedCount}/{item.citationCount} passages gecontroleerd</p></li>)}</ul>}
  </section>;
}

export function HistoryDetail({ answer, onExport, busy }: { answer: Answer; onExport: () => Promise<void>; busy: boolean }) {
  const scope = answer.scopeSourceIds;
  const effortLabel = answer.effort === null ? 'Niet ingesteld' : { none: 'Geen', low: 'Laag', medium: 'Gemiddeld', high: 'Hoog' }[answer.effort];
  return <div className="history-details">
    <section className="card"><h2>Verloop</h2>
      {answer.events.length === 0 ? <p className="muted">Er zijn nog geen gebeurtenissen vastgelegd.</p> : <ol className="timeline">{[...answer.events].sort((a, b) => a.at.localeCompare(b.at)).map((event, index) => <li key={`${event.at}-${event.type}-${index}`}><strong>{eventLabels[event.type]}</strong><p className="muted"><time dateTime={event.at}>{dateTimeLabel(event.at)}</time></p>{event.detail && <p className="answer-text">{event.detail}</p>}</li>)}</ol>}
    </section>
    <section className="card technical-details"><details><summary>Technische details</summary>
      <dl><dt>Aanbieder en model</dt><dd>{providerLabels[answer.provider]} · {answer.model}</dd><dt>Redeneerinspanning</dt><dd>{effortLabel}</dd><dt>Passages naar het model</dt><dd>{answer.passagesSent}</dd><dt>Gebruikte bronnen</dt><dd>{answer.sourcesUsed}</dd><dt>Zinnen zonder bronverwijzing</dt><dd>{answer.uncitedSentences}</dd><dt>Aangemaakt</dt><dd>{dateTimeLabel(answer.createdAt)}</dd><dt>Laatst gewijzigd</dt><dd>{dateTimeLabel(answer.updatedAt)}</dd></dl>
      <h3>Bronselectie bij deze vraag</h3>
      {scope === null ? <p>Alle ingeschakelde bronnen waren beschikbaar.</p> : scope.length === 0 ? <p>Geen bronnen geselecteerd.</p> : <><p>Beperkt tot {scope.length} {scope.length === 1 ? 'bron' : 'bronnen'}.</p><ul>{scope.map((id) => <li key={id}><Link href={`/bronnen/${encodeURIComponent(id)}`}>{answer.citations.find((citation) => citation.sourceId === id)?.sourceTitle ?? id}</Link></li>)}</ul></>}
      <h3>Passages die aan het model zijn meegegeven</h3>
      {answer.passagesSentList === undefined ? <p className="muted">De passagelijst is voor dit antwoord niet opgeslagen.</p> : answer.passagesSentList.length === 0 ? <p>Geen passages meegegeven.</p> : <ul>{answer.passagesSentList.map((passage) => <li key={passage.passageId}><strong>{passage.label}</strong> · {passage.sourceTitle} · p. {passage.pageStart} <Badge tone={passage.cited ? 'green' : 'neutral'}>{passage.cited ? 'Geciteerd' : 'Niet geciteerd'}</Badge><p className="muted">Passage-ID: {passage.passageId}</p></li>)}</ul>}
      <details><summary>Opgeslagen prompt</summary>{answer.promptSnapshot ? <pre className="prompt-snapshot">{answer.promptSnapshot}</pre> : <p className="muted">Er is geen prompt opgeslagen bij dit antwoord.</p>}</details>
      <p className="muted">Antwoord-ID: {answer.id}</p>
    </details><button type="button" onClick={() => void onExport()} disabled={busy}>Exporteer JSON</button></section>
    <SimilarAnswers key={answer.id} question={answer.question} answerId={answer.id} />
  </div>;
}

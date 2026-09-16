'use client';

import { useLocale } from './LanguageProvider';
import { translateEventDetail } from '@/lib/i18n';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { getSimilarAnswers } from '@/lib/api-client';
import type { Answer, AnswerEvent, AnswerListItem } from '@/lib/types';
import { CitationChip } from './AnswerView';
import { Badge, providerLabels, StatusBadge } from './Badge';

export function dateTimeLabel(value: string, locale: 'nl' | 'en' = 'nl') {
  return new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : 'nl-BE', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Brussels' }).format(new Date(value));
}

export function HistoryAnswerBlocks({ answer, activeMarker, onSelect }: { answer: Answer; activeMarker: number | null; onSelect: (marker: number) => void }) {
  const { t, locale } = useLocale();
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
    <section className="card"><div className="section-heading"><h2>{t("Gegenereerd antwoord (AI, ongewijzigd)")}</h2><Badge>{t("AI-voorstel")}</Badge></div><p className="muted">{answer.model} · {t(providerLabels[answer.provider])} · {answer.passagesSent}{' '}{t("passages uit")}{' '}{answer.sourcesUsed}{' '}{t("bronnen")}</p>{answer.canAnswer !== 'ja' && <p className="notice notice-amber">{answer.canAnswer === 'nee' ? t("De ingeschakelde bronnen bevatten geen antwoord op deze vraag.") : t("Gedeeltelijk beantwoord — zie ontbrekende informatie.")}</p>}<div className="answer-text">{render(answer.generatedAnswer)}</div></section>
    <section className="card"><div className="section-heading"><h2>{t("Beoordeelde tekst (medewerker)")}</h2><StatusBadge status={answer.status} /></div>
      {answer.status === 'draft' && <p className="notice notice-amber">{t("Concept — nog niet goedgekeurd.")}</p>}
      {answer.reviewedAnswer === null && <p className="muted">{t("Ongewijzigd ten opzichte van het gegenereerde antwoord.")}</p>}
      <div className="answer-text">{render(answer.reviewedAnswer ?? answer.generatedAnswer)}</div>
      <p className="muted">{t("Aangemaakt")}{' '}{dateTimeLabel(answer.createdAt, locale)}{' '}{t("· Beoordeeld")}{' '}{answer.reviewedAt ? dateTimeLabel(answer.reviewedAt, locale) : t("nog niet")}</p>
    </section>
  </>;
}

const eventLabels: Record<AnswerEvent['type'], string> = {
  generated: 'Antwoord gegenereerd', edited: 'Tekst aangepast', approved: 'Goedgekeurd', rejected: 'Afgewezen',
  reopened: 'Heropend als concept', email_drafted: 'E-mailconcept gemaakt', citation_checked: 'Passagecontrole gewijzigd', regenerated: 'Opnieuw gegenereerd',
};

function SimilarAnswers({ question, answerId }: { question: string; answerId: string }) {
  const { t, locale } = useLocale();
  const [answers, setAnswers] = useState<AnswerListItem[] | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true;
    getSimilarAnswers(question, answerId).then((items) => { if (alive) { setAnswers(items); setError(''); } }).catch((reason) => { if (alive) setError(reason instanceof Error ? reason.message : t("Vergelijkbare vragen konden niet worden geladen.")); });
    return () => { alive = false; };
  }, [question, answerId, attempt, t]);
  return <section className="card"><h2>{t("Vergelijkbare eerdere vragen")}</h2>
    {error ? <div role="alert"><p>{t(error)}</p><button type="button" onClick={() => { setError(''); setAnswers(null); setAttempt((value) => value + 1); }}>{t("Opnieuw proberen")}</button></div>
      : answers === null ? <p role="status">{t("Vergelijkbare vragen laden…")}</p>
        : answers.length === 0 ? <p className="muted">{t("Geen vergelijkbare eerdere vragen gevonden.")}</p>
          : <ul>{answers.map((item) => <li key={item.id}><Link href={`/geschiedenis/${encodeURIComponent(item.id)}`}>{item.question}</Link> <StatusBadge status={item.status} /><p className="muted">{dateTimeLabel(item.createdAt, locale)} · {item.checkedCount}/{item.citationCount}{' '}{t("passages gecontroleerd")}</p></li>)}</ul>}
  </section>;
}

export function HistoryDetail({ answer, onExport, busy }: { answer: Answer; onExport: () => Promise<void>; busy: boolean }) {
  const { t, locale } = useLocale();
  const scope = answer.scopeSourceIds;
  const effortLabel = answer.effort === null ? t("Niet ingesteld") : { none: t("Geen"), low: t("Laag"), medium: t("Gemiddeld"), high: t("Hoog"), xhigh: t("Extra hoog") }[answer.effort];
  return <div className="history-details">
    <section className="card"><h2>{t("Verloop")}</h2>
      {answer.events.length === 0 ? <p className="muted">{t("Er zijn nog geen gebeurtenissen vastgelegd.")}</p> : <ol className="timeline">{[...answer.events].sort((a, b) => a.at.localeCompare(b.at)).map((event, index) => <li key={`${event.at}-${event.type}-${index}`}><strong>{t(eventLabels[event.type])}</strong><p className="muted"><time dateTime={event.at}>{dateTimeLabel(event.at, locale)}</time></p>{event.detail && <p className="answer-text">{translateEventDetail(event.detail, event.type, locale)}</p>}</li>)}</ol>}
    </section>
    <section className="card technical-details"><details><summary>{t("Technische details")}</summary>
      <dl><dt>{t("Aanbieder en model")}</dt><dd>{t(providerLabels[answer.provider])} · {answer.model}</dd><dt>{t("Redeneerinspanning")}</dt><dd>{effortLabel}</dd><dt>{t("Passages naar het model")}</dt><dd>{answer.passagesSent}</dd><dt>{t("Gebruikte bronnen")}</dt><dd>{answer.sourcesUsed}</dd><dt>{t("Zinnen zonder bronverwijzing")}</dt><dd>{answer.uncitedSentences}</dd><dt>{t("Aangemaakt")}</dt><dd>{dateTimeLabel(answer.createdAt, locale)}</dd><dt>{t("Laatst gewijzigd")}</dt><dd>{dateTimeLabel(answer.updatedAt, locale)}</dd></dl>
      <h3>{t("Bronselectie bij deze vraag")}</h3>
      {scope === null ? <p>{t("Alle ingeschakelde bronnen waren beschikbaar.")}</p> : scope.length === 0 ? <p>{t("Geen bronnen geselecteerd.")}</p> : <><p>{t("Beperkt tot")}{' '}{scope.length} {scope.length === 1 ? t("bron") : t("bronnen")}.</p><ul>{scope.map((id) => <li key={id}><Link href={`/bronnen/${encodeURIComponent(id)}`}>{answer.citations.find((citation) => citation.sourceId === id)?.sourceTitle ?? id}</Link></li>)}</ul></>}
      <h3>{t("Passages die aan het model zijn meegegeven")}</h3>
      {answer.passagesSentList === undefined ? <p className="muted">{t("De passagelijst is voor dit antwoord niet opgeslagen.")}</p> : answer.passagesSentList.length === 0 ? <p>{t("Geen passages meegegeven.")}</p> : <ul>{answer.passagesSentList.map((passage) => <li key={passage.passageId}><strong>{passage.label}</strong> · {passage.sourceTitle} · p. {passage.pageStart} <Badge tone={passage.cited ? 'green' : 'neutral'}>{passage.cited ? t("Geciteerd") : t("Niet geciteerd")}</Badge><p className="muted">{t("Passage-ID:")}{' '}{passage.passageId}</p></li>)}</ul>}
      <details><summary>{t("Opgeslagen prompt")}</summary>{answer.promptSnapshot ? <pre className="prompt-snapshot">{answer.promptSnapshot}</pre> : <p className="muted">{t("Er is geen prompt opgeslagen bij dit antwoord.")}</p>}</details>
      <p className="muted">{t("Antwoord-ID:")}{' '}{answer.id}</p>
    </details><button type="button" onClick={() => void onExport()} disabled={busy}>{t("Exporteer JSON")}</button></section>
    <SimilarAnswers key={answer.id} question={answer.question} answerId={answer.id} />
  </div>;
}

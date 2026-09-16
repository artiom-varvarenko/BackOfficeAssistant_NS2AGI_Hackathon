'use client';

import Link from 'next/link';
import type { Answer } from '@/lib/types';
import { safeSourceUrl } from '@/lib/api-client';
import { ApplicabilityBadge, Badge, dateLabel, levelLabels, StatusBadge } from './Badge';
import { dateTimeLabel } from './HistoryDetail';

export function BriefingView({ answer }: { answer: Answer }) {
  const sources = answer.citations.filter((citation, index, all) => all.findIndex((item) => item.versionId === citation.versionId) === index);
  const checked = answer.citations.filter((citation) => citation.checked).length;
  const uncertainties: Array<{ title: string; items: string[] }> = [
    { title: 'Ontbreekt in de bronnen', items: answer.gaps },
    { title: 'Waarschuwingen over toepasselijkheid', items: answer.warnings },
    { title: 'Tegenstrijdige passages', items: answer.conflicts },
  ];

  return <article className="briefing-view">
    <div className="actions print-hidden"><button type="button" className="primary" onClick={() => window.print()}>Afdrukken / Opslaan als PDF</button><Link href={`/geschiedenis/${encodeURIComponent(answer.id)}`}>← Terug</Link></div>
    <header className="page-heading"><div><p className="eyebrow">ECONOMIE-ASSISTENT</p><h1>Ambtenarenbriefing</h1><p>Gebaseerd op het opgeslagen antwoord van {dateTimeLabel(answer.createdAt)}.</p></div><StatusBadge status={answer.status} /></header>
    {(answer.sourcesChangedSince || answer.citations.some((citation) => !citation.sourceEnabled || !citation.isCurrentVersion)) && <p className="notice notice-amber">Sinds dit antwoord zijn bronnen gewijzigd. Deze briefing bewaart de tekst en bronpassages die bij dit antwoord zijn opgeslagen.</p>}
    <section className="card"><h2>Vraag</h2><p className="answer-text">{answer.question}</p>
      {answer.scopeSourceIds !== null && <p className="muted">Beperkt tot {answer.scopeSourceIds.length} {answer.scopeSourceIds.length === 1 ? 'bron' : 'bronnen'}.</p>}
    </section>
    <section className="card"><h2>Bevinding</h2>
      {answer.reviewedAt === null && <p className="notice notice-amber">Niet beoordeeld — controle door de medewerker is nog nodig.</p>}
      {answer.status === 'rejected' && <p className="notice notice-red">Dit antwoord is afgewezen door de medewerker.</p>}
      <div className="answer-text">{answer.reviewedAnswer ?? answer.generatedAnswer}</div>
    </section>
    <section className="card"><h2>Bewijs</h2>
      {answer.citations.length === 0 ? <p>Er zijn geen bronpassages opgeslagen bij dit antwoord.</p> : answer.citations.map((citation) => <div className="briefing-evidence" key={citation.marker}>
        <h3>[{citation.marker}] {citation.sourceTitle}</h3>
        <blockquote className="quote">{citation.highlight && citation.quoteText.includes(citation.highlight) ? citation.highlight : citation.quoteText}</blockquote>
        <p>{citation.checked ? `Gecontroleerd${citation.checkedAt ? ` op ${dateTimeLabel(citation.checkedAt)}` : ''}` : 'Nog niet gecontroleerd'}</p>
        {citation.checkNote && <p>Opmerking bij controle: {citation.checkNote}</p>}
      </div>)}
    </section>
    <section className="card"><h2>Bron openen</h2>
      {answer.citations.length === 0 ? <p>Geen bronverwijzingen beschikbaar.</p> : <ul>{answer.citations.map((citation) => {
        const pdfUrl = safeSourceUrl(citation.pdfUrl, true);
        const originalUrl = safeSourceUrl(citation.originalUrl);
        return <li key={citation.marker}>
        <strong>[{citation.marker}] {citation.sourceTitle}</strong> — {[citation.article, citation.section].filter(Boolean).join(' ') || 'Passage'} — p. {citation.pageStart}{citation.pageEnd !== citation.pageStart && `–${citation.pageEnd}`}
        <div className="source-links">{pdfUrl ? <a href={pdfUrl} target="_blank" rel="noopener noreferrer">Open PDF op p. {citation.pageStart}</a> : <span>PDF niet beschikbaar</span>}{citation.originalUrl && (originalUrl ? <a href={originalUrl} target="_blank" rel="noopener noreferrer">Originele bron</a> : <span>Originele bron niet beschikbaar</span>)}</div>
        <p className="source-address">{originalUrl ?? pdfUrl ?? 'Bronlink niet beschikbaar'}</p>
      </li>; })}</ul>}
    </section>
    <section className="card"><h2>Toepasselijkheid</h2>
      {sources.length === 0 ? <p>Geen bronnen om te beoordelen.</p> : sources.map((source) => <div className="briefing-source" key={source.versionId}>
        <h3>{source.sourceTitle}</h3>
        <p>{levelLabels[source.level]} · {source.authority ?? 'Instantie niet vermeld'} · {source.versionLabel ?? 'Versie niet vermeld'} · {source.documentDate ? dateLabel(source.documentDate) : 'Datum onbekend'}</p>
        <div className="badges"><ApplicabilityBadge value={source.applicability} verifiedAt={source.verifiedAt} />{!source.sourceEnabled && <Badge>Bron uitgeschakeld</Badge>}{!source.isCurrentVersion && source.applicability !== 'superseded' && <Badge>Vervangen door nieuwere versie</Badge>}</div>
        <p>Opmerking medewerker: {source.applicabilityNote ?? 'Geen opmerking vastgelegd.'}</p>
        <p className="muted">Versie-ID: {source.versionId}</p>
      </div>)}
    </section>
    <section className="card"><h2>Onzekerheid</h2>
      {uncertainties.map(({ title, items }) => <div key={title}><h3>{title}</h3>{items.length === 0 ? <p className="muted">Geen vastgelegd.</p> : <ul>{items.map((item, index) => <li key={index}>{item}</li>)}</ul>}</div>)}
      {answer.uncitedSentences > 0 && <p className="notice notice-amber">{answer.uncitedSentences} zin(nen) zonder bronverwijzing — extra controleren.</p>}
    </section>
    <section className="card"><h2>Beoordeling medewerker</h2><StatusBadge status={answer.status} /><p>{checked}/{answer.citations.length} passages gecontroleerd</p><p className="answer-text">Opmerking: {answer.reviewNote ?? 'Geen opmerking vastgelegd.'}</p>
      <dl><dt>Aangemaakt</dt><dd>{dateTimeLabel(answer.createdAt)}</dd><dt>Laatst gewijzigd</dt><dd>{dateTimeLabel(answer.updatedAt)}</dd><dt>Beoordeeld</dt><dd>{answer.reviewedAt ? dateTimeLabel(answer.reviewedAt) : 'Nog niet beoordeeld'}</dd></dl>
      <p className="muted">Antwoord-ID: {answer.id}</p>
    </section>
  </article>;
}

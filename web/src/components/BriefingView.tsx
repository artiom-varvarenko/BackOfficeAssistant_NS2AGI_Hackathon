'use client';

import { useLocale } from './LanguageProvider';

import Link from 'next/link';
import type { Answer } from '@/lib/types';
import { safeSourceUrl } from '@/lib/api-client';
import { ApplicabilityBadge, Badge, dateLabel, levelLabels, StatusBadge } from './Badge';
import { dateTimeLabel } from './HistoryDetail';

export function BriefingView({ answer }: { answer: Answer }) {
  const { t, locale } = useLocale();
  const sources = answer.citations.filter((citation, index, all) => all.findIndex((item) => item.versionId === citation.versionId) === index);
  const checked = answer.citations.filter((citation) => citation.checked).length;
  const uncertainties: Array<{ title: string; items: string[] }> = [
    { title: t("Ontbreekt in de bronnen"), items: answer.gaps },
    { title: t("Waarschuwingen over toepasselijkheid"), items: answer.warnings },
    { title: t("Tegenstrijdige passages"), items: answer.conflicts },
  ];

  return <article className="briefing-view">
    <div className="actions print-hidden"><button type="button" className="primary" onClick={() => window.print()}>{t("Afdrukken / Opslaan als PDF")}</button><Link href={`/geschiedenis/${encodeURIComponent(answer.id)}`}>{t("← Terug")}</Link></div>
    <header className="page-heading"><div><p className="eyebrow">{t("ECONOMIE-ASSISTENT")}</p><h1>{t("Ambtenarenbriefing")}</h1><p>{t("Gebaseerd op het opgeslagen antwoord van")}{' '}{dateTimeLabel(answer.createdAt, locale)}.</p></div><StatusBadge status={answer.status} /></header>
    {(answer.sourcesChangedSince || answer.citations.some((citation) => !citation.sourceEnabled || !citation.isCurrentVersion)) && <p className="notice notice-amber">{t("Sinds dit antwoord zijn bronnen gewijzigd. Deze briefing bewaart de tekst en bronpassages die bij dit antwoord zijn opgeslagen.")}</p>}
    <section className="card"><h2>{t("Vraag")}</h2><p className="answer-text">{answer.question}</p>
      {answer.scopeSourceIds !== null && <p className="muted">{t("Beperkt tot")}{' '}{answer.scopeSourceIds.length} {answer.scopeSourceIds.length === 1 ? t("bron") : t("bronnen")}.</p>}
    </section>
    <section className="card"><h2>{t("Bevinding")}</h2>
      {answer.reviewedAt === null && <p className="notice notice-amber">{t("Niet beoordeeld — controle door de medewerker is nog nodig.")}</p>}
      {answer.status === 'rejected' && <p className="notice notice-red">{t("Dit antwoord is afgewezen door de medewerker.")}</p>}
      <div className="answer-text">{answer.reviewedAnswer ?? answer.generatedAnswer}</div>
    </section>
    <section className="card"><h2>{t("Bewijs")}</h2>
      {answer.citations.length === 0 ? <p>{t("Er zijn geen bronpassages opgeslagen bij dit antwoord.")}</p> : answer.citations.map((citation) => <div className="briefing-evidence" key={citation.marker}>
        <h3>[{citation.marker}] {citation.sourceTitle}</h3>
        <blockquote className="quote">{citation.highlight && citation.quoteText.includes(citation.highlight) ? citation.highlight : citation.quoteText}</blockquote>
        <p>{citation.checked ? citation.checkedAt ? t('Gecontroleerd op {date}', { date: dateTimeLabel(citation.checkedAt, locale) }) : t('Gecontroleerd') : t("Nog niet gecontroleerd")}</p>
        {citation.checkNote && <p>{t("Opmerking bij controle:")}{' '}{citation.checkNote}</p>}
      </div>)}
    </section>
    <section className="card"><h2>{t("Bron openen")}</h2>
      {answer.citations.length === 0 ? <p>{t("Geen bronverwijzingen beschikbaar.")}</p> : <ul>{answer.citations.map((citation) => {
        const pdfUrl = safeSourceUrl(citation.pdfUrl, true);
        const originalUrl = safeSourceUrl(citation.originalUrl);
        return <li key={citation.marker}>
        <strong>[{citation.marker}] {citation.sourceTitle}</strong> — {[citation.article, citation.section].filter(Boolean).join(' ') || t("Passage")} — p. {citation.pageStart}{citation.pageEnd !== citation.pageStart && `–${citation.pageEnd}`}
        <div className="source-links">{pdfUrl ? <a href={pdfUrl} target="_blank" rel="noopener noreferrer">{t("Open PDF op p.")}{' '}{citation.pageStart}</a> : <span>{t("PDF niet beschikbaar")}</span>}{citation.originalUrl && (originalUrl ? <a href={originalUrl} target="_blank" rel="noopener noreferrer">{t("Originele bron")}</a> : <span>{t("Originele bron niet beschikbaar")}</span>)}</div>
        <p className="source-address">{originalUrl ?? pdfUrl ?? t("Bronlink niet beschikbaar")}</p>
      </li>; })}</ul>}
    </section>
    <section className="card"><h2>{t("Toepasselijkheid")}</h2>
      {sources.length === 0 ? <p>{t("Geen bronnen om te beoordelen.")}</p> : sources.map((source) => <div className="briefing-source" key={source.versionId}>
        <h3>{source.sourceTitle}</h3>
        <p>{t(levelLabels[source.level])} · {source.authority ?? t("Instantie niet vermeld")} · {source.versionLabel ?? t("Versie niet vermeld")} · {source.documentDate ? dateLabel(source.documentDate, locale) : t("Datum onbekend")}</p>
        <div className="badges"><ApplicabilityBadge value={source.applicability} verifiedAt={source.verifiedAt} />{!source.sourceEnabled && <Badge>{t("Bron uitgeschakeld")}</Badge>}{!source.isCurrentVersion && source.applicability !== 'superseded' && <Badge>{t("Vervangen door nieuwere versie")}</Badge>}</div>
        <p>{t("Opmerking medewerker:")}{' '}{source.applicabilityNote ?? t("Geen opmerking vastgelegd.")}</p>
        <p className="muted">{t("Versie-ID:")}{' '}{source.versionId}</p>
      </div>)}
    </section>
    <section className="card"><h2>{t("Onzekerheid")}</h2>
      {uncertainties.map(({ title, items }) => <div key={title}><h3>{title}</h3>{items.length === 0 ? <p className="muted">{t("Geen vastgelegd.")}</p> : <ul>{items.map((item, index) => <li key={index}>{t(item)}</li>)}</ul>}</div>)}
      {answer.uncitedSentences > 0 && <p className="notice notice-amber">{answer.uncitedSentences}{' '}{t("zin(nen) zonder bronverwijzing — extra controleren.")}</p>}
    </section>
    <section className="card"><h2>{t("Beoordeling medewerker")}</h2><StatusBadge status={answer.status} /><p>{checked}/{answer.citations.length}{' '}{t("passages gecontroleerd")}</p><p className="answer-text">{t("Opmerking:")}{' '}{answer.reviewNote ?? t("Geen opmerking vastgelegd.")}</p>
      <dl><dt>{t("Aangemaakt")}</dt><dd>{dateTimeLabel(answer.createdAt, locale)}</dd><dt>{t("Laatst gewijzigd")}</dt><dd>{dateTimeLabel(answer.updatedAt, locale)}</dd><dt>{t("Beoordeeld")}</dt><dd>{answer.reviewedAt ? dateTimeLabel(answer.reviewedAt, locale) : t("Nog niet beoordeeld")}</dd></dl>
      <p className="muted">{t("Antwoord-ID:")}{' '}{answer.id}</p>
    </section>
  </article>;
}

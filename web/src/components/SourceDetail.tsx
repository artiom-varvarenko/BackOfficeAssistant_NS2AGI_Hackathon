'use client';

import { useLocale } from './LanguageProvider';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';
import { embedSource, generateSourceSummary, getSource, getSourcePassages, safeSourceUrl, updateSource } from '@/lib/api-client';
import type { Passage, Source } from '@/lib/types';
import { ApplicabilityBadge, Badge, dateLabel, levelLabels } from './Badge';
import { ApplicabilityForm } from './ApplicabilityForm';
import { SourceForm, sourceError, sourceTypeLabels } from './SourceForm';
import { SourceProcessingStatus, VersionHistory } from './SourceTable';
import { VersionUploadForm } from './VersionUploadForm';
import { useToast } from './Toast';

function PassageCard({ passage }: { passage: Passage }) {
  const { t } = useLocale();
  const [expanded, setExpanded] = useState(false);
  const pdfUrl = safeSourceUrl(passage.pdfUrl, true);
  const textId = `passage-${passage.id}-text`;
  return <article className="citation-card" id={`passage-${passage.id}`}>
    <h3>{t("Passage")}{' '}{passage.ordinal} · {passage.article ?? t("Zonder artikelaanduiding")}{passage.section ? ` · ${passage.section}` : ''}</h3>
    <p className="muted">p. {passage.pageStart}{passage.pageEnd !== passage.pageStart ? `–${passage.pageEnd}` : ''}</p>
    <p className="quote" id={textId}>{expanded || passage.text.length <= 300 ? passage.text : `${passage.text.slice(0, 300)}…`}</p>
    <div className="source-links">{pdfUrl ? <a href={pdfUrl} target="_blank" rel="noopener noreferrer">{t("Open PDF op p.")}{' '}{passage.pageStart} ↗</a> : <span className="muted">{t("PDF niet beschikbaar.")}</span>}
      {passage.text.length > 300 && <button className="text-button" type="button" onClick={() => setExpanded(!expanded)} aria-expanded={expanded} aria-controls={textId}>{expanded ? t("Toon minder") : t("Toon volledig")}<span className="sr-only">{t(": passage")}{' '}{passage.ordinal}</span></button>}
    </div>
  </article>;
}

function SourcePassages({ source }: { source: Source }) {
  const { t } = useLocale();
  const [passages, setPassages] = useState<Passage[] | null>(null);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true;
    getSourcePassages(source.id).then((result) => { if (alive) setPassages(result.sort((a, b) => a.ordinal - b.ordinal)); })
      .catch((failure) => { if (alive) setError(sourceError(failure)); });
    return () => { alive = false; };
  }, [source.id, attempt]);
  const words = query.toLocaleLowerCase('nl-BE').trim().split(/\s+/).filter(Boolean);
  const filtered = passages?.filter((passage) => {
    const text = `${passage.article ?? ''} ${passage.section ?? ''} ${passage.text}`.toLocaleLowerCase('nl-BE');
    return words.every((word) => text.includes(word));
  });
  return <section className="card passage-list">
    <h2>{t("Passages")}</h2><p className="muted">{t("Opgeslagen passages uit de huidige versie van deze bron.")}</p>
    <label className="field">{t("Zoek in dit document")}<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("Filter op woorden, artikel of paragraaf")} /></label>
    {error ? <div className="notice notice-red" role="alert"><p>{t("Passages konden niet worden geladen.")}{' '}{t(error)}</p><button onClick={() => { setError(''); setAttempt((value) => value + 1); }}>{t("Opnieuw proberen")}</button></div>
      : passages === null ? <p role="status">{t("Passages laden…")}</p>
        : !passages.length ? <p>{source.currentVersion?.processingStatus === 'processing' ? t("De bron wordt nog verwerkt. Vernieuw de bron zodra de verwerking klaar is.") : t("Geen passages beschikbaar voor deze versie.")}</p>
          : <><p className="muted" role="status">{filtered?.length}{' '}{t("van")}{' '}{passages.length}{' '}{t("passages")}{query.trim() ? t(' voor “{query}”', { query: query.trim() }) : ''}</p>{!filtered?.length && <p>{t("Geen passages komen overeen met deze zoekwoorden.")}</p>}{filtered?.map((passage) => <PassageCard key={passage.id} passage={passage} />)}</>}
  </section>;
}

export function SourceDetail({ sourceId }: { sourceId: string }) {
  const { t, locale } = useLocale();
  const toast = useToast();
  const [source, setSource] = useState<Source | null>(null);
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [operation, setOperation] = useState<'summary' | 'embed' | null>(null);
  const [refreshing, setRefreshing] = useState(true);
  const [panel, setPanel] = useState<'edit' | 'version' | 'applicability' | null>(null);
  const panelId = useId();
  const panelTrigger = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (panel === null) {
      panelTrigger.current?.focus();
      panelTrigger.current = null;
    }
  }, [panel]);
  const request = useRef(0);
  const load = useCallback(() => {
    const current = ++request.current;
    return getSource(sourceId)
      .then((value) => { if (current === request.current) { setSource(value); setLoadError(''); } })
      .catch((failure) => { if (current === request.current) setLoadError(sourceError(failure)); })
      .finally(() => { if (current === request.current) setRefreshing(false); });
  }, [sourceId]);
  const refresh = useCallback(() => {
    setRefreshing(true); setLoadError('');
    return load();
  }, [load]);
  useEffect(() => {
    const activeRequests = request;
    void load();
    return () => { activeRequests.current++; };
  }, [load]);
  const processing = source?.versions.some((version) => version.processingStatus === 'processing') ?? false;
  useEffect(() => {
    if (!processing) return;
    const timer = window.setInterval(() => { void refresh(); }, 3000);
    return () => window.clearInterval(timer);
  }, [processing, refresh]);
  function invalidateRefresh() { request.current++; setRefreshing(false); }
  function saved(value: Source) { invalidateRefresh(); setSource(value); setPanel(null); setError(''); setNotice(t("Bron bijgewerkt.")); toast(t("Bron bijgewerkt.")); }
  function openPanel(value: 'edit' | 'version' | 'applicability', trigger: HTMLButtonElement) {
    panelTrigger.current = trigger; setPanel(value); setError(''); setNotice('');
  }
  async function toggle() {
    if (!source || busy) return;
    setBusy(true); setError(''); setNotice(''); invalidateRefresh();
    try { const value = await updateSource(source.id, { enabled: !source.enabled }); saved(value); setNotice(value.enabled ? t("Bron ingeschakeld.") : t("Bron uitgeschakeld. Eerdere antwoorden behouden hun bewijs.")); }
    catch (failure) { setError(sourceError(failure)); }
    finally { setBusy(false); }
  }
  async function derive(kind: 'summary' | 'embed') {
    if (!source || busy) return;
    setBusy(true); setOperation(kind); setError(''); setNotice(''); invalidateRefresh();
    try {
      let message: string;
      if (kind === 'summary') {
        const value = await generateSourceSummary(source.id);
        invalidateRefresh(); setSource(value);
        message = t("Samenvatting gegenereerd.");
      } else {
        const result = await embedSource(source.id);
        message = t('Embeddings berekend voor {n} passages.', { n: result.embedded });
      }
      setNotice(message); toast(message);
    } catch (failure) { setError(sourceError(failure)); }
    finally { setBusy(false); setOperation(null); }
  }
  const version = source?.currentVersion;
  const pdfUrl = safeSourceUrl(version?.pdfUrl, true);
  const originalUrl = safeSourceUrl(source?.originalUrl);
  return <>
    <p><Link href="/bronnen">{t("← Terug naar Bronnen")}</Link></p>
    {loadError && <section className="card notice-red" role="alert">{source ? <h2>{t("Bron kon niet worden vernieuwd")}</h2> : <h1>{t("Bron kon niet worden geladen")}</h1>}<p>{t(loadError)}</p><button onClick={() => { void refresh(); }}>{t("Opnieuw proberen")}</button></section>}
    {!source && !loadError && <p className="card" role="status">{t("Bron laden…")}</p>}
    {source && <>
      <div className="page-heading"><div><h1>{source.title}</h1><p>{source.authority ?? t("Uitgevende instantie onbekend")}</p></div><button onClick={() => { void refresh(); }} disabled={refreshing || busy || panel !== null}>{refreshing ? t("Vernieuwen…") : t("Vernieuwen")}</button></div>
      <section className="card">
        <h2>{t("Brongegevens")}</h2>
        <div className="badges"><Badge>{t(levelLabels[source.level])}</Badge><Badge>{t(sourceTypeLabels[source.docType])}</Badge><Badge tone={source.enabled ? 'green' : 'neutral'}>{source.enabled ? t("Ingeschakeld") : t("Uitgeschakeld")}</Badge>{version && <ApplicabilityBadge value={version.applicability} verifiedAt={version.verifiedAt} />}{!version?.documentDate && <Badge tone="amber">{t("Datum onbekend")}</Badge>}</div>
        <p>{t("Toepassingsgebied:")}{' '}{source.scope ?? t("Niet opgegeven")}</p>
        {version && <><p>{t("Versie")}{' '}{version.versionNo} · {version.versionLabel ?? t("Geen versielabel")} · {version.documentDate ? dateLabel(version.documentDate, locale) : t("Datum onbekend")}</p><p>{t("Geldig van:")}{' '}{version.validFrom ? dateLabel(version.validFrom, locale) : t("Niet opgegeven")}{' '}{t("· Geldig tot:")}{' '}{version.validUntil ? dateLabel(version.validUntil, locale) : t("Niet opgegeven")}</p>{version.applicabilityNote && <p>{t("Toelichting:")}{' '}{version.applicabilityNote}</p>}</>}
        <SourceProcessingStatus version={version ?? null} />
        <div className="source-links">{version && (pdfUrl ? <a href={pdfUrl} target="_blank" rel="noopener noreferrer">{t("Open PDF ↗")}</a> : <span className="muted">{t("PDF niet beschikbaar.")}</span>)}{source.originalUrl && (originalUrl ? <a href={originalUrl} target="_blank" rel="noopener noreferrer">{t("Originele bron ↗")}</a> : <span className="muted">{t("Originele bron niet beschikbaar.")}</span>)}</div>
        <div className="actions"><button onClick={(event) => openPanel('edit', event.currentTarget)} disabled={busy || panel !== null} aria-expanded={panel === 'edit'} aria-controls={panel === 'edit' ? panelId : undefined}>{t("Bewerken")}</button><button onClick={(event) => openPanel('version', event.currentTarget)} disabled={busy || panel !== null} aria-expanded={panel === 'version'} aria-controls={panel === 'version' ? panelId : undefined}>{t("Nieuwe versie")}</button>{version && <button onClick={(event) => openPanel('applicability', event.currentTarget)} disabled={busy || panel !== null} aria-expanded={panel === 'applicability'} aria-controls={panel === 'applicability' ? panelId : undefined}>{t("Toepasselijkheid wijzigen")}</button>}<button onClick={toggle} disabled={busy || panel !== null}>{busy ? t("Opslaan…") : source.enabled ? t("Bron uitschakelen") : t("Bron inschakelen")}</button></div>
        <VersionHistory source={source} />
      </section>
      {panel && <section className="card" id={panelId}>
        {panel === 'edit' && <SourceForm mode="edit" source={source} onSaved={saved} onCancel={() => setPanel(null)} onStart={invalidateRefresh} />}
        {panel === 'version' && <VersionUploadForm source={source} onSaved={saved} onCancel={() => setPanel(null)} onFailure={() => { void refresh(); }} onStart={invalidateRefresh} />}
        {panel === 'applicability' && version && <ApplicabilityForm source={source} version={version} onSaved={saved} onCancel={() => setPanel(null)} onStart={invalidateRefresh} />}
      </section>}
      {notice && <p className="save-status" role="status" aria-live="polite">{t(notice)}</p>}
      {error && <p className="notice notice-red" role="alert">{t(error)}</p>}
      <section className="card" id="samenvatting">
        <h2>{t("Samenvatting")}</h2>
        {source.summary ? <p className="answer-text">{source.summary}</p> : <p className="muted">{t("Nog geen samenvatting voor deze bron.")}</p>}
        <p className="muted">{t("De samenvatting helpt om de inhoud te verkennen. De opgeslagen passages vormen het bewijs bij antwoorden.")}</p>
        <div className="actions"><button onClick={() => { void derive('summary'); }} disabled={busy || panel !== null || version?.processingStatus !== 'ready'}>{operation === 'summary' ? t("Samenvatting genereren…") : t("Samenvatting genereren")}</button><button onClick={() => { void derive('embed'); }} disabled={busy || panel !== null || version?.processingStatus !== 'ready'}>{operation === 'embed' ? t("Embeddings berekenen…") : t("Embeddings berekenen")}</button></div>
        <p className="muted">{t("Embeddings maken zoeken op betekenis mogelijk. Kies hybride zoeken in")}{' '}<Link href="/instellingen">{t("Instellingen")}</Link>.</p>
        {operation && <p role="status" aria-live="polite">{operation === 'summary' ? t("De samenvatting wordt opgesteld…") : t("De passages worden voorbereid voor zoeken op betekenis…")}</p>}
      </section>
      <SourcePassages key={`${source.id}:${version?.id}:${version?.processingStatus}`} source={source} />
    </>}
  </>;
}

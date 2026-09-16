'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { embedSource, generateSourceSummary, getSource, getSourcePassages, updateSource } from '@/lib/api-client';
import type { Passage, Source } from '@/lib/types';
import { ApplicabilityBadge, Badge, dateLabel, levelLabels } from './Badge';
import { ApplicabilityForm } from './ApplicabilityForm';
import { SourceForm, sourceError, sourceTypeLabels } from './SourceForm';
import { SourceProcessingStatus, VersionHistory } from './SourceTable';
import { VersionUploadForm } from './VersionUploadForm';
import { useToast } from './Toast';

function PassageCard({ passage }: { passage: Passage }) {
  const [expanded, setExpanded] = useState(false);
  return <article className="citation-card" id={`passage-${passage.id}`}>
    <h3>Passage {passage.ordinal} · {passage.article ?? 'Zonder artikelaanduiding'}{passage.section ? ` · ${passage.section}` : ''}</h3>
    <p className="muted">p. {passage.pageStart}{passage.pageEnd !== passage.pageStart ? `–${passage.pageEnd}` : ''}</p>
    <p className="quote">{expanded || passage.text.length <= 300 ? passage.text : `${passage.text.slice(0, 300)}…`}</p>
    <div className="source-links"><a href={passage.pdfUrl} target="_blank" rel="noopener noreferrer">Open PDF op p. {passage.pageStart} ↗</a>
      {passage.text.length > 300 && <button className="text-button" type="button" onClick={() => setExpanded(!expanded)} aria-expanded={expanded}>{expanded ? 'Toon minder' : 'Toon volledig'}</button>}
    </div>
  </article>;
}

function SourcePassages({ source }: { source: Source }) {
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
    <h2>Passages</h2><p className="muted">Opgeslagen passages uit de huidige versie van deze bron.</p>
    <label className="field">Zoek in dit document<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter op woorden, artikel of paragraaf" /></label>
    {error ? <div className="notice notice-red" role="alert"><p>Passages konden niet worden geladen. {error}</p><button onClick={() => { setError(''); setAttempt((value) => value + 1); }}>Opnieuw proberen</button></div>
      : passages === null ? <p role="status">Passages laden…</p>
        : !passages.length ? <p>{source.currentVersion?.processingStatus === 'processing' ? 'De bron wordt nog verwerkt. Vernieuw de bron zodra de verwerking klaar is.' : 'Geen passages beschikbaar voor deze versie.'}</p>
          : <><p className="muted" role="status">{filtered?.length} van {passages.length} passages{query.trim() ? ` voor “${query.trim()}”` : ''}</p>{!filtered?.length && <p>Geen passages komen overeen met deze zoekwoorden.</p>}{filtered?.map((passage) => <PassageCard key={passage.id} passage={passage} />)}</>}
  </section>;
}

export function SourceDetail({ sourceId }: { sourceId: string }) {
  const toast = useToast();
  const [source, setSource] = useState<Source | null>(null);
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [operation, setOperation] = useState<'summary' | 'embed' | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [panel, setPanel] = useState<'edit' | 'version' | 'applicability' | null>(null);
  const request = useRef(0);
  const refresh = useCallback(async () => {
    const current = ++request.current;
    setRefreshing(true); setLoadError('');
    try { const value = await getSource(sourceId); if (current === request.current) setSource(value); }
    catch (failure) { if (current === request.current) setLoadError(sourceError(failure)); }
    finally { if (current === request.current) setRefreshing(false); }
  }, [sourceId]);
  useEffect(() => { void refresh(); return () => { request.current++; }; }, [refresh]);
  const processing = source?.currentVersion?.processingStatus === 'processing';
  useEffect(() => {
    if (!processing) return;
    const timer = window.setInterval(() => { void refresh(); }, 3000);
    return () => window.clearInterval(timer);
  }, [processing, refresh]);
  function invalidateRefresh() { request.current++; setRefreshing(false); }
  function saved(value: Source) { invalidateRefresh(); setSource(value); setPanel(null); setError(''); setNotice('Bron bijgewerkt.'); toast('Bron bijgewerkt.'); }
  async function toggle() {
    if (!source || busy) return;
    setBusy(true); setError(''); setNotice(''); invalidateRefresh();
    try { const value = await updateSource(source.id, { enabled: !source.enabled }); saved(value); setNotice(value.enabled ? 'Bron ingeschakeld.' : 'Bron uitgeschakeld. Eerdere antwoorden behouden hun bewijs.'); }
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
        message = 'Samenvatting gegenereerd.';
      } else {
        const result = await embedSource(source.id);
        message = `Embeddings berekend voor ${result.embedded} passages.`;
      }
      setNotice(message); toast(message);
    } catch (failure) { setError(sourceError(failure)); }
    finally { setBusy(false); setOperation(null); }
  }
  const version = source?.currentVersion;
  return <>
    <p><Link href="/bronnen">← Terug naar Bronnen</Link></p>
    {loadError && <section className="card notice-red" role="alert"><h1>Bron kon niet worden geladen</h1><p>{loadError}</p><button onClick={() => { void refresh(); }}>Opnieuw proberen</button></section>}
    {!source && !loadError && <p className="card" role="status">Bron laden…</p>}
    {source && <>
      <div className="page-heading"><div><h1>{source.title}</h1><p>{source.authority ?? 'Uitgevende instantie onbekend'}</p></div><button onClick={() => { void refresh(); }} disabled={refreshing || busy || panel !== null}>{refreshing ? 'Vernieuwen…' : 'Vernieuwen'}</button></div>
      <section className="card">
        <h2>Brongegevens</h2>
        <div className="badges"><Badge>{levelLabels[source.level]}</Badge><Badge>{sourceTypeLabels[source.docType]}</Badge><Badge tone={source.enabled ? 'green' : 'neutral'}>{source.enabled ? 'Ingeschakeld' : 'Uitgeschakeld'}</Badge>{version && <ApplicabilityBadge value={version.applicability} verifiedAt={version.verifiedAt} />}{!version?.documentDate && <Badge tone="amber">Datum onbekend</Badge>}</div>
        <p>Toepassingsgebied: {source.scope ?? 'Niet opgegeven'}</p>
        {version && <><p>Versie {version.versionNo} · {version.versionLabel ?? 'Geen versielabel'} · {version.documentDate ? dateLabel(version.documentDate) : 'Datum onbekend'}</p><p>Geldig van: {version.validFrom ? dateLabel(version.validFrom) : 'Niet opgegeven'} · Geldig tot: {version.validUntil ? dateLabel(version.validUntil) : 'Niet opgegeven'}</p>{version.applicabilityNote && <p>Toelichting: {version.applicabilityNote}</p>}</>}
        <SourceProcessingStatus version={version ?? null} />
        <div className="source-links">{version && <a href={version.pdfUrl} target="_blank" rel="noopener noreferrer">Open PDF ↗</a>}{source.originalUrl && /^https?:\/\//i.test(source.originalUrl) && <a href={source.originalUrl} target="_blank" rel="noopener noreferrer">Originele bron ↗</a>}</div>
        <div className="actions"><button onClick={() => setPanel('edit')} disabled={busy || panel !== null}>Bewerken</button><button onClick={() => setPanel('version')} disabled={busy || panel !== null}>Nieuwe versie</button>{version && <button onClick={() => setPanel('applicability')} disabled={busy || panel !== null}>Toepasselijkheid wijzigen</button>}<button onClick={toggle} disabled={busy || panel !== null}>{busy ? 'Opslaan…' : source.enabled ? 'Bron uitschakelen' : 'Bron inschakelen'}</button></div>
        <VersionHistory source={source} />
      </section>
      {panel && <section className="card">
        {panel === 'edit' && <SourceForm mode="edit" source={source} onSaved={saved} onCancel={() => setPanel(null)} onStart={invalidateRefresh} />}
        {panel === 'version' && <VersionUploadForm source={source} onSaved={saved} onCancel={() => setPanel(null)} onFailure={() => { void refresh(); }} onStart={invalidateRefresh} />}
        {panel === 'applicability' && version && <ApplicabilityForm source={source} version={version} onSaved={saved} onCancel={() => setPanel(null)} onStart={invalidateRefresh} />}
      </section>}
      {notice && <p className="save-status" role="status" aria-live="polite">{notice}</p>}
      {error && <p className="notice notice-red" role="alert">{error}</p>}
      <section className="card" id="samenvatting">
        <h2>Samenvatting</h2>
        {source.summary ? <p className="answer-text">{source.summary}</p> : <p className="muted">Nog geen samenvatting voor deze bron.</p>}
        <p className="muted">De samenvatting helpt om de inhoud te verkennen. De opgeslagen passages vormen het bewijs bij antwoorden.</p>
        <div className="actions"><button onClick={() => { void derive('summary'); }} disabled={busy || panel !== null || version?.processingStatus !== 'ready'}>{operation === 'summary' ? 'Samenvatting genereren…' : 'Samenvatting genereren'}</button><button onClick={() => { void derive('embed'); }} disabled={busy || panel !== null || version?.processingStatus !== 'ready'}>{operation === 'embed' ? 'Embeddings berekenen…' : 'Embeddings berekenen'}</button></div>
        <p className="muted">Embeddings maken zoeken op betekenis mogelijk. Kies hybride zoeken in <Link href="/instellingen">Instellingen</Link>.</p>
        {operation && <p role="status" aria-live="polite">{operation === 'summary' ? 'De samenvatting wordt opgesteld…' : 'De passages worden voorbereid voor zoeken op betekenis…'}</p>}
      </section>
      <SourcePassages key={`${source.id}:${version?.id}:${version?.processingStatus}`} source={source} />
    </>}
  </>;
}

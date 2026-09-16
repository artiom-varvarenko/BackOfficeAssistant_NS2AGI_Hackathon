'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { getSettings, getSources } from '@/lib/api-client';
import type { Source } from '@/lib/types';
import { SourceForm, sourceError } from './SourceForm';
import { SourceTable } from './SourceTable';
import { SearchPanel } from './SearchPanel';
import { useToast } from './Toast';

export function SourceLibrary() {
  const toast = useToast();
  const [sources, setSources] = useState<Source[] | null>(null);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState('');
  const [mode, setMode] = useState<'pdf' | 'url' | null>(null);
  const [municipality, setMunicipality] = useState('');
  const request = useRef(0);
  const refresh = useCallback(async () => {
    const current = ++request.current;
    setRefreshing(true); setError('');
    try { const result = await getSources(); if (current === request.current) setSources(result); }
    catch (failure) { if (current === request.current) setError(sourceError(failure)); }
    finally { if (current === request.current) setRefreshing(false); }
  }, []);
  useEffect(() => { void refresh(); return () => { request.current++; }; }, [refresh]);
  useEffect(() => {
    let alive = true;
    getSettings().then((settings) => { if (alive) setMunicipality(settings.municipality); }).catch(() => { /* The scope remains editable if settings are unavailable. */ });
    return () => { alive = false; };
  }, []);
  const processing = sources?.some((source) => source.currentVersion?.processingStatus === 'processing') ?? false;
  useEffect(() => {
    if (!processing) return;
    const timer = window.setInterval(() => { void refresh(); }, 3000);
    return () => window.clearInterval(timer);
  }, [processing, refresh]);
  function invalidateRefresh() { request.current++; setRefreshing(false); }
  function changed(source: Source) {
    invalidateRefresh();
    setSources((previous) => {
      const existing = previous ?? [];
      return existing.some((item) => item.id === source.id) ? existing.map((item) => item.id === source.id ? source : item) : [source, ...existing];
    });
  }
  function added(source: Source) {
    changed(source); setMode(null);
    const message = source.currentVersion?.processingStatus === 'failed' ? `Bron toegevoegd, verwerking mislukt: ${source.currentVersion.processingError ?? 'Onbekende fout'}` : `Bron “${source.title}” toegevoegd.`;
    setNotice(message); toast(message);
  }
  return <>
    <div className="page-heading"><div><h1>Bronnen</h1><p>Alleen ingeschakelde en verwerkte bronnen worden gebruikt voor nieuwe antwoorden. Eerdere antwoorden behouden hun eigen bronversies.</p></div></div>
    <div className="actions"><button className="primary" type="button" onClick={() => { setMode('pdf'); setNotice(''); }} disabled={mode !== null}>Bron toevoegen (PDF)</button><button type="button" onClick={() => { setMode('url'); setNotice(''); }} disabled={mode !== null}>Bron toevoegen via URL</button><button type="button" onClick={() => { void refresh(); }} disabled={refreshing}>{refreshing ? 'Vernieuwen…' : 'Vernieuwen'}</button></div>
    {mode && <section className="card"><SourceForm key={mode} mode={mode} defaultScope={municipality} onSaved={added} onCancel={() => setMode(null)} onFailure={() => { void refresh(); }} onStart={invalidateRefresh} /></section>}
    {notice && <p className="notice" role="status" aria-live="polite">{notice}</p>}
    {error && <section className="card notice-red" role="alert"><p>Bronnen konden niet worden geladen. {error}</p><button onClick={() => { void refresh(); }}>Opnieuw proberen</button></section>}
    {sources === null && !error && <p className="card" role="status" aria-live="polite">Bronnen laden…</p>}
    {sources && <><p className="muted">{sources.length} bronnen · {sources.filter((source) => source.enabled && source.currentVersion?.processingStatus === 'ready').length} actief en verwerkt</p><SourceTable sources={sources} onChange={changed} onFailure={() => { void refresh(); }} onMutationStart={invalidateRefresh} /></>}
    <details><summary>Zoek rechtstreeks in de bronnen (zonder AI)</summary><SearchPanel /></details>
  </>;
}

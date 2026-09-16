'use client';

import { useLocale } from './LanguageProvider';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { getSettings, getSources } from '@/lib/api-client';
import type { Source } from '@/lib/types';
import { SourceForm, sourceError } from './SourceForm';
import { SourceTable } from './SourceTable';
import { SearchPanel } from './SearchPanel';
import { useToast } from './Toast';
import { Icon } from './Icon';

export function SourceLibrary() {
  const { t, locale } = useLocale();
  const toast = useToast();
  const [sources, setSources] = useState<Source[] | null>(null);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(true);
  const [notice, setNotice] = useState('');
  const [mode, setMode] = useState<'pdf' | 'url' | null>(null);
  const [municipality, setMunicipality] = useState('');
  const formId = useId();
  const formTrigger = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (mode === null) {
      formTrigger.current?.focus();
      formTrigger.current = null;
    }
  }, [mode]);
  const request = useRef(0);
  const load = useCallback(() => {
    const current = ++request.current;
    return getSources()
      .then((result) => { if (current === request.current) { setSources(result); setError(''); } })
      .catch((failure) => { if (current === request.current) setError(sourceError(failure)); })
      .finally(() => { if (current === request.current) setRefreshing(false); });
  }, []);
  const refresh = useCallback(() => {
    setRefreshing(true); setError('');
    return load();
  }, [load]);
  useEffect(() => {
    const activeRequests = request;
    void load();
    return () => { activeRequests.current++; };
  }, [load]);
  useEffect(() => {
    let alive = true;
    getSettings().then((settings) => { if (alive) setMunicipality(settings.municipality); }).catch(() => { /* The scope remains editable if settings are unavailable. */ });
    return () => { alive = false; };
  }, []);
  const processing = sources?.some((source) => source.versions.some((version) => version.processingStatus === 'processing')) ?? false;
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
    const message = source.currentVersion?.processingStatus === 'failed' ? t('Bron toegevoegd, verwerking mislukt: {error}', { error: t(source.currentVersion.processingError ?? 'Onbekende fout') }) : t('Bron “{title}” toegevoegd.', { title: source.title });
    setNotice(message); toast(message);
  }
  function openForm(value: 'pdf' | 'url', trigger: HTMLButtonElement) {
    formTrigger.current = trigger; setMode(value); setNotice('');
  }
  const activeSources = sources?.filter((source) => source.enabled && source.currentVersion?.processingStatus === 'ready') ?? [];
  const searchablePassages = activeSources.reduce((total, source) => total + (source.currentVersion?.passageCount ?? 0), 0);
  return <>
    <div className="page-heading"><div><p className="eyebrow">{t("UW KENNISBASIS")}</p><h1>{t("Bronnen")}</h1><p>{t("De documenten achter ieder onderbouwd antwoord. Beheer hun inhoud, versie en toepasselijkheid op één plek.")}</p></div></div>
    {sources && <div className="library-stats" aria-label={t("Overzicht van de kennisbasis")}><div className="library-stat"><strong>{sources.length}</strong><span>{t("Documenten in uw bibliotheek")}</span></div><div className="library-stat"><strong>{activeSources.length}</strong><span>{t("Actief en verwerkt")}</span></div><div className="library-stat"><strong>{searchablePassages.toLocaleString(locale === 'en' ? 'en-GB' : 'nl-BE')}</strong><span>{t("Doorzoekbare passages")}</span></div></div>}
    <div className="actions library-toolbar"><button className="primary" type="button" onClick={(event) => openForm('pdf', event.currentTarget)} disabled={mode !== null} aria-expanded={mode === 'pdf'} aria-controls={mode === 'pdf' ? formId : undefined}><Icon name="plus" size={18} />{t("Bron toevoegen (PDF)")}</button><button type="button" onClick={(event) => openForm('url', event.currentTarget)} disabled={mode !== null} aria-expanded={mode === 'url'} aria-controls={mode === 'url' ? formId : undefined}><Icon name="link" size={18} />{t("Bron toevoegen via URL")}</button><button type="button" onClick={() => { void refresh(); }} disabled={refreshing}><Icon name="refresh" size={18} />{refreshing ? t("Vernieuwen…") : t("Vernieuwen")}</button></div>
    {mode && <section className="card" id={formId}><SourceForm key={mode} mode={mode} defaultScope={municipality} onSaved={added} onCancel={() => setMode(null)} onFailure={() => { void refresh(); }} onStart={invalidateRefresh} /></section>}
    {notice && <p className="notice" role="status" aria-live="polite">{t(notice)}</p>}
    {error && <section className="card notice-red" role="alert"><p>{t("Bronnen konden niet worden geladen.")}{' '}{t(error)}</p><button onClick={() => { void refresh(); }}>{t("Opnieuw proberen")}</button></section>}
    {sources === null && !error && <p className="card" role="status" aria-live="polite">{t("Bronnen laden…")}</p>}
    {sources && <><p className="muted">{t("Alleen actieve, verwerkte bronnen worden doorzocht. Eerdere antwoorden behouden hun eigen bronversies.")}</p><SourceTable sources={sources} onChange={changed} onFailure={() => { void refresh(); }} onMutationStart={invalidateRefresh} /></>}
    <details><summary>{t("Zoek rechtstreeks in de bronnen (zonder AI)")}</summary><SearchPanel /></details>
  </>;
}

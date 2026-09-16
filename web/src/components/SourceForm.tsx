'use client';

import { useState, type FormEvent } from 'react';
import { addSourceFromUrl, updateSource, uploadSource, type SourceMetadata } from '@/lib/api-client';
import type { DocType, Level, Source } from '@/lib/types';
import { levelLabels } from './Badge';

export const sourceTypeLabels: Record<DocType, string> = {
  bylaw: 'Reglement', fee_regulation: 'Retributiereglement', subsidy_regulation: 'Subsidiereglement',
  royal_decree: 'Koninklijk besluit', brochure: 'Brochure of richtlijn', manual: 'Handleiding', other: 'Andere',
};

export function sourceError(error: unknown) {
  return error instanceof Error ? error.message : 'De wijziging kon niet worden opgeslagen. Probeer opnieuw.';
}

export function SourceForm({ mode, source, defaultScope = '', onSaved, onCancel, onFailure, onStart }: {
  mode: 'pdf' | 'url' | 'edit'; source?: Source; defaultScope?: string;
  onSaved: (source: Source) => void; onCancel: () => void; onFailure?: () => void; onStart?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [url, setUrl] = useState('');
  const [originalUrl, setOriginalUrl] = useState(source?.originalUrl ?? '');
  const [originalEdited, setOriginalEdited] = useState(false);
  const editing = mode === 'edit';

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    const value = (name: string) => String(form.get(name) ?? '').trim();
    const optional = (name: string) => value(name) || null;
    if (!value('title')) { setError('Vul een titel in.'); return; }
    if (value('validFrom') && value('validUntil') && value('validUntil') < value('validFrom')) {
      setError('Geldig tot moet op of na Geldig van liggen.'); return;
    }
    if (mode === 'url' && !/^https?:\/\//i.test(value('url'))) {
      setError('Gebruik een volledige URL die begint met https:// of http://.'); return;
    }
    if (originalUrl && !/^https?:\/\//i.test(originalUrl.trim())) {
      setError('Gebruik voor de originele bron een URL die begint met https:// of http://.'); return;
    }
    const metadata: SourceMetadata = {
      title: value('title'), authority: optional('authority'), level: value('level') as Level,
      docType: value('docType') as DocType, scope: optional('scope'), originalUrl: originalUrl.trim() || null,
    };
    setBusy(true); setError(''); onStart?.();
    try {
      let saved: Source;
      if (editing) {
        if (!source) throw new Error('De te bewerken bron ontbreekt.');
        saved = await updateSource(source.id, metadata);
      } else if (mode === 'url') {
        saved = await addSourceFromUrl({ ...metadata, url: value('url'), documentDate: optional('documentDate'),
          versionLabel: optional('versionLabel'), validFrom: optional('validFrom'), validUntil: optional('validUntil'),
          applicability: value('applicability') as 'unverified' | 'historical' });
      } else {
        form.set('title', metadata.title);
        saved = await uploadSource(form);
      }
      onSaved(saved);
    } catch (failure) { setError(sourceError(failure)); onFailure?.(); }
    finally { setBusy(false); }
  }

  return <form onSubmit={submit} aria-busy={busy}>
    <h2>{editing ? 'Bron bewerken' : mode === 'url' ? 'Bron toevoegen via URL' : 'Bron toevoegen (PDF)'}</h2>
    <fieldset className="form-fieldset" disabled={busy}>
      {mode === 'pdf' && <label className="field">PDF-bestand<input type="file" name="file" accept="application/pdf,.pdf" required /></label>}
      {mode === 'url' && <label className="field">URL van het PDF-bestand<input type="url" name="url" value={url} required placeholder="https://…" onChange={(event) => {
        setUrl(event.target.value); if (!originalEdited) setOriginalUrl(event.target.value);
      }} /></label>}
      <div className="form-grid">
        <label className="field">Titel<input name="title" defaultValue={source?.title ?? ''} required /></label>
        <label className="field">Uitgevende instantie<input name="authority" defaultValue={source?.authority ?? ''} /></label>
        <label className="field">Bestuursniveau<select name="level" defaultValue={source?.level ?? 'municipal'}>{Object.entries(levelLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label className="field">Documenttype<select name="docType" defaultValue={source?.docType ?? 'bylaw'}>{Object.entries(sourceTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label className="field">Toepassingsgebied<input name="scope" defaultValue={source?.scope ?? defaultScope} /></label>
        <label className="field">Originele URL<input type="url" name="originalUrl" value={originalUrl} onChange={(event) => { setOriginalEdited(true); setOriginalUrl(event.target.value); }} /></label>
      </div>
      {!editing && <>
        <VersionMetadataFields />
        <label className="field">Toepasselijkheid bij aanmaak<select name="applicability" defaultValue="unverified"><option value="unverified">Niet geverifieerd</option><option value="historical">Historisch (achtergrond)</option></select></label>
      </>}
      <div className="actions"><button className="primary" type="submit">{busy ? editing ? 'Opslaan…' : 'Verwerken…' : editing ? 'Opslaan' : 'Bron toevoegen'}</button><button type="button" onClick={onCancel}>Annuleren</button></div>
    </fieldset>
    {busy && <p role="status" aria-live="polite">{editing ? 'Wijzigingen opslaan…' : 'Verwerken… Het PDF-bestand wordt ingelezen.'}</p>}
    {error && <p className="notice notice-red" role="alert">Mislukt: {error}</p>}
  </form>;
}

export function VersionMetadataFields({ version }: { version?: Source['currentVersion'] }) {
  return <div className="form-grid">
    <label className="field">Documentdatum (leeg = onbekend)<input type="date" name="documentDate" defaultValue={version?.documentDate?.slice(0, 10) ?? ''} /></label>
    <label className="field">Versielabel<input name="versionLabel" defaultValue={version?.versionLabel ?? ''} /></label>
    <label className="field">Geldig van<input type="date" name="validFrom" defaultValue={version?.validFrom?.slice(0, 10) ?? ''} /></label>
    <label className="field">Geldig tot<input type="date" name="validUntil" defaultValue={version?.validUntil?.slice(0, 10) ?? ''} /></label>
  </div>;
}

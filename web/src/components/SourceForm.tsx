'use client';

import { useLocale } from './LanguageProvider';

import { useId, useState, type FormEvent } from 'react';
import { addSourceFromUrl, safeSourceUrl, updateSource, uploadSource, type SourceMetadata } from '@/lib/api-client';
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
  const { t } = useLocale();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [url, setUrl] = useState('');
  const [originalUrl, setOriginalUrl] = useState(source?.originalUrl ?? '');
  const originalUrlHelpId = useId();
  const editing = mode === 'edit';

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    const value = (name: string) => String(form.get(name) ?? '').trim();
    const optional = (name: string) => value(name) || null;
    if (!value('title')) { setError(t("Vul een titel in.")); return; }
    if (value('validFrom') && value('validUntil') && value('validUntil') < value('validFrom')) {
      setError(t("Geldig tot moet op of na Geldig van liggen.")); return;
    }
    if (mode === 'url' && !safeSourceUrl(value('url'))) {
      setError(t("Gebruik een volledige http://- of https://-URL zonder inloggegevens, controletekens of backslashes.")); return;
    }
    if (value('originalUrl') && !safeSourceUrl(value('originalUrl'))) {
      setError(t("Gebruik voor de originele bron een volledige http://- of https://-URL zonder inloggegevens, controletekens of backslashes.")); return;
    }
    const metadata: SourceMetadata = {
      title: value('title'), authority: optional('authority'), level: value('level') as Level,
      docType: value('docType') as DocType, scope: optional('scope'), originalUrl: optional('originalUrl'),
    };
    setBusy(true); setError(''); onStart?.();
    try {
      let saved: Source;
      if (editing) {
        if (!source) throw new Error(t("De te bewerken bron ontbreekt."));
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
    <h2>{editing ? t("Bron bewerken") : mode === 'url' ? t("Bron toevoegen via URL") : t("Bron toevoegen (PDF)")}</h2>
    <fieldset className="form-fieldset" disabled={busy}>
      {mode === 'pdf' && <label className="field">{t("PDF-bestand")}<input type="file" name="file" accept="application/pdf,.pdf" autoFocus required /></label>}
      {mode === 'url' && <label className="field">{t("URL van het PDF-bestand")}<input type="url" name="url" value={url} autoFocus required placeholder="https://…" onChange={(event) => setUrl(event.target.value)} /></label>}
      <div className="form-grid">
        <label className="field">{t("Titel")}<input name="title" defaultValue={source?.title ?? ''} autoFocus={editing} required /></label>
        <label className="field">{t("Uitgevende instantie")}<input name="authority" defaultValue={source?.authority ?? ''} /></label>
        <label className="field">{t("Bestuursniveau")}<select name="level" defaultValue={source?.level ?? 'municipal'}>{Object.entries(levelLabels).map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}</select></label>
        <label className="field">{t("Documenttype")}<select name="docType" defaultValue={source?.docType ?? 'bylaw'}>{Object.entries(sourceTypeLabels).map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}</select></label>
        <label className="field">{t("Toepassingsgebied")}<input name="scope" defaultValue={source?.scope ?? defaultScope} /></label>
        <label className="field">{t("Originele URL")}<input type="url" name="originalUrl" value={mode === 'url' ? url : originalUrl} readOnly={mode === 'url'} aria-describedby={mode === 'url' ? originalUrlHelpId : undefined} onChange={(event) => setOriginalUrl(event.target.value)} /></label>
      </div>
      {mode === 'url' && <p className="muted" id={originalUrlHelpId}>{t("Bij import wordt de URL van het PDF-bestand opgeslagen als originele URL. U kunt die na de import wijzigen via Bewerken.")}</p>}
      {!editing && <>
        <VersionMetadataFields />
        <label className="field">{t("Toepasselijkheid bij aanmaak")}<select name="applicability" defaultValue="unverified"><option value="unverified">{t("Niet geverifieerd")}</option><option value="historical">{t("Historisch (achtergrond)")}</option></select></label>
      </>}
      <div className="actions"><button className="primary" type="submit">{busy ? editing ? t("Opslaan…") : t("Verwerken…") : editing ? t("Opslaan") : t("Bron toevoegen")}</button><button type="button" onClick={onCancel}>{t("Annuleren")}</button></div>
    </fieldset>
    {busy && <p role="status" aria-live="polite">{editing ? t("Wijzigingen opslaan…") : t("Verwerken… Het PDF-bestand wordt ingelezen.")}</p>}
    {error && <p className="notice notice-red" role="alert">{t("Mislukt:")}{' '}{t(error)}</p>}
  </form>;
}

export function VersionMetadataFields({ version }: { version?: Source['currentVersion'] }) {
  const { t } = useLocale();
  return <div className="form-grid">
    <label className="field">{t("Documentdatum (leeg = onbekend)")}<input type="date" name="documentDate" defaultValue={version?.documentDate?.slice(0, 10) ?? ''} /></label>
    <label className="field">{t("Versielabel")}<input name="versionLabel" defaultValue={version?.versionLabel ?? ''} /></label>
    <label className="field">{t("Geldig van")}<input type="date" name="validFrom" defaultValue={version?.validFrom?.slice(0, 10) ?? ''} /></label>
    <label className="field">{t("Geldig tot")}<input type="date" name="validUntil" defaultValue={version?.validUntil?.slice(0, 10) ?? ''} /></label>
  </div>;
}

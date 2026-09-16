'use client';

import { useLocale } from './LanguageProvider';

import { useId, useState, type FormEvent } from 'react';
import { updateVersion } from '@/lib/api-client';
import type { Applicability, Source, SourceVersion } from '@/lib/types';
import { sourceError, VersionMetadataFields } from './SourceForm';

export function ApplicabilityForm({ source, version: initialVersion, onSaved, onCancel, onStart }: {
  source: Source; version: SourceVersion; onSaved: (source: Source) => void; onCancel: () => void; onStart?: () => void;
}) {
  const { t } = useLocale();
  // Keep the edits bound to the version the officer opened, even if a refresh replaces it.
  const [version] = useState(initialVersion);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const groupId = useId();
  const superseded = (source.versions.find((value) => value.id === version.id) ?? version).applicability === 'superseded';
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const data = new FormData(event.currentTarget);
    const optional = (name: string) => String(data.get(name) ?? '').trim() || null;
    const from = optional('validFrom'); const until = optional('validUntil');
    if (from && until && until < from) { setError(t("Geldig tot moet op of na Geldig van liggen.")); return; }
    setBusy(true); setError(''); onStart?.();
    try {
      onSaved(await updateVersion(source.id, version.id, {
        ...(superseded ? {} : { applicability: data.get('applicability') as Applicability }),
        applicabilityNote: optional('applicabilityNote'), documentDate: optional('documentDate'),
        versionLabel: optional('versionLabel'), validFrom: from, validUntil: until,
      }));
    } catch (failure) { setError(sourceError(failure)); }
    finally { setBusy(false); }
  }
  return <form onSubmit={submit} aria-busy={busy}>
    <h2>{t("Toepasselijkheid en versiegegevens wijzigen · versie")}{' '}{version.versionNo}</h2>
    <p className="muted">{t("De medewerker beoordeelt of deze bron van toepassing is. Een documentdatum is geen bevestiging van geldigheid.")}</p>
    <fieldset className="form-fieldset" disabled={busy}>
      {superseded ? <p>{t("Deze versie is vervangen door een nieuwere versie.")}</p> : <fieldset className="form-radio-group">
        <legend>{t("Toepasselijkheid")}</legend>
        {([['unverified', t("Niet geverifieerd")], ['verified', t("Geverifieerd")], ['historical', t("Historisch (achtergrond)")]] as const).map(([value, label]) =>
          <label key={value} htmlFor={`${groupId}-${value}`} className="checkbox-label"><input id={`${groupId}-${value}`} type="radio" name="applicability" value={value} defaultChecked={version.applicability === value} autoFocus={version.applicability === value} required />{t(label)}</label>)}
      </fieldset>}
      <label className="field">{t("Toelichting")}<textarea name="applicabilityNote" rows={3} defaultValue={version.applicabilityNote ?? ''} autoFocus={superseded} /></label>
      <VersionMetadataFields version={version} />
      <div className="actions"><button className="primary" type="submit">{busy ? t("Opslaan…") : t("Opslaan")}</button><button type="button" onClick={onCancel}>{t("Annuleren")}</button></div>
    </fieldset>
    {busy && <p role="status">{t("Toepasselijkheid opslaan…")}</p>}
    {error && <p className="notice notice-red" role="alert">{t("Mislukt:")}{' '}{t(error)}</p>}
  </form>;
}

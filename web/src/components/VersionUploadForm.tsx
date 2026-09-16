'use client';

import { useState, type FormEvent } from 'react';
import { uploadVersion } from '@/lib/api-client';
import type { Source } from '@/lib/types';
import { sourceError, VersionMetadataFields } from './SourceForm';

export function VersionUploadForm({ source, onSaved, onCancel, onFailure, onStart }: {
  source: Source; onSaved: (source: Source) => void; onCancel: () => void; onFailure?: () => void; onStart?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const data = new FormData(event.currentTarget);
    const from = String(data.get('validFrom') ?? ''); const until = String(data.get('validUntil') ?? '');
    if (from && until && until < from) { setError('Geldig tot moet op of na Geldig van liggen.'); return; }
    setBusy(true); setError(''); onStart?.();
    try { onSaved(await uploadVersion(source.id, data)); }
    catch (failure) { setError(sourceError(failure)); onFailure?.(); }
    finally { setBusy(false); }
  }
  return <form onSubmit={submit} aria-busy={busy}>
    <h2>Nieuwe versie toevoegen</h2>
    <p>De huidige versie van “{source.title}” wordt vervangen. Eerdere antwoorden behouden hun oorspronkelijke bewijs. De nieuwe versie is standaard niet geverifieerd.</p>
    <fieldset className="form-fieldset" disabled={busy}>
      <label className="field">PDF-bestand<input type="file" name="file" accept="application/pdf,.pdf" required /></label>
      <VersionMetadataFields />
      <div className="actions"><button className="primary" type="submit">{busy ? 'Verwerken…' : 'Nieuwe versie toevoegen'}</button><button type="button" onClick={onCancel}>Annuleren</button></div>
    </fieldset>
    {busy && <p role="status" aria-live="polite">Verwerken… De nieuwe versie wordt ingelezen.</p>}
    {error && <p className="notice notice-red" role="alert">Mislukt: {error}</p>}
  </form>;
}

'use client';

import { Fragment, useState } from 'react';
import Link from 'next/link';
import { updateSource } from '@/lib/api-client';
import type { Source, SourceVersion } from '@/lib/types';
import { ApplicabilityBadge, Badge, dateLabel, levelLabels } from './Badge';
import { ApplicabilityForm } from './ApplicabilityForm';
import { SourceForm, sourceError, sourceTypeLabels } from './SourceForm';
import { VersionUploadForm } from './VersionUploadForm';
import { useToast } from './Toast';

export function SourceProcessingStatus({ version }: { version: SourceVersion | null }) {
  return <div className="source-status">{!version ? 'Geen document' : version.processingStatus === 'ready'
    ? `Verwerkt · ${version.pageCount ?? '?'} p. · ${version.passageCount} passages`
    : version.processingStatus === 'processing' ? <span role="status">Verwerken…</span>
      : <p className="notice notice-red">Mislukt: {version.processingError ?? 'Onbekende fout'}</p>}
    {version?.extractionWarning && <p className="notice notice-amber">{version.extractionWarning}</p>}
  </div>;
}

export function VersionHistory({ source }: { source: Source }) {
  const previous = source.versions.filter((version) => version.id !== source.currentVersion?.id);
  return <details><summary>Vorige versies ({previous.length})</summary>
    {previous.length === 0 ? <p className="muted">Geen vorige versies.</p> : previous.map((version) => <div className="context" key={version.id}>
      <h3>Versie {version.versionNo}{version.versionLabel ? ` · ${version.versionLabel}` : ''}</h3>
      <p>{version.documentDate ? dateLabel(version.documentDate) : 'Datum onbekend'} · Toegevoegd {dateLabel(version.createdAt)}</p>
      <ApplicabilityBadge value={version.applicability} verifiedAt={version.verifiedAt} />
      {version.applicabilityNote && <p>{version.applicabilityNote}</p>}
      <SourceProcessingStatus version={version} />
      <a href={version.pdfUrl} target="_blank" rel="noopener noreferrer">PDF versie {version.versionNo} ↗</a>
    </div>)}
  </details>;
}

type Panel = 'edit' | 'version' | 'applicability' | null;

function SourceRow({ source, onChange, onFailure, onMutationStart }: { source: Source; onChange: (source: Source) => void; onFailure?: () => void; onMutationStart?: () => void }) {
  const toast = useToast();
  const [panel, setPanel] = useState<Panel>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const version = source.currentVersion;
  async function toggle() {
    if (busy) return;
    setBusy(true); setError(''); setNotice(''); onMutationStart?.();
    try {
      const saved = await updateSource(source.id, { enabled: !source.enabled });
      const message = saved.enabled ? 'Bron ingeschakeld.' : 'Bron uitgeschakeld. Eerdere antwoorden behouden hun bewijs.';
      onChange(saved); setNotice(message); toast(message);
    } catch (failure) { setError(sourceError(failure)); }
    finally { setBusy(false); }
  }
  function saved(value: Source) { onChange(value); setPanel(null); setNotice('Bron bijgewerkt.'); toast('Bron bijgewerkt.'); }
  function open(value: Panel) { setPanel(panel === value ? null : value); setError(''); setNotice(''); }
  return <Fragment>
    <tr>
      <td><Link href={`/bronnen/${encodeURIComponent(source.id)}`}><strong>{source.title}</strong></Link><p className="muted">{source.authority}</p><VersionHistory source={source} /></td>
      <td className="source-summary">{source.summary ? <><p>{source.summary.length > 180 ? `${source.summary.slice(0, 180)}…` : source.summary}</p><Link href={`/bronnen/${encodeURIComponent(source.id)}#samenvatting`}>Volledige samenvatting</Link></> : <span className="muted">Nog geen samenvatting</span>}</td>
      <td><Badge>{levelLabels[source.level]}</Badge><p>{sourceTypeLabels[source.docType]}</p></td>
      <td>{version?.documentDate ? dateLabel(version.documentDate) : <Badge tone="amber">Datum onbekend</Badge>}<p className="muted">{version?.versionLabel}</p></td>
      <td>{version ? <><ApplicabilityBadge value={version.applicability} verifiedAt={version.verifiedAt} />{version.applicabilityNote && <p>{version.applicabilityNote}</p>}<button type="button" className="text-button" disabled={busy || panel !== null} aria-expanded={panel === 'applicability'} onClick={() => open('applicability')}>Wijzigen<span className="sr-only">: toepasselijkheid van {source.title}</span></button></> : 'Geen versie'}</td>
      <td><SourceProcessingStatus version={version} /></td>
      <td><label className="checkbox-label"><input type="checkbox" checked={source.enabled} disabled={busy || panel !== null} onChange={toggle} aria-label={`Bron ${source.title} inschakelen`} />{busy ? 'Opslaan…' : source.enabled ? 'Ingeschakeld' : 'Uitgeschakeld'}</label></td>
      <td className="source-tools"><div className="actions"><button type="button" disabled={busy || panel !== null} onClick={() => open('edit')} aria-expanded={panel === 'edit'}>Bewerken</button><button type="button" disabled={busy || panel !== null} onClick={() => open('version')} aria-expanded={panel === 'version'}>Nieuwe versie</button>{version && <a href={version.pdfUrl} target="_blank" rel="noopener noreferrer">PDF ↗</a>}</div></td>
    </tr>
    {(panel || notice || error) && <tr><td colSpan={8}>
      {panel === 'edit' && <SourceForm mode="edit" source={source} onSaved={saved} onCancel={() => setPanel(null)} onStart={onMutationStart} />}
      {panel === 'version' && <VersionUploadForm source={source} onSaved={saved} onCancel={() => setPanel(null)} onFailure={onFailure} onStart={onMutationStart} />}
      {panel === 'applicability' && version && <ApplicabilityForm source={source} version={version} onSaved={saved} onCancel={() => setPanel(null)} onStart={onMutationStart} />}
      {notice && <p className="save-status" role="status">{notice}</p>}
      {error && <p className="notice notice-red" role="alert">{error}</p>}
    </td></tr>}
  </Fragment>;
}

export function SourceTable({ sources, onChange, onFailure, onMutationStart }: { sources: Source[]; onChange: (source: Source) => void; onFailure?: () => void; onMutationStart?: () => void }) {
  if (!sources.length) return <p className="card">Nog geen bronnen toegevoegd.</p>;
  return <div className="table-scroll" tabIndex={0} role="region" aria-label="Bronnenoverzicht, horizontaal verschuifbaar"><table><caption className="sr-only">Bronnen met documentstatus en toepasselijkheid</caption>
    <thead><tr><th>Bron</th><th>Samenvatting</th><th>Niveau en type</th><th>Datum / versie</th><th>Toepasselijkheid</th><th>Verwerking</th><th>Actief</th><th>Acties</th></tr></thead>
    <tbody>{sources.map((source) => <SourceRow key={source.id} source={source} onChange={onChange} onFailure={onFailure} onMutationStart={onMutationStart} />)}</tbody>
  </table></div>;
}

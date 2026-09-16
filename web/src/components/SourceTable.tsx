'use client';

import { useLocale } from './LanguageProvider';

import { Fragment, useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';
import { safeSourceUrl, updateSource } from '@/lib/api-client';
import type { Source, SourceVersion } from '@/lib/types';
import { ApplicabilityBadge, Badge, dateLabel, levelLabels } from './Badge';
import { ApplicabilityForm } from './ApplicabilityForm';
import { SourceForm, sourceError, sourceTypeLabels } from './SourceForm';
import { VersionUploadForm } from './VersionUploadForm';
import { useToast } from './Toast';
import { Icon } from './Icon';

export function SourceProcessingStatus({ version }: { version: SourceVersion | null }) {
  const { t } = useLocale();
  // Ingestion joins extraction and enrichment notices in one stored field.
  // Translate each known complete notice without touching source document text.
  const warning = version?.extractionWarning?.split(/ (?=De automatische (?:samenvatting|embeddings))/).map((part) => t(part)).join(' ');
  return <div className="source-status">{!version ? t("Geen document") : version.processingStatus === 'ready'
    ? t('Verwerkt · {pages} p. · {passages} passages', { pages: version.pageCount ?? '?', passages: version.passageCount })
    : version.processingStatus === 'processing' ? <span role="status">{t("Verwerken…")}</span>
      : <p className="notice notice-red">{t("Mislukt:")}{' '}{t(version.processingError ?? 'Onbekende fout')}</p>}
    {warning && <p className="notice notice-amber">{warning}</p>}
  </div>;
}

export function VersionHistory({ source }: { source: Source }) {
  const { t, locale } = useLocale();
  const previous = source.versions.filter((version) => version.id !== source.currentVersion?.id);
  return <details className="source-version-history"><summary>{t("Vorige versies (")}{previous.length})</summary>
    {previous.length === 0 ? <p className="muted">{t("Geen vorige versies.")}</p> : previous.map((version) => {
      const pdfUrl = safeSourceUrl(version.pdfUrl, true);
      return <div className="context" key={version.id}>
        <h3>{t("Versie")}{' '}{version.versionNo}{version.versionLabel ? ` · ${version.versionLabel}` : ''}</h3>
        <p>{version.documentDate ? dateLabel(version.documentDate, locale) : t("Datum onbekend")}{' '}{t("· Toegevoegd")}{' '}{dateLabel(version.createdAt, locale)}</p>
        <ApplicabilityBadge value={version.applicability} verifiedAt={version.verifiedAt} />
        {version.applicabilityNote && <p>{version.applicabilityNote}</p>}
        <SourceProcessingStatus version={version} />
        {pdfUrl ? <a href={pdfUrl} target="_blank" rel="noopener noreferrer">{t("PDF versie")}{' '}{version.versionNo} ↗</a> : <span className="muted">{t("PDF versie")}{' '}{version.versionNo}{' '}{t("niet beschikbaar.")}</span>}
      </div>;
    })}
  </details>;
}

type Panel = 'edit' | 'version' | 'applicability' | null;

function SourceRow({ source, onChange, onFailure, onMutationStart }: { source: Source; onChange: (source: Source) => void; onFailure?: () => void; onMutationStart?: () => void }) {
  const { t, locale } = useLocale();
  const toast = useToast();
  const [panel, setPanel] = useState<Panel>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const panelId = useId();
  const panelTrigger = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (panel === null) {
      panelTrigger.current?.focus();
      panelTrigger.current = null;
    }
  }, [panel]);
  const version = source.currentVersion;
  const pdfUrl = safeSourceUrl(version?.pdfUrl, true);
  async function toggle() {
    if (busy) return;
    setBusy(true); setError(''); setNotice(''); onMutationStart?.();
    try {
      const saved = await updateSource(source.id, { enabled: !source.enabled });
      const message = saved.enabled ? t("Bron ingeschakeld.") : t("Bron uitgeschakeld. Eerdere antwoorden behouden hun bewijs.");
      onChange(saved); setNotice(message); toast(message);
    } catch (failure) { setError(sourceError(failure)); }
    finally { setBusy(false); }
  }
  function saved(value: Source) { onChange(value); setPanel(null); setNotice(t("Bron bijgewerkt.")); toast(t("Bron bijgewerkt.")); }
  function open(value: Panel, trigger: HTMLButtonElement) { panelTrigger.current = trigger; setPanel(value); setError(''); setNotice(''); }
  return <Fragment>
    <tr>
      <td className="source-document">
        <Link className="source-document-title" href={`/bronnen/${encodeURIComponent(source.id)}`}>{source.title}</Link>
        {source.authority && <p className="muted">{source.authority}</p>}
        <div className="source-document-meta"><Badge>{t(levelLabels[source.level])}</Badge><span>{t(sourceTypeLabels[source.docType])}</span></div>
        <div className="source-document-details">
          {source.summary ? <details className="source-summary"><summary>{t("Samenvatting")}</summary><p>{source.summary}</p><Link href={`/bronnen/${encodeURIComponent(source.id)}#samenvatting`}>{t("Volledige samenvatting")}</Link></details> : <span className="muted">{t("Nog geen samenvatting")}</span>}
          <VersionHistory source={source} />
        </div>
      </td>
      <td className="source-applicability">
        {version ? <><ApplicabilityBadge value={version.applicability} verifiedAt={version.verifiedAt} />{version.applicabilityNote && <p>{version.applicabilityNote}</p>}<button type="button" className="text-button" disabled={busy || panel !== null} aria-expanded={panel === 'applicability'} aria-controls={panel === 'applicability' ? panelId : undefined} onClick={(event) => open('applicability', event.currentTarget)}>{t("Wijzigen")}<span className="sr-only">{t(": toepasselijkheid van")}{' '}{source.title}</span></button></> : t("Geen versie")}
        <div className="source-version-meta">{version?.documentDate ? <span>{dateLabel(version.documentDate, locale)}</span> : <Badge tone="amber">{t("Datum onbekend")}</Badge>}{version?.versionLabel && <p className="muted">{version.versionLabel}</p>}</div>
      </td>
      <td className="source-activity"><SourceProcessingStatus version={version} /><label className="checkbox-label"><input type="checkbox" checked={source.enabled} disabled={busy || panel !== null} onChange={toggle} aria-label={t('Bron {title} ingeschakeld', { title: source.title })} />{busy ? t("Opslaan…") : source.enabled ? t("Ingeschakeld") : t("Uitgeschakeld")}</label></td>
      <td className="source-tools"><div className="actions"><button type="button" disabled={busy || panel !== null} onClick={(event) => open('edit', event.currentTarget)} aria-expanded={panel === 'edit'} aria-controls={panel === 'edit' ? panelId : undefined}>{t("Bewerken")}<span className="sr-only">: {source.title}</span></button><button type="button" disabled={busy || panel !== null} onClick={(event) => open('version', event.currentTarget)} aria-expanded={panel === 'version'} aria-controls={panel === 'version' ? panelId : undefined}>{t("Nieuwe versie")}<span className="sr-only">: {source.title}</span></button>{version && (pdfUrl ? <a href={pdfUrl} target="_blank" rel="noopener noreferrer">PDF ↗<span className="sr-only">: {source.title}</span></a> : <span className="muted">{t("PDF niet beschikbaar.")}</span>)}</div></td>
    </tr>
    {(panel || notice || error) && <tr><td colSpan={4} id={panelId}>
      {panel === 'edit' && <SourceForm mode="edit" source={source} onSaved={saved} onCancel={() => setPanel(null)} onStart={onMutationStart} />}
      {panel === 'version' && <VersionUploadForm source={source} onSaved={saved} onCancel={() => setPanel(null)} onFailure={onFailure} onStart={onMutationStart} />}
      {panel === 'applicability' && version && <ApplicabilityForm source={source} version={version} onSaved={saved} onCancel={() => setPanel(null)} onStart={onMutationStart} />}
      {notice && <p className="save-status" role="status">{t(notice)}</p>}
      {error && <p className="notice notice-red" role="alert">{t(error)}</p>}
    </td></tr>}
  </Fragment>;
}

export function SourceTable({ sources, onChange, onFailure, onMutationStart }: { sources: Source[]; onChange: (source: Source) => void; onFailure?: () => void; onMutationStart?: () => void }) {
  const { t } = useLocale();
  if (!sources.length) return <div className="card collection-empty"><div className="collection-empty-icon"><Icon name="document" size={28} /></div><div className="collection-empty-copy"><h2>{t("Hier begint uw kennisbasis")}</h2><p>{t("Nog geen bronnen toegevoegd. Voeg een PDF of een document via URL toe om uw eerste vraag te onderbouwen.")}</p></div></div>;
  return <div className="table-scroll" tabIndex={0} role="region" aria-label={t("Bronnenoverzicht, horizontaal verschuifbaar")}><table className="source-table"><caption className="sr-only">{t("Bronnen met documentstatus en toepasselijkheid")}</caption>
    <thead><tr><th scope="col">{t("Document")}</th><th scope="col">{t("Status")}</th><th scope="col">{t("Verwerking / actief")}</th><th scope="col">{t("Acties")}</th></tr></thead>
    <tbody>{sources.map((source) => <SourceRow key={source.id} source={source} onChange={onChange} onFailure={onFailure} onMutationStart={onMutationStart} />)}</tbody>
  </table></div>;
}

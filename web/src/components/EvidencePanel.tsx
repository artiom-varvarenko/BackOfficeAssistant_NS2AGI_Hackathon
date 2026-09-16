'use client';
import { useState } from 'react';
import { getPassageContext, safeSourceUrl, type PassageContext } from '@/lib/api-client';
import type { Citation } from '@/lib/types';
import { ApplicabilityBadge, Badge, levelLabels } from './Badge';

export function ContextExpander({ passageId }: { passageId: string }) {
  const [context, setContext] = useState<PassageContext | null>(null); const [open, setOpen] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  async function loadContext() { if (busy) return; setBusy(true); setError(''); try { setContext(await getPassageContext(passageId)); } catch (e) { setError(e instanceof Error ? e.message : 'Context kon niet worden geladen.'); } finally { setBusy(false); } }
  function toggle() { setOpen(!open); if (!open && !context) void loadContext(); }
  return <div><button type="button" className="text-button" onClick={toggle} aria-expanded={open}>{open ? 'Verberg context' : 'Toon context'}</button>{open && <div className="context" aria-live="polite">{busy && <p>Context laden…</p>}{error && <div role="alert"><p>{error}</p><button type="button" onClick={() => void loadContext()} disabled={busy}>Opnieuw proberen</button></div>}{context && [context.previous, context.next].map((passage, i) => <div key={i}><h4>{i === 0 ? 'Vorige passage' : 'Volgende passage'}</h4>{passage ? <><p className="muted">{[passage.article, passage.section].filter(Boolean).join(' ') || 'Passage'} · p. {passage.pageStart}{passage.pageEnd !== passage.pageStart && `–${passage.pageEnd}`}</p><p className="quote">{passage.text}</p></> : <p>Geen aangrenzende passage.</p>}</div>)}</div>}</div>;
}
export function CitationCard({ citation: c, active, onSelect, onCheck, busy }: { citation: Citation; active: boolean; onSelect: (marker: number) => void; onCheck: (marker: number, checked: boolean, note?: string) => Promise<void>; busy: boolean }) {
  const [note, setNote] = useState(c.checkNote ?? '');
  const noteChanged = note.trim() !== (c.checkNote ?? '');
  const pdfUrl = safeSourceUrl(c.pdfUrl, true);
  const originalUrl = safeSourceUrl(c.originalUrl);
  const start = c.highlight ? c.quoteText.indexOf(c.highlight) : -1;
  return <article id={`citation-${c.marker}`} tabIndex={-1} className={`citation-card ${active ? 'active' : ''} ${c.checked ? 'checked' : ''}`} onClick={() => onSelect(c.marker)} onFocus={() => onSelect(c.marker)}>
    <button type="button" className="citation-title" onClick={() => onSelect(c.marker)} aria-pressed={active}><span className="citation-number">[{c.marker}]</span>{c.sourceTitle}</button>
    <p>{[c.article, c.section].filter(Boolean).join(' ') || 'Passage'} · p. {c.pageStart}{c.pageEnd !== c.pageStart && `–${c.pageEnd}`}</p><p className="muted">{c.authority ?? 'Instantie niet vermeld'} · {c.versionLabel ?? c.documentDate ?? 'datum onbekend'}</p>
    <div className="badges"><Badge>{levelLabels[c.level]}</Badge><ApplicabilityBadge value={c.applicability} verifiedAt={c.verifiedAt} />{!c.documentDate && <Badge tone="amber">Datum onbekend</Badge>}{!c.sourceEnabled && <Badge>Bron uitgeschakeld</Badge>}{!c.isCurrentVersion && c.applicability !== 'superseded' && <Badge>Vervangen door nieuwere versie</Badge>}</div>
    {c.applicabilityNote && <p className="muted">{c.applicabilityNote}</p>}
    <blockquote className="quote">{start >= 0 && c.highlight ? <>{c.quoteText.slice(0, start)}<mark>{c.highlight}</mark>{c.quoteText.slice(start + c.highlight.length)}</> : c.quoteText}</blockquote>
    <label className="checkbox-label"><input type="checkbox" checked={c.checked} disabled={busy} onChange={(event) => { void onCheck(c.marker, event.target.checked, note.trim()); }} />Gecontroleerd<span className="sr-only"> — bronverwijzing {c.marker}</span></label>
    <details><summary>Opmerking bij controle</summary><label className="field">Toelichting bij bronverwijzing {c.marker}<input value={note} onChange={(event) => setNote(event.target.value)} disabled={busy} /></label><button type="button" disabled={busy || !noteChanged} onClick={() => { void onCheck(c.marker, c.checked, note.trim()); }}>Opmerking opslaan</button>{noteChanged && <p className="muted">De opmerking is nog niet opgeslagen. Wijzigen van Gecontroleerd slaat de opmerking ook op.</p>}</details>
    <div className="source-links">{pdfUrl ? <a href={pdfUrl} target="_blank" rel="noopener noreferrer">Open PDF op p. {c.pageStart}</a> : <span>PDF niet beschikbaar</span>}{c.originalUrl && (originalUrl ? <a href={originalUrl} target="_blank" rel="noopener noreferrer">Originele bron ↗</a> : <span>Originele bron niet beschikbaar</span>)}</div><ContextExpander passageId={c.passageId} />
  </article>;
}
export function EvidencePanel({ citations, activeMarker, onSelect, onCheck, busy = false }: { citations: Citation[]; activeMarker: number | null; onSelect: (marker: number) => void; onCheck: (marker: number, checked: boolean, note?: string) => Promise<void>; busy?: boolean }) {
  return <section className="evidence-panel" aria-labelledby="evidence-title"><h2 id="evidence-title">Bewijs uit de bronnen</h2><p className="muted">Controleer de passages achter iedere verwijzing.</p>{citations.length === 0 ? <div className="card">Er zijn geen bronpassages bij dit antwoord.</div> : <details><summary>Gebruikte bronnen per niveau</summary>{(Object.keys(levelLabels) as Array<keyof typeof levelLabels>).map((level) => {
    const sources = citations.filter((c, index) => c.level === level && citations.findIndex((other) => other.versionId === c.versionId) === index);
    return sources.length > 0 && <div key={level}><h3>{levelLabels[level]}</h3>{sources.map((source) => <p key={source.versionId}>{source.sourceTitle} <ApplicabilityBadge value={source.applicability} verifiedAt={source.verifiedAt} /></p>)}</div>;
  })}</details>}{citations.map((citation) => <CitationCard key={citation.marker} citation={citation} active={activeMarker === citation.marker} onSelect={onSelect} onCheck={onCheck} busy={busy} />)}</section>;
}

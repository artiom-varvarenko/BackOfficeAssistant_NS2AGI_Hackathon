'use client';

import { Fragment, useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import Link from 'next/link';
import { safeSourceUrl, searchSources } from '@/lib/api-client';
import type { SearchHit } from '@/lib/types';
import { sourceError } from './SourceForm';

function decodeSnippetText(text: string): string {
  // One pass only: source text such as &amp;lt; must remain the literal &lt;.
  return text.replace(/&(?:amp|lt|gt|quot|apos|#(?:[xX][0-9a-fA-F]+|[0-9]+));/g, (entity) => {
    switch (entity) {
      case '&amp;': return '&';
      case '&lt;': return '<';
      case '&gt;': return '>';
      case '&quot;': return '"';
      case '&apos;': return "'";
    }
    const hex = entity[2] === 'x' || entity[2] === 'X';
    const codePoint = Number.parseInt(entity.slice(hex ? 3 : 2, -1), hex ? 16 : 10);
    return codePoint > 0 && codePoint <= 0x10ffff && !(codePoint >= 0xd800 && codePoint <= 0xdfff)
      ? String.fromCodePoint(codePoint)
      : entity;
  });
}

function SearchSnippet({ text }: { text: string }) {
  // Split trusted delimiters before decoding; decoded source markup is React text only.
  let highlighted = false;
  const nodes: ReactNode[] = [];
  for (const [index, part] of text.split(/(<mark>|<\/mark>)/).entries()) {
    if (part === '<mark>') { highlighted = true; continue; }
    if (part === '</mark>') { highlighted = false; continue; }
    if (!part) continue;
    const decoded = decodeSnippetText(part);
    nodes.push(highlighted ? <mark key={index}>{decoded}</mark> : <Fragment key={index}>{decoded}</Fragment>);
  }
  return <>{nodes}</>;
}

export function SearchPanel() {
  const [query, setQuery] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const request = useRef(0);
  const id = useId();
  useEffect(() => () => { request.current++; }, []);
  async function search(term: string) {
    const value = term.trim();
    if (!value || busy) return;
    const current = ++request.current;
    setBusy(true); setError(''); setHits(null); setSubmitted(value);
    try { const result = await searchSources(value); if (current === request.current) setHits(result); }
    catch (failure) { if (current === request.current) setError(sourceError(failure)); }
    finally { if (current === request.current) setBusy(false); }
  }
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); void search(query); }
  return <section className="card" aria-labelledby={`${id}-heading`}>
    <h2 id={`${id}-heading`}>Zoek in bronnen</h2>
    <p className="muted">Rechtstreekse zoekopdracht in de ingeschakelde bronnen — zonder AI.</p>
    <form onSubmit={submit} role="search" aria-labelledby={`${id}-heading`} aria-busy={busy}>
      <label className="field" htmlFor={`${id}-query`}>Zoekterm(en)<input id={`${id}-query`} type="search" value={query} onChange={(event) => setQuery(event.target.value)} required maxLength={500} placeholder="Bijvoorbeeld: loting" /></label>
      <button type="submit" disabled={busy || !query.trim()}>{busy ? 'Zoeken…' : 'Zoeken'}</button>
    </form>
    <div role="status" aria-live="polite" aria-atomic="true">
      {busy && <p>Bronnen doorzoeken…</p>}
      {hits !== null && <p className="muted">{hits.length ? `${hits.length} passages gevonden voor “${submitted}”.` : `Geen passages gevonden voor “${submitted}”. Probeer andere zoekwoorden.`}</p>}
    </div>
    {error && <div className="notice notice-red" role="alert"><p>Zoeken is mislukt. {error}</p><button type="button" onClick={() => { void search(submitted); }}>Opnieuw proberen</button></div>}
    {hits !== null && hits.map(({ passage, snippet }) => {
      const pdfUrl = safeSourceUrl(passage.pdfUrl, true);
      return <article className="citation-card" key={passage.id}>
        <h3><Link href={`/bronnen/${encodeURIComponent(passage.sourceId)}`}>{passage.sourceTitle}</Link></h3>
        <p className="muted">{[passage.article, passage.section].filter(Boolean).join(' · ')}{passage.article || passage.section ? ' · ' : ''}p. {passage.pageStart}{passage.pageEnd !== passage.pageStart ? `–${passage.pageEnd}` : ''}</p>
        <p className="quote">{snippet ? <SearchSnippet text={snippet} /> : passage.text.slice(0, 300)}</p>
        {pdfUrl ? <a href={pdfUrl} target="_blank" rel="noopener noreferrer" aria-label={`Open PDF op p. ${passage.pageStart} van ${passage.sourceTitle} (nieuw tabblad)`}>Open PDF op p. {passage.pageStart} ↗</a> : <span className="muted">PDF niet beschikbaar.</span>}
      </article>;
    })}
  </section>;
}

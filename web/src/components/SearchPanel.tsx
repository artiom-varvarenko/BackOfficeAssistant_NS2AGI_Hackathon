'use client';

import { Fragment, useEffect, useId, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { searchSources } from '@/lib/api-client';
import type { SearchHit } from '@/lib/types';
import { sourceError } from './SourceForm';

function SearchSnippet({ text, query }: { text: string; query: string }) {
  // Only our own React elements become markup; PDF text and server snippets stay text.
  const plain = text.replace(/<\/?mark>/gi, '');
  const terms = Array.from(new Set(query.match(/[\p{L}\p{N}]+/gu) ?? [])).sort((a, b) => b.length - a.length);
  if (!terms.length) return <>{plain}</>;
  const pattern = new RegExp(`(${terms.join('|')})`, 'giu');
  return <>{plain.split(pattern).map((part, index) => index % 2 ? <mark key={index}>{part}</mark> : <Fragment key={index}>{part}</Fragment>)}</>;
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
    <form onSubmit={submit} role="search" aria-busy={busy}>
      <label className="field" htmlFor={`${id}-query`}>Zoekterm(en)<input id={`${id}-query`} type="search" value={query} onChange={(event) => setQuery(event.target.value)} required maxLength={500} placeholder="Bijvoorbeeld: loting" /></label>
      <button type="submit" disabled={busy || !query.trim()}>{busy ? 'Zoeken…' : 'Zoeken'}</button>
    </form>
    {busy && <p role="status" aria-live="polite">Bronnen doorzoeken…</p>}
    {error && <div className="notice notice-red" role="alert"><p>Zoeken is mislukt. {error}</p><button onClick={() => { void search(submitted); }}>Opnieuw proberen</button></div>}
    {hits !== null && <>
      <p className="muted" role="status">{hits.length ? `${hits.length} passages gevonden voor “${submitted}”.` : `Geen passages gevonden voor “${submitted}”. Probeer andere zoekwoorden.`}</p>
      {hits.map(({ passage, snippet }) => <article className="citation-card" key={passage.id}>
        <h3><Link href={`/bronnen/${encodeURIComponent(passage.sourceId)}`}>{passage.sourceTitle}</Link></h3>
        <p className="muted">{[passage.article, passage.section].filter(Boolean).join(' · ')}{passage.article || passage.section ? ' · ' : ''}p. {passage.pageStart}{passage.pageEnd !== passage.pageStart ? `–${passage.pageEnd}` : ''}</p>
        <p className="quote"><SearchSnippet text={snippet || passage.text.slice(0, 300)} query={submitted} /></p>
        <a href={passage.pdfUrl} target="_blank" rel="noopener noreferrer">Open PDF op p. {passage.pageStart} ↗</a>
      </article>)}
    </>}
  </section>;
}

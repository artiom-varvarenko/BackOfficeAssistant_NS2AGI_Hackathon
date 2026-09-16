'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { ApiClientError, askQuestion, getSources, streamAnswer } from '@/lib/api-client';
import type { Answer, Source } from '@/lib/types';
import { AnswerWorkspace } from './AnswerWorkspace';
import { QuestionForm } from './QuestionForm';
import { Badge } from './Badge';
import { SearchPanel } from './SearchPanel';
import { useReviewNavigation } from './ReviewNavigation';

export function QuestionPage({ streamingEnabled = true }: { streamingEnabled?: boolean }) {
  const reviewNavigation = useReviewNavigation();
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [busy, setBusy] = useState(false);
  const [partial, setPartial] = useState('');
  const [error, setError] = useState<ApiClientError | null>(null);
  const [sources, setSources] = useState<Source[] | null>(null);
  const [sourceError, setSourceError] = useState('');
  const [sourceAttempt, setSourceAttempt] = useState(0);
  // null means all currently enabled sources, including later additions.
  const [selection, setSelection] = useState<string[] | null>(null);
  const [cancelled, setCancelled] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const running = useRef(false);

  useEffect(() => {
    let alive = true;
    getSources().then((items) => {
      if (!alive) return;
      setSources(items.filter((source) => source.enabled && source.currentVersion?.processingStatus === 'ready'));
      setSourceError('');
    }).catch((e) => { if (alive) setSourceError(e instanceof Error ? e.message : 'Bronnen konden niet worden geladen.'); });
    return () => { alive = false; };
  }, [sourceAttempt]);
  useEffect(() => () => controller.current?.abort(), []);

  const selectedIds = selection === null ? sources?.map((source) => source.id) ?? [] : selection.filter((id) => sources?.some((source) => source.id === id));
  const emptyScope = sources !== null && selectedIds.length === 0;
  const sourceIds = selection === null ? undefined : selectedIds;

  function toggleSource(id: string) {
    setSelection(selectedIds.includes(id) ? selectedIds.filter((value) => value !== id) : [...selectedIds, id]);
  }

  async function submit() {
    if (running.current || !question.trim() || emptyScope) return;
    running.current = true;
    const abort = new AbortController(); controller.current = abort;
    setError(null); setCancelled(false);
    const asked = question.trim();
    try {
      await reviewNavigation.flush();
      if (abort.signal.aborted) return;
      setBusy(true); setAnswer(null); setPartial('');
      if (!streamingEnabled) {
        const result = await askQuestion(asked, sourceIds, abort.signal);
        if (!abort.signal.aborted) setAnswer(result);
        return;
      }
      try {
        await streamAnswer(asked, {
          partial: (text) => { if (!abort.signal.aborted) setPartial(text); },
          final: (result) => { if (!abort.signal.aborted) { setAnswer(result); setPartial(''); } },
        }, sourceIds, abort.signal);
      } catch (e) {
        // Only a missing route before a stream starts can safely fall back:
        // retrying a started generation could create duplicate answers/costs.
        if (e instanceof ApiClientError && (e.status === 404 || e.status === 405)) {
          const result = await askQuestion(asked, sourceIds, abort.signal);
          if (!abort.signal.aborted) setAnswer(result);
        } else throw e;
      }
    } catch (e) {
      if (!abort.signal.aborted) setError(e instanceof ApiClientError ? e : new ApiClientError('unknown', e instanceof Error ? e.message : 'Het opstellen is mislukt.'));
    } finally {
      if (controller.current === abort) {
        setBusy(false); setPartial(''); running.current = false; controller.current = null;
      }
    }
  }

  function cancel() { controller.current?.abort(); setCancelled(true); }

  return <>
    <div className="page-heading"><div><p className="eyebrow">VAN VRAAG NAAR ONDERBOUWD ANTWOORD</p><h1>Nieuwe vraag</h1><p>Een voorstel uit uw bronnen. U controleert en beslist.</p></div>{sources && <Badge tone="green">{sources.length} bronnen actief</Badge>}</div>
    {sourceError && <div className="notice notice-amber" role="alert"><p>De actieve bronnen konden niet worden geladen. {sourceError}</p><button disabled={busy} onClick={() => setSourceAttempt((value) => value + 1)}>Bronnen opnieuw laden</button> <Link href="/bronnen">Bekijk Bronnen</Link></div>}
    <QuestionForm question={question} onChange={setQuestion} onSubmit={() => void submit()} busy={busy} disabled={emptyScope || reviewNavigation.saving}>
      <details className="source-scope"><summary>Beperk tot bronnen {selection !== null && `(${selectedIds.length} geselecteerd)`}</summary>
        <p className="muted">Standaard worden alle actieve, verwerkte bronnen doorzocht.</p>
        {!sources ? <p role="status">{sourceError ? 'Bronselectie is niet beschikbaar.' : 'Bronnen laden…'}</p> : sources.length === 0 ? <p>Er zijn geen actieve, verwerkte bronnen. <Link href="/bronnen">Voeg een bron toe of schakel een bron in.</Link></p> : <fieldset disabled={busy || reviewNavigation.saving} className="scope-options"><legend className="sr-only">Bronnen voor deze vraag</legend>
          <div className="actions"><button type="button" onClick={() => setSelection(null)}>Alle bronnen</button><button type="button" onClick={() => setSelection([])}>Selectie wissen</button></div>
          {sources.map((source) => <label key={source.id} className="checkbox-label"><input type="checkbox" checked={selectedIds.includes(source.id)} onChange={() => toggleSource(source.id)} />{source.title}</label>)}
        </fieldset>}
        {emptyScope && <p className="notice notice-amber">Selecteer minstens één actieve bron om een vraag te stellen.</p>}
      </details>
    </QuestionForm>
    <details className="direct-search"><summary>Zoek rechtstreeks in de bronnen (zonder AI)</summary><SearchPanel /></details>
    <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">{busy ? 'Bronnen doorzoeken en antwoord opstellen.' : answer ? 'Het antwoord is klaar. Controleer de bronverwijzingen en beoordeel de tekst.' : ''}</p>
    <div aria-busy={busy}>
      {busy && <section className="card loading-card"><div><span className="spinner" aria-hidden="true" /><h2>{partial ? 'Antwoord wordt opgesteld…' : 'Bronnen doorzoeken en antwoord opstellen…'}</h2><p className="muted">Dit duurt doorgaans 10–25 s. Bronverwijzingen worden beschikbaar zodra het antwoord is gecontroleerd.</p></div>
        {partial ? <div className="answer-text streaming-text" aria-label="Antwoord in opbouw">{partial}</div> : <><div className="skeleton" /><div className="skeleton short" /></>}
        <button className="text-button" onClick={cancel}>Weergave stoppen</button>
      </section>}
      {error && <section role="alert" className="card notice-red"><h2>Er ging iets mis bij het opstellen van het antwoord.</h2><details><summary>Technische informatie</summary><p>{error.message}</p></details><div className="actions"><button onClick={() => void submit()} disabled={emptyScope}>Opnieuw proberen</button>{error.code === 'no_model_configured' && <Link href="/instellingen">Ga naar Instellingen</Link>}{error.status === 401 && <Link href="/login">Opnieuw aanmelden</Link>}</div></section>}
    </div>
    {cancelled && <p className="notice notice-amber" role="status">De weergave is gestopt. De verwerking op de server kan nog lopen; controleer <Link href="/geschiedenis">Geschiedenis</Link> voordat u opnieuw probeert.</p>}
    {answer ? <AnswerWorkspace key={answer.id} initialAnswer={answer} /> : !busy && !error && !cancelled && <div className="empty-state"><span className="empty-icon" aria-hidden="true">↗</span><h2>Elk antwoord begint bij een bron</h2><p>Stel een vraag om een voorstel van antwoord te krijgen op basis van de ingeschakelde bronnen.</p><div className="workflow-hint"><span>1 · Stel uw vraag</span><span>2 · Controleer het bewijs</span><span>3 · Beoordeel het antwoord</span></div></div>}
  </>;
}

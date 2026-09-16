'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { ApiClientError, askQuestion, getSources } from '@/lib/api-client';
import type { Answer } from '@/lib/types';
import { AnswerWorkspace } from './AnswerWorkspace';
import { QuestionForm } from './QuestionForm';
import { Badge } from './Badge';
export function QuestionPage() {
  const [question, setQuestion] = useState(''); const [answer, setAnswer] = useState<Answer | null>(null); const [busy, setBusy] = useState(false); const [error, setError] = useState<ApiClientError | null>(null); const [count, setCount] = useState<number | null>(null); const [sourceError, setSourceError] = useState(false); const running = useRef(false);
  useEffect(() => { let alive = true; getSources().then((sources) => { if (alive) setCount(sources.filter((s) => s.enabled && s.currentVersion?.processingStatus === 'ready').length); }).catch(() => { if (alive) setSourceError(true); }); return () => { alive = false; }; }, []);
  async function submit() { if (running.current || !question.trim()) return; running.current = true; setBusy(true); setError(null); setAnswer(null); try { setAnswer(await askQuestion(question.trim())); } catch (e) { setError(e instanceof ApiClientError ? e : new ApiClientError('unknown', e instanceof Error ? e.message : 'Onbekende fout.')); } finally { setBusy(false); running.current = false; } }
  return <><div className="page-heading"><div><p className="eyebrow">VAN VRAAG NAAR ONDERBOUWD ANTWOORD</p><h1>Nieuwe vraag</h1><p>Een voorstel uit uw bronnen. U controleert en beslist.</p></div>{count !== null && <Badge tone="green">{count} bronnen actief</Badge>}</div>{sourceError && <p className="notice notice-amber">De actieve bronnen konden niet worden geladen. <Link href="/bronnen">Bekijk Bronnen</Link>.</p>}<QuestionForm question={question} onChange={setQuestion} onSubmit={() => void submit()} busy={busy} />
    <div aria-live="polite" aria-busy={busy}>{busy && <div className="card loading-card" role="status"><span className="spinner" aria-hidden="true" /><h2>Bronnen doorzoeken en antwoord opstellen…</h2><p className="muted">Dit duurt doorgaans 10–25 s.</p><div className="skeleton" /><div className="skeleton short" /></div>}{error && <section role="alert" className="card notice-red"><h2>Er ging iets mis bij het opstellen van het antwoord.</h2><details><summary>Technische informatie</summary><p>{error.message}</p></details><div className="actions"><button onClick={() => void submit()}>Opnieuw proberen</button>{error.code === 'no_model_configured' && <Link href="/instellingen">Ga naar Instellingen</Link>}</div></section>}</div>
    {answer ? <AnswerWorkspace key={answer.id} initialAnswer={answer} /> : !busy && !error && <div className="empty-state"><span className="empty-icon" aria-hidden="true">↗</span><h2>Elk antwoord begint bij een bron</h2><p>Stel een vraag om een voorstel van antwoord te krijgen op basis van de ingeschakelde bronnen.</p><div className="workflow-hint"><span>1 · Stel uw vraag</span><span>2 · Controleer het bewijs</span><span>3 · Beoordeel het antwoord</span></div></div>}
  </>;
}

'use client';
import { useLocale } from './LanguageProvider';

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
  const { t } = useLocale();
  const reviewNavigation = useReviewNavigation();
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [busy, setBusy] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
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
  const startedAt = useRef(0);
  const progressPanel = useRef<HTMLElement | null>(null);

  useEffect(() => {
    let alive = true;
    getSources().then((items) => {
      if (!alive) return;
      setSources(items.filter((source) => source.enabled && source.currentVersion?.processingStatus === 'ready'));
      setSourceError('');
    }).catch((e) => { if (alive) setSourceError(e instanceof Error ? e.message : t("Bronnen konden niet worden geladen.")); });
    return () => { alive = false; };
  }, [sourceAttempt]);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    if (!busy) return;
    progressPanel.current?.scrollIntoView({ block: 'nearest', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    const timer = window.setInterval(() => setElapsedSeconds(Math.floor((Date.now() - startedAt.current) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [busy]);

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
      startedAt.current = Date.now(); setElapsedSeconds(0);
      setBusy(true); setAnswer(null); setPartial('');
      if (!streamingEnabled) {
        const result = await askQuestion(asked, sourceIds, abort.signal);
        if (!abort.signal.aborted) setAnswer(result);
        return;
      }
      await streamAnswer(asked, {
        partial: (text) => { if (!abort.signal.aborted) setPartial(text); },
        final: (result) => { if (!abort.signal.aborted) { setAnswer(result); setPartial(''); } },
      }, sourceIds, abort.signal);
    } catch (e) {
      if (!abort.signal.aborted) setError(e instanceof ApiClientError ? e : new ApiClientError('unknown', e instanceof Error ? e.message : t("Het opstellen is mislukt.")));
    } finally {
      if (controller.current === abort) {
        setBusy(false); setPartial(''); running.current = false; controller.current = null;
      }
    }
  }

  function cancel() { controller.current?.abort(); setCancelled(true); }

  return <>
    <section className="question-hero" aria-labelledby="question-title"><div className="hero-copy"><p className="hero-kicker"><span aria-hidden="true" />{t("UW KENNIS, BINNEN HANDBEREIK")}</p><h1 id="question-title" className="hero-title">{t("Van vraag naar")}<br /><em>{t("helder antwoord.")}</em></h1><p className="hero-description">{t("Breng uw bronnen samen. Vind het bewijs.")}<br />{t("Help ondernemers verder, met uw oordeel als kompas.")}</p></div><div className="hero-art" aria-hidden="true"><div className="orbit-ring" /><div className="orbit-ring orbit-ring-inner" /><div className="orbit-document orbit-document-back"><svg viewBox="0 0 52 64" fill="none"><path d="M10 3h23l12 12v45H10z" fill="currentColor" opacity=".1" /><path d="M10 3h23l12 12v45H10zM33 3v13h12M18 28h19M18 36h19M18 44h12" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /></svg></div><div className="orbit-document orbit-document-front"><span>{t("VAN BRON")}</span><svg viewBox="0 0 52 64" fill="none"><path d="M10 3h23l12 12v45H10zM33 3v13h12M18 28h19M18 36h19M18 44h12" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /></svg><strong>{t("naar inzicht")}</strong></div><div className="orbit-core"><svg width="25" height="25" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="m5 12 4 4L19 6" /></svg></div></div>{sources && <div className="hero-source-pill"><span aria-hidden="true" /><strong>{sources.length}</strong>{' '}{t("bronnen actief")}<Badge>{t("Uw werkruimte")}</Badge></div>}</section>
    {sourceError && <div className="notice notice-amber" role="alert"><p>{t("De actieve bronnen konden niet worden geladen.")}{' '}{sourceError}</p><button disabled={busy} onClick={() => setSourceAttempt((value) => value + 1)}>{t("Bronnen opnieuw laden")}</button> <Link href="/bronnen">{t("Bekijk Bronnen")}</Link></div>}
    <QuestionForm question={question} onChange={setQuestion} onSubmit={() => void submit()} busy={busy} disabled={emptyScope || reviewNavigation.saving}>
      <details className="source-scope"><summary>{t("Beperk tot bronnen")}{' '}{selection !== null && t('({n} geselecteerd)', { n: selectedIds.length })}</summary>
        <p className="muted">{t("Standaard worden alle actieve, verwerkte bronnen doorzocht.")}</p>
        {!sources ? <p role="status">{sourceError ? t("Bronselectie is niet beschikbaar.") : t("Bronnen laden…")}</p> : sources.length === 0 ? <p>{t("Er zijn geen actieve, verwerkte bronnen.")}{' '}<Link href="/bronnen">{t("Voeg een bron toe of schakel een bron in.")}</Link></p> : <fieldset disabled={busy || reviewNavigation.saving} className="scope-options"><legend className="sr-only">{t("Bronnen voor deze vraag")}</legend>
          <div className="actions"><button type="button" onClick={() => setSelection(null)}>{t("Alle bronnen")}</button><button type="button" onClick={() => setSelection([])}>{t("Selectie wissen")}</button></div>
          {sources.map((source) => <label key={source.id} className="checkbox-label"><input type="checkbox" checked={selectedIds.includes(source.id)} onChange={() => toggleSource(source.id)} />{source.title}</label>)}
        </fieldset>}
        {emptyScope && <p className="notice notice-amber">{t("Selecteer minstens één actieve bron om een vraag te stellen.")}</p>}
      </details>
    </QuestionForm>
    <details className="direct-search"><summary>{t("Zoek rechtstreeks in de bronnen (zonder AI)")}</summary><SearchPanel /></details>
    <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">{busy ? t("Bronnen doorzoeken en antwoord opstellen.") : answer ? t("Het antwoord is klaar. Controleer de bronverwijzingen en beoordeel de tekst.") : ''}</p>
    <div aria-busy={busy}>
      {busy && <section ref={progressPanel} className="card loading-card"><div><span className="spinner" aria-hidden="true" /><div className="section-heading"><h2>{partial ? t("Antwoord wordt opgesteld…") : t("Bronnen doorzoeken en antwoord opstellen…")}</h2><span aria-live="off"><Badge>{t('{seconds} s verstreken', { seconds: elapsedSeconds })}</Badge></span></div><p role="status" aria-live="polite">{partial ? t('Antwoordtekst wordt ontvangen. Bronverwijzingen worden daarna gecontroleerd.') : streamingEnabled ? t('Verzoek verzonden. Wachten op de eerste antwoordtekst.') : t('Verzoek verzonden. Wachten op het gecontroleerde antwoord.')}</p><p className="muted">{t('Uitgebreide redenering kan langer duren voordat er tekst verschijnt. De uiteindelijke tekst en bronverwijzingen verschijnen na controle.')}</p>{elapsedSeconds >= 30 && !partial && <p className="notice notice-amber">{t('We wachten nog op het antwoord van de server. U hoeft de vraag niet opnieuw te verzenden.')}</p>}</div>
        {partial ? <div className="answer-text streaming-text" aria-label={t("Antwoord in opbouw")}>{partial}</div> : <><div className="skeleton" /><div className="skeleton short" /></>}
        <button className="text-button" onClick={cancel}>{t("Weergave stoppen")}</button>
      </section>}
      {error && <section role="alert" className="card notice-red"><h2>{t("Er ging iets mis bij het opstellen van het antwoord.")}</h2><details><summary>{t("Technische informatie")}</summary><p>{error.message}</p></details><div className="actions"><button onClick={() => void submit()} disabled={emptyScope}>{t("Opnieuw proberen")}</button>{error.code === 'no_model_configured' && <Link href="/instellingen">{t("Ga naar Instellingen")}</Link>}{error.status === 401 && <Link href="/login">{t("Opnieuw aanmelden")}</Link>}</div></section>}
    </div>
    {cancelled && <p className="notice notice-amber" role="status">{t("De weergave is gestopt. De verwerking op de server kan nog lopen; controleer")}{' '}<Link href="/geschiedenis">{t("Geschiedenis")}</Link>{' '}{t("voordat u opnieuw probeert.")}</p>}
    {answer ? <AnswerWorkspace key={answer.id} initialAnswer={answer} /> : !busy && !error && !cancelled && <section className="workflow-overview" aria-label={t("Uw werkwijze")}><div className="workflow-step"><span className="workflow-number">01</span><div><h3>{t("Stel uw vraag")}</h3><p>{t("In uw eigen woorden, met de context die ertoe doet.")}</p></div></div><div className="workflow-step"><span className="workflow-number">02</span><div><h3>{t("Volg het bewijs")}</h3><p>{t("Bekijk de exacte passage, het artikel en de bronversie.")}</p></div></div><div className="workflow-step"><span className="workflow-number">03</span><div><h3>{t("U beslist")}</h3><p>{t("Pas aan, keur goed en deel een zorgvuldig antwoord.")}</p></div></div></section>}
  </>;
}

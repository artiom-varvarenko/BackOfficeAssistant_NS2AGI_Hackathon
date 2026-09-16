'use client';
import { useLocale } from './LanguageProvider';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { ApiClientError, createEmailDraft, getAnswer, regenerateAnswer, updateAnswer, updateCitation, type ReviewPatch } from '@/lib/api-client';
import type { Answer } from '@/lib/types';
import { AnswerView } from './AnswerView';
import { Badge, dateLabel } from './Badge';
import { EvidencePanel } from './EvidencePanel';
import { HistoryAnswerBlocks, HistoryDetail } from './HistoryDetail';
import { ReviewCard, type ReviewCardHandle } from './ReviewCard';
import { UncertaintyCard } from './UncertaintyCard';

export function AnswerWorkspace({ initialAnswer, history = false }: { initialAnswer: Answer; history?: boolean }) {
  const { t, locale } = useLocale();
  const router = useRouter();
  const [answer, setAnswer] = useState(initialAnswer);
  const [activeMarker, setActiveMarker] = useState<number | null>(null);
  const [pending, setPending] = useState(0);
  const [error, setError] = useState('');
  const [needsSettings, setNeedsSettings] = useState(false);
  const [action, setAction] = useState<'regenerate' | 'export' | null>(null);
  const [previousDate, setPreviousDate] = useState<string | null>(null);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const currentAnswer = useRef(initialAnswer);
  const review = useRef<ReviewCardHandle>(null);
  const actionLock = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    if (!answer.regeneratedFromId) return;
    let alive = true;
    getAnswer(answer.regeneratedFromId).then((previous) => { if (alive) setPreviousDate(previous.createdAt); }).catch(() => undefined);
    return () => { alive = false; };
  }, [answer.regeneratedFromId]);

  function report(reason: unknown) {
    setError(reason instanceof Error ? reason.message : t("Wijzigingen konden niet worden opgeslagen."));
    setNeedsSettings(reason instanceof ApiClientError && reason.code === 'no_model_configured');
  }

  function mutate(operation: () => Promise<Answer>): Promise<Answer> {
    setPending((count) => count + 1);
    const result = queue.current.catch(() => undefined).then(operation).then((updated) => {
      currentAnswer.current = updated;
      setAnswer(updated);
      setError('');
      setNeedsSettings(false);
      return updated;
    }).catch((reason) => { report(reason); throw reason; }).finally(() => setPending((count) => count - 1));
    queue.current = result;
    return result;
  }

  async function awaitIdle(): Promise<Answer> {
    let operation: Promise<unknown>;
    do { operation = queue.current; await operation.catch(() => undefined); } while (operation !== queue.current);
    return currentAnswer.current;
  }

  const save = (patch: ReviewPatch) => mutate(() => updateAnswer(initialAnswer.id, patch));
  const email = () => mutate(() => createEmailDraft(initialAnswer.id));

  async function check(marker: number, checked: boolean, note?: string) {
    try { await mutate(() => updateCitation(initialAnswer.id, marker, { checked, checkNote: note || null })); }
    catch { /* Shared alert reports failures. */ }
  }

  function selectChip(marker: number) {
    setActiveMarker(marker);
    const card = document.getElementById(`citation-${marker}`);
    card?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'nearest' });
    card?.focus({ preventScroll: true });
  }

  async function regenerate() {
    if (actionLock.current) return;
    actionLock.current = true;
    setAction('regenerate');
    setError('');
    try {
      await review.current?.flush();
      await awaitIdle();
      if (!mounted.current) return;
      const updated = await regenerateAnswer(initialAnswer.id);
      if (mounted.current) router.push(`/geschiedenis/${encodeURIComponent(updated.id)}`);
    } catch (reason) { if (mounted.current) report(reason); }
    finally { actionLock.current = false; if (mounted.current) setAction(null); }
  }

  async function exportJson() {
    if (actionLock.current) return;
    actionLock.current = true;
    setAction('export');
    try {
      const saved = await review.current?.flush() ?? await awaitIdle();
      if (!mounted.current) return;
      const url = URL.createObjectURL(new Blob([JSON.stringify(saved, null, 2)], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `antwoord-${saved.id}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setError('');
    } catch (reason) { if (mounted.current) report(reason); }
    finally { actionLock.current = false; if (mounted.current) setAction(null); }
  }

  const busy = pending > 0 || action !== null;
  const sourcesChanged = answer.sourcesChangedSince || answer.citations.some((citation) => !citation.sourceEnabled || !citation.isCurrentVersion);
  return <>
    {answer.regeneratedFromId && <p><Link href={`/geschiedenis/${encodeURIComponent(answer.regeneratedFromId)}`}>{previousDate ? t('Nieuwe versie van vraag van {date}', { date: dateLabel(previousDate, locale) }) : t("Nieuwe versie van een eerdere vraag")} →</Link></p>}
    {sourcesChanged && <section className="notice notice-amber"><p>{t("Sinds dit antwoord zijn bronnen gewijzigd (vervangen of uitgeschakeld). Het bewijs hieronder is de versie die toen gebruikt werd.")}</p><button type="button" disabled={busy} onClick={() => void regenerate()}>{action === 'regenerate' ? t("Nieuw antwoord opstellen…") : t("Opnieuw genereren met huidige bronnen")}</button></section>}
    {answer.scopeSourceIds !== null && <p><Badge>{t(answer.scopeSourceIds.length === 1 ? 'Beperkt tot {n} bron' : 'Beperkt tot {n} bronnen', { n: answer.scopeSourceIds.length })}</Badge></p>}
    {error && <p role="alert" className="notice notice-red">{error}{needsSettings && <> <Link href="/instellingen">{t("Ga naar Instellingen")}</Link></>}</p>}
    <div className="answer-grid"><div className="answer-column">
      {history ? <HistoryAnswerBlocks answer={answer} activeMarker={activeMarker} onSelect={selectChip} /> : <AnswerView answer={answer} activeMarker={activeMarker} onSelect={selectChip} />}
      <UncertaintyCard answer={answer} />
      <ReviewCard ref={review} answer={answer} onSave={save} onAwaitIdle={awaitIdle} onEmailDraft={email} busy={busy} locked={action !== null} />
    </div><EvidencePanel citations={answer.citations} activeMarker={activeMarker} onSelect={setActiveMarker} onCheck={check} busy={busy} /></div>
    {history && <HistoryDetail answer={answer} onExport={exportJson} busy={busy} />}
  </>;
}

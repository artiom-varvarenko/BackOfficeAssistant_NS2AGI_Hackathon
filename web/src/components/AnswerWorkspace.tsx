'use client';
import { useRef, useState } from 'react';
import { updateAnswer, updateCitation, type ReviewPatch } from '@/lib/api-client';
import type { Answer } from '@/lib/types';
import { AnswerView } from './AnswerView';
import { EvidencePanel } from './EvidencePanel';
import { ReviewCard } from './ReviewCard';
import { UncertaintyCard } from './UncertaintyCard';
export function AnswerWorkspace({ initialAnswer }: { initialAnswer: Answer }) {
  const [answer, setAnswer] = useState(initialAnswer); const [activeMarker, setActiveMarker] = useState<number | null>(null); const [pending, setPending] = useState(0); const [error, setError] = useState('');
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  function mutate(action: () => Promise<Answer>): Promise<Answer> {
    setPending((count) => count + 1);
    const operation = queue.current.catch(() => undefined).then(action).then((updated) => { setAnswer(updated); setError(''); return updated; }).catch((e) => { setError(e instanceof Error ? e.message : 'Wijzigingen konden niet worden opgeslagen.'); throw e; }).finally(() => setPending((count) => count - 1));
    queue.current = operation; return operation;
  }
  const save = (patch: ReviewPatch) => mutate(() => updateAnswer(answer.id, patch));
  async function check(marker: number, checked: boolean, note?: string) { try { await mutate(() => updateCitation(answer.id, marker, { checked, checkNote: note || null })); } catch { /* Shared alert reports failures. */ } }
  function selectChip(marker: number) { setActiveMarker(marker); const card = document.getElementById(`citation-${marker}`); card?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'nearest' }); card?.focus({ preventScroll: true }); }
  return <>{error && <p role="alert" className="notice notice-red">{error}</p>}<div className="answer-grid"><div className="answer-column"><AnswerView answer={answer} activeMarker={activeMarker} onSelect={selectChip} /><UncertaintyCard answer={answer} /><ReviewCard answer={answer} onSave={save} busy={pending > 0} /></div><EvidencePanel citations={answer.citations} activeMarker={activeMarker} onSelect={setActiveMarker} onCheck={check} busy={pending > 0} /></div></>;
}

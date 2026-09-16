'use client';
import { useEffect, useRef, useState } from 'react';
import type { Answer, AnswerStatus } from '@/lib/types';
import type { ReviewPatch } from '@/lib/api-client';
import { Badge, StatusBadge } from './Badge';

export function copyTextWithSources(text: string, answer: Answer) {
  return `${text}\n\nBronnen:\n${answer.citations.map((c) => `[${c.marker}] ${c.sourceTitle} — ${[c.article, c.section].filter(Boolean).join(' ') || 'Passage'} — p. ${c.pageStart}${c.pageEnd !== c.pageStart ? `–${c.pageEnd}` : ''} — ${c.originalUrl ?? '(intern document)'}`).join('\n')}`;
}
export function ReviewCard({ answer, onSave, busy }: { answer: Answer; onSave: (patch: ReviewPatch) => Promise<Answer>; busy: boolean }) {
  const [text, setText] = useState(answer.reviewedAnswer ?? answer.generatedAnswer); const [note, setNote] = useState(answer.reviewNote ?? '');
  const [message, setMessage] = useState(''); const [error, setError] = useState(''); const [acting, setActing] = useState(false);
  const previousStatus = useRef(answer.status);
  const changed = text !== (answer.reviewedAnswer ?? answer.generatedAnswer) || note !== (answer.reviewNote ?? '');
  const saveRef = useRef(onSave); saveRef.current = onSave;
  const latest = useRef({ answer, text, note }); latest.current = { answer, text, note };
  useEffect(() => { if (previousStatus.current === 'approved' && answer.status === 'draft') setMessage('Teruggezet naar concept omdat de tekst is gewijzigd.'); previousStatus.current = answer.status; }, [answer.status]);
  useEffect(() => {
    if (!changed || acting) return;
    const timer = setTimeout(() => {
      const state = latest.current;
      void saveRef.current({ reviewedAnswer: state.text, reviewNote: state.note || null, ...(state.text !== (state.answer.reviewedAnswer ?? state.answer.generatedAnswer) ? { status: 'draft' as const } : {}) }).then(() => setError('')).catch((e) => setError(e instanceof Error ? e.message : 'Opslaan mislukt.'));
    }, 600);
    return () => clearTimeout(timer);
  }, [text, note, changed, acting]);
  async function save(status?: AnswerStatus) {
    setError(''); setActing(true);
    try {
      if (changed) await onSave({ reviewedAnswer: text, reviewNote: note || null, ...(text !== (answer.reviewedAnswer ?? answer.generatedAnswer) ? { status: 'draft' } : {}) });
      if (status) await onSave({ status, reviewNote: note || null });
      setMessage(status === 'approved' ? 'Antwoord goedgekeurd.' : status === 'rejected' ? 'Antwoord afgewezen.' : status === 'draft' ? 'Antwoord heropend als concept.' : 'Wijzigingen opgeslagen.');
    } catch (e) { setError(e instanceof Error ? e.message : 'Opslaan mislukt.'); } finally { setActing(false); }
  }
  async function copy() { try { await navigator.clipboard.writeText(copyTextWithSources(text, answer)); setMessage('Gekopieerd, inclusief bronvermelding'); } catch { setError('Kopiëren is niet gelukt. Geef de browser toegang tot het klembord of selecteer en kopieer de tekst handmatig.'); } }
  return <section className="card review-card"><div className="section-heading"><h2>Beoordeling door de medewerker</h2><StatusBadge status={changed && text !== (answer.reviewedAnswer ?? answer.generatedAnswer) ? 'draft' : answer.status} /></div>
    <p className="muted">{answer.citations.filter((c) => c.checked).length}/{answer.citations.length} passages gecontroleerd</p>
    <label className="field">Tekst voor communicatie (bewerkbaar)<textarea rows={11} value={text} disabled={acting} onChange={(event) => setText(event.target.value)} /></label>
    <div className="review-meta"><Badge tone={text !== answer.generatedAnswer ? 'amber' : 'neutral'}>{text !== answer.generatedAnswer ? 'Aangepast door medewerker' : 'Ongewijzigd t.o.v. het gegenereerde antwoord'}</Badge><button type="button" className="text-button" onClick={() => setText(answer.generatedAnswer)} disabled={acting || text === answer.generatedAnswer}>Herstel gegenereerde tekst</button></div>
    <label className="field">Opmerking (optioneel)<textarea rows={2} value={note} disabled={acting} onChange={(event) => setNote(event.target.value)} /></label>
    <div className="actions"><button className="primary" disabled={busy || acting || (!changed && answer.status === 'approved')} onClick={() => void save('approved')}>Goedkeuren</button><button className="danger-button" disabled={busy || acting || (!changed && answer.status === 'rejected')} onClick={() => void save('rejected')}>Afwijzen</button>{answer.status !== 'draft' && <button disabled={busy || acting} onClick={() => void save('draft')}>Heropenen</button>}<button disabled={busy || acting || !changed} onClick={() => void save()}>Wijzigingen opslaan</button></div>
    <div className="actions"><button onClick={() => void copy()}>Kopieer tekst</button></div><p className="muted">U bepaalt welke tekst wordt gebruikt. Er wordt niets automatisch verzonden.</p>
    <p className="save-status" role="status" aria-live="polite">{busy ? 'Wijzigingen opslaan…' : changed ? 'Niet-opgeslagen wijzigingen' : message || 'Alle wijzigingen opgeslagen.'}</p>{error && <p className="notice notice-red" role="alert">{error}</p>}
  </section>;
}

'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { Answer, AnswerStatus } from '@/lib/types';
import { ApiClientError, readAnswerAloud, type ReviewPatch } from '@/lib/api-client';
import { Badge, StatusBadge } from './Badge';
import { EmailDraftModal } from './EmailDraftModal';
import { ReadAloudButton } from './ReadAloudButton';
import { readReviewDraft, useReviewNavigation, writeReviewDraft, type ReviewDraft } from './ReviewNavigation';
import { useToast } from './Toast';

export function copyTextWithSources(text: string, answer: Answer) {
  return `${text}\n\nBronnen:\n${answer.citations.map((c) => `[${c.marker}] ${c.sourceTitle} — ${[c.article, c.section].filter(Boolean).join(' ') || 'Passage'} — p. ${c.pageStart}${c.pageEnd !== c.pageStart ? `–${c.pageEnd}` : ''} — ${c.originalUrl ?? '(intern document)'}`).join('\n')}`;
}

export interface ReviewCardHandle { flush: () => Promise<Answer> }
interface ReviewCardProps {
  answer: Answer;
  onSave: (patch: ReviewPatch) => Promise<Answer>;
  onAwaitIdle: () => Promise<Answer>;
  onEmailDraft: () => Promise<Answer>;
  busy: boolean;
  locked?: boolean;
}

export const ReviewCard = forwardRef<ReviewCardHandle, ReviewCardProps>(function ReviewCard({ answer, onSave, onAwaitIdle, onEmailDraft, busy, locked = false }, ref) {
  const router = useRouter();
  const toast = useToast();
  const navigation = useReviewNavigation();
  const [text, setText] = useState(answer.reviewedAnswer ?? answer.generatedAnswer);
  const [note, setNote] = useState(answer.reviewNote ?? '');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [needsSettings, setNeedsSettings] = useState(false);
  const [acting, setActing] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const [recoveredDraft, setRecoveredDraft] = useState<ReviewDraft | null>(null);
  const previousStatus = useRef(answer.status);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const actionLock = useRef(false);
  const reviewQueue = useRef<Promise<unknown>>(Promise.resolve());
  const latest = useRef({ answer, text, note, onSave, onAwaitIdle });
  latest.current = { answer, text, note, onSave, onAwaitIdle };
  const textChanged = text !== (answer.reviewedAnswer ?? answer.generatedAnswer);
  const changed = textChanged || note !== (answer.reviewNote ?? '');
  const controlsBusy = busy || navigation.saving;

  function rememberDraft(nextText: string, nextNote: string) {
    const current = latest.current.answer;
    const baseText = current.reviewedAnswer ?? current.generatedAnswer;
    const baseNote = current.reviewNote ?? '';
    writeReviewDraft(current.id, nextText === baseText && nextNote === baseNote ? null : { text: nextText, note: nextNote, baseText, baseNote });
  }

  function changeText(value: string) {
    latest.current.text = value;
    rememberDraft(value, latest.current.note);
    setText(value);
  }

  function changeNote(value: string) {
    latest.current.note = value;
    rememberDraft(latest.current.text, value);
    setNote(value);
  }

  // Compare queued edits against persisted state after preceding mutations finish.
  function flush(): Promise<Answer> {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const snapshot = { text: latest.current.text, note: latest.current.note };
    const operation = reviewQueue.current.catch(() => undefined).then(async () => {
      const current = await latest.current.onAwaitIdle();
      const edited = snapshot.text !== (current.reviewedAnswer ?? current.generatedAnswer);
      if (!edited && snapshot.note === (current.reviewNote ?? '')) return current;
      return latest.current.onSave({ reviewedAnswer: snapshot.text, reviewNote: snapshot.note || null, ...(edited ? { status: 'draft' as const } : {}) });
    }).then((saved) => {
      const local = readReviewDraft(saved.id);
      if (latest.current.text === snapshot.text && latest.current.note === snapshot.note && local?.text === snapshot.text && local.note === snapshot.note) writeReviewDraft(saved.id, null);
      return saved;
    });
    reviewQueue.current = operation;
    return operation;
  }

  useImperativeHandle(ref, () => ({ flush }));

  const registered = useRef({ needsSave: changed || busy || acting, flush });
  registered.current = { needsSave: changed || busy || acting, flush };
  useEffect(() => navigation.register({
    needsSave: () => registered.current.needsSave,
    flush: () => registered.current.flush(),
  }), [navigation.register, answer.id]);

  useEffect(() => {
    const local = readReviewDraft(answer.id);
    if (!local) return;
    const savedText = answer.reviewedAnswer ?? answer.generatedAnswer;
    const savedNote = answer.reviewNote ?? '';
    if (local.text === savedText && local.note === savedNote) { writeReviewDraft(answer.id, null); return; }
    if (local.baseText !== savedText || local.baseNote !== savedNote) {
      setRecoveredDraft(local);
      return;
    }
    latest.current.text = local.text;
    latest.current.note = local.note;
    setText(local.text);
    setNote(local.note);
    setMessage('Niet-opgeslagen wijzigingen uit deze browsersessie hersteld.');
  }, [answer.id]);

  useEffect(() => {
    if (previousStatus.current === 'approved' && answer.status === 'draft') setMessage('Teruggezet naar concept omdat de tekst is gewijzigd.');
    previousStatus.current = answer.status;
  }, [answer.status]);

  useEffect(() => {
    if (!changed || acting) return;
    timer.current = setTimeout(() => {
      timer.current = null;
      if (actionLock.current) return;
      void flush().then(() => setError('')).catch((reason) => setError(reason instanceof Error ? reason.message : 'Opslaan mislukt.'));
    }, 600);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [text, note, changed, acting]);

  useEffect(() => {
    if (!changed && !busy) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [changed, busy]);

  async function withSaved<T,>(action: (saved: Answer) => Promise<T>): Promise<T> {
    if (actionLock.current) throw new Error('Wacht tot de lopende actie klaar is.');
    actionLock.current = true;
    setActing(true);
    setError('');
    setNeedsSettings(false);
    try { return await action(await flush()); }
    finally { actionLock.current = false; setActing(false); }
  }

  function report(reason: unknown) {
    setError(reason instanceof Error ? reason.message : 'De actie is mislukt.');
    setNeedsSettings(reason instanceof ApiClientError && reason.code === 'no_model_configured');
  }

  async function save(status?: AnswerStatus) {
    try {
      await withSaved(async () => {
        if (status) await onSave({ status, reviewNote: latest.current.note || null });
        const confirmation = status === 'approved' ? 'Antwoord goedgekeurd.' : status === 'rejected' ? 'Antwoord afgewezen.' : status === 'draft' ? 'Antwoord heropend als concept.' : 'Wijzigingen opgeslagen.';
        setMessage(confirmation);
        toast(confirmation);
      });
    } catch (reason) { report(reason); }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(copyTextWithSources(text, answer));
      setMessage('Gekopieerd, inclusief bronvermelding');
      toast('Gekopieerd, inclusief bronvermelding');
    } catch { setError('Kopiëren is niet gelukt. Geef de browser toegang tot het klembord of selecteer en kopieer de tekst handmatig.'); }
  }

  async function email() {
    try {
      await withSaved(async () => {
        const updated = await onEmailDraft();
        if (!updated.emailDraft) throw new Error('De server heeft geen e-mailconcept teruggestuurd. Probeer opnieuw.');
        setDraft(updated.emailDraft);
      });
    } catch (reason) { report(reason); }
  }

  async function briefing() {
    try { await withSaved(async (saved) => { router.push(`/geschiedenis/${encodeURIComponent(saved.id)}/briefing`); }); }
    catch (reason) { report(reason); }
  }

  return <section className="card review-card">
    <div className="section-heading"><h2>Beoordeling door de medewerker</h2><StatusBadge status={textChanged ? 'draft' : answer.status} /></div>
    {recoveredDraft && <section className="notice notice-amber"><p>Er is een niet-opgeslagen concept uit deze browsersessie. Het opgeslagen antwoord is intussen gewijzigd.</p><details><summary>Bekijk het lokale concept</summary><p className="answer-text">{recoveredDraft.text}</p>{recoveredDraft.note && <p className="answer-text">Opmerking: {recoveredDraft.note}</p>}</details><button type="button" disabled={acting || locked || navigation.saving} onClick={() => {
      latest.current.text = recoveredDraft.text;
      latest.current.note = recoveredDraft.note;
      setText(recoveredDraft.text);
      setNote(recoveredDraft.note);
      rememberDraft(recoveredDraft.text, recoveredDraft.note);
      setRecoveredDraft(null);
    }}>Herstel lokaal concept in het tekstveld</button> <button type="button" disabled={acting || locked || navigation.saving} onClick={() => { writeReviewDraft(answer.id, null); setRecoveredDraft(null); }}>Gebruik opgeslagen tekst</button></section>}
    <p className="muted">{answer.citations.filter((citation) => citation.checked).length}/{answer.citations.length} passages gecontroleerd</p>
    <label className="field">Tekst voor communicatie (bewerkbaar)<textarea rows={11} value={text} disabled={acting || locked || navigation.saving} onChange={(event) => changeText(event.target.value)} /></label>
    <div className="review-meta"><Badge tone={text !== answer.generatedAnswer ? 'amber' : 'neutral'}>{text !== answer.generatedAnswer ? 'Aangepast door medewerker' : 'Ongewijzigd t.o.v. het gegenereerde antwoord'}</Badge><button type="button" className="text-button" onClick={() => changeText(answer.generatedAnswer)} disabled={acting || locked || navigation.saving || text === answer.generatedAnswer}>Herstel gegenereerde tekst</button></div>
    <label className="field">Opmerking (optioneel)<textarea rows={2} value={note} disabled={acting || locked || navigation.saving} onChange={(event) => changeNote(event.target.value)} /></label>
    <div className="actions">
      <button type="button" className="primary" disabled={controlsBusy || acting || (!changed && answer.status === 'approved')} onClick={() => void save('approved')}>Goedkeuren</button>
      <button type="button" className="danger-button" disabled={controlsBusy || acting || (!changed && answer.status === 'rejected')} onClick={() => void save('rejected')}>Afwijzen</button>
      {answer.status !== 'draft' && <button type="button" disabled={controlsBusy || acting} onClick={() => void save('draft')}>Heropenen</button>}
      <button type="button" disabled={controlsBusy || acting || !changed} onClick={() => void save()}>Wijzigingen opslaan</button>
    </div>
    <div className="actions">
      <button type="button" onClick={() => void copy()}>Kopieer tekst</button>
      <button type="button" disabled={controlsBusy || acting} onClick={() => void email()}>Maak e-mailconcept</button>
      <button type="button" disabled={controlsBusy || acting} onClick={() => void briefing()}>Briefing afdrukken</button>
      <ReadAloudButton revision={`${answer.id}:${text}`} disabled={controlsBusy || acting} loadAudio={() => withSaved((saved) => readAnswerAloud(saved.id))} />
    </div>
    {answer.emailDraft && <button type="button" className="text-button" disabled={acting} onClick={() => setDraft(answer.emailDraft)}>Bekijk laatst opgeslagen e-mailconcept</button>}
    <p className="muted">U bepaalt welke tekst wordt gebruikt. Er wordt niets automatisch verzonden.</p>
    <p className="save-status" role="status" aria-live="polite">{acting ? 'Actie uitvoeren…' : busy ? 'Wijzigingen opslaan…' : changed ? 'Niet-opgeslagen wijzigingen' : message || 'Alle wijzigingen opgeslagen.'}</p>
    {error && <p className="notice notice-red" role="alert">{error}{needsSettings && <> <Link href="/instellingen">Ga naar Instellingen</Link></>}</p>}
    {draft !== null && <EmailDraftModal draft={draft} onClose={() => setDraft(null)} />}
  </section>;
});

'use client';

import { useEffect, useRef, useState } from 'react';
import { useToast } from './Toast';

export function EmailDraftModal({ draft, onClose }: { draft: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [text, setText] = useState(draft);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const toast = useToast();

  useEffect(() => {
    const element = dialog.current;
    const previousFocus = document.activeElement;
    element?.showModal();
    return () => {
      element?.close();
      if (previousFocus instanceof HTMLElement) previousFocus.focus();
    };
  }, []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setError('');
      setMessage('E-mailconcept gekopieerd.');
      toast('E-mailconcept gekopieerd.');
    } catch {
      setError('Kopiëren is niet gelukt. Selecteer en kopieer de tekst handmatig.');
    }
  }

  return <dialog ref={dialog} className="email-dialog" aria-labelledby="email-title" aria-describedby="email-description" onCancel={(event) => { event.preventDefault(); onClose(); }}>
    <div className="section-heading"><h2 id="email-title">E-mailconcept</h2><button type="button" onClick={onClose} aria-label="E-mailconcept sluiten">Sluiten</button></div>
    <p id="email-description" className="notice notice-amber">Concept — wordt niet verzonden</p>
    <p className="muted">Controleer de tekst voor gebruik. Aanpassingen in dit venster worden alleen meegenomen bij het kopiëren.</p>
    <label className="field">Tekst van het e-mailconcept<textarea rows={16} autoFocus value={text} onChange={(event) => setText(event.target.value)} /></label>
    <div className="actions"><button type="button" className="primary" onClick={() => void copy()}>Kopieer e-mailconcept</button><button type="button" onClick={onClose}>Sluiten</button></div>
    <p role="status" aria-live="polite">{message}</p>
    {error && <p className="notice notice-red" role="alert">{error}</p>}
  </dialog>;
}

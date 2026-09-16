'use client';

import { useLocale } from './LanguageProvider';
import { useLayoutEffect, useRef, useState } from 'react';

export function EmailDraftModal({ draft, onClose }: { draft: string; onClose: () => void }) {
  const { t } = useLocale();
  const dialog = useRef<HTMLDialogElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const mounted = useRef(false);
  const textRevision = useRef(0);
  const [text, setText] = useState(draft);
  const [copyState, setCopyState] = useState<'idle' | 'copying' | 'copied' | 'error'>('idle');

  useLayoutEffect(() => {
    const element = dialog.current;
    const previousFocus = document.activeElement;
    mounted.current = true;
    element?.showModal();
    textarea.current?.focus();
    return () => {
      mounted.current = false;
      element?.close();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, []);

  function changeText(value: string) {
    textRevision.current += 1;
    setText(value);
    setCopyState((current) => current === 'copying' ? current : 'idle');
  }

  async function copy() {
    if (copyState === 'copying') return;
    const copiedRevision = textRevision.current;
    setCopyState('copying');
    try {
      await navigator.clipboard.writeText(text);
      if (mounted.current) setCopyState(copiedRevision === textRevision.current ? 'copied' : 'idle');
    } catch {
      if (mounted.current) setCopyState(copiedRevision === textRevision.current ? 'error' : 'idle');
    }
  }

  return <dialog ref={dialog} className="email-dialog" aria-labelledby="email-title" aria-describedby="email-description" onCancel={(event) => { event.preventDefault(); onClose(); }}>
    <div className="section-heading"><h2 id="email-title">{t("E-mailconcept")}</h2><button type="button" onClick={onClose} aria-label={t("E-mailconcept sluiten")}>{t("Sluiten")}</button></div>
    <p id="email-description" className="notice notice-amber">{t("Concept — wordt niet verzonden")}</p>
    <p className="muted">{t("Controleer de tekst voor gebruik. Aanpassingen in dit venster worden alleen meegenomen bij het kopiëren.")}</p>
    <label className="field">{t("Tekst van het e-mailconcept")}<textarea ref={textarea} rows={16} value={text} onChange={(event) => changeText(event.target.value)} /></label>
    <div className="actions"><button type="button" className="primary" disabled={copyState === 'copying'} onClick={() => void copy()}>{copyState === 'copying' ? t("Kopiëren…") : t("Kopieer e-mailconcept")}</button><button type="button" onClick={onClose}>{t("Sluiten")}</button></div>
    <p role="status" aria-live="polite">{copyState === 'copied' ? t("E-mailconcept gekopieerd.") : ''}</p>
    {copyState === 'error' && <p className="notice notice-red" role="alert">{t("Kopiëren is niet gelukt. Selecteer en kopieer de tekst handmatig.")}</p>}
  </dialog>;
}

'use client';
import { useLocale } from './LanguageProvider';
import { useRef, type ReactNode } from 'react';
const exampleQuestions = [
  'Ik wil een vaste standplaats op de markt in Schoten. Hoe dien ik een aanvraag in?',
  'Ik wil één keer op zaterdag op de markt staan zonder abonnement. Waar en wanneer moet ik me aanmelden en wat kost dat?',
  'Welke startpremie kan ik als nieuwe zelfstandige in Schoten aanvragen en hoeveel bedraagt die?',
];
export function QuestionForm({ question, onChange, onSubmit, busy, disabled = false, children }: { question: string; onChange: (value: string) => void; onSubmit: () => void; busy: boolean; disabled?: boolean; children?: ReactNode }) {
  const { t } = useLocale();
  const input = useRef<HTMLTextAreaElement>(null);
  const examples = [
    { title: t("Een vaste plek op de markt"), caption: t("Aanvraag & voorwaarden"), icon: '01' },
    { title: t("Eenmalig op de markt"), caption: t("Aanmelden & tarieven"), icon: '02' },
    { title: t("Een eigen zaak starten"), caption: t("Premies & ondersteuning"), icon: '03' },
  ];
  return <form className="card question-card" onSubmit={(event) => { event.preventDefault(); if (!busy && !disabled && question.trim()) onSubmit(); }}>
    <div className="composer-top"><span className="composer-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M20 11.5a7.5 7.5 0 0 1-7.5 7.5H5l-3 3V11.5A7.5 7.5 0 0 1 9.5 4h3a7.5 7.5 0 0 1 7.5 7.5Z" /><path d="M7 10h8M7 14h5" /></svg></span><div><h2 className="composer-label">{t("Waar kunnen we bij helpen?")}</h2><p className="composer-caption">{t("Een goede vraag is het begin van een zorgvuldig antwoord.")}</p></div></div>
    <label className="field composer-editor" htmlFor="question"><span>{t("Vraag van de ondernemer")}</span><textarea id="question" ref={input} placeholder={t("Bijvoorbeeld: hoe vraag ik een vaste standplaats op de markt aan?")} rows={4} value={question} disabled={busy} onChange={(event) => onChange(event.target.value)} onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); if (!busy && !disabled && question.trim()) onSubmit(); } }} /></label>
    {children}
    <div className="question-actions composer-bottom"><span className="keyboard-hint"><kbd>Ctrl</kbd><span>+</span><kbd>Enter</kbd><span>{t("om te zoeken")}</span></span><button className="primary" type="submit" disabled={busy || disabled || !question.trim()}>{busy ? t("Antwoord opstellen…") : t("Zoek antwoord")} <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M5 12h14m-6-6 6 6-6 6" /></svg></button></div>
    <div className="examples"><span className="examples-label">{t("OF BEGIN MET EEN VOORBEELD")}</span><div className="example-grid">{exampleQuestions.map((example, i) => <button className="example-card" type="button" title={t(example)} disabled={busy} key={example} onClick={() => { onChange(t(example)); input.current?.focus(); }}><span className="example-icon" aria-hidden="true">{examples[i].icon}</span><span className="example-copy"><strong>{examples[i].title}</strong><span>{examples[i].caption}</span></span><span className="example-arrow" aria-hidden="true">↗</span></button>)}</div></div>
  </form>;
}

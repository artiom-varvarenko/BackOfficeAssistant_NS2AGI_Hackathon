'use client';
import { useLocale } from './LanguageProvider';
import type { Answer } from '@/lib/types';
import { Badge } from './Badge';

export function CitationChip({ marker, active, onSelect }: { marker: number; active: boolean; onSelect: (marker: number) => void }) {
  const { t } = useLocale();
  return <button type="button" className={`citation-chip ${active ? 'selected' : ''}`} aria-label={t(`Bekijk bronverwijzing ${marker}`)} aria-pressed={active} aria-controls={`citation-${marker}`} onClick={() => onSelect(marker)}>[{marker}]</button>;
}
export function AnswerView({ answer, activeMarker, onSelect }: { answer: Answer; activeMarker: number | null; onSelect: (marker: number) => void }) {
  const { t } = useLocale();
  const render = (text: string) => text.split(/(\[\d+\])/g).map((part, i) => {
    const match = /^\[(\d+)\]$/.exec(part); const marker = match ? Number(match[1]) : null;
    return marker !== null && answer.citations.some((citation) => citation.marker === marker) ? <CitationChip key={i} marker={marker} active={activeMarker === marker} onSelect={onSelect} /> : <span key={i}>{part}</span>;
  });
  return <section className="card answer-card" aria-labelledby="answer-title"><div className="section-heading"><h2 id="answer-title"><span className="answer-emblem" aria-hidden="true">✦</span>{t("Voorgesteld antwoord")}</h2><Badge>{t("AI-voorstel")}</Badge></div><p className="muted answer-provenance">{t("Gegenereerd op basis van")}{' '}{answer.passagesSent}{' '}{t("passages uit")}{' '}{answer.sourcesUsed}{' '}{t("bronnen ·")}{' '}{answer.model}</p>
    {answer.canAnswer !== 'ja' && <p className="notice notice-amber">{answer.canAnswer === 'nee' ? t("De ingeschakelde bronnen bevatten geen antwoord op deze vraag.") : t("Gedeeltelijk beantwoord — zie ontbrekende informatie.")}</p>}
    <div className="answer-text">{answer.generatedAnswer.split(/\n\s*\n/).map((paragraph, index) => {
      const lines = paragraph.split('\n');
      return lines.every((line) => /^\s*(?:[-*•]|\d+[.)])\s/.test(line)) ? <ul key={index}>{lines.map((line, i) => <li key={i}>{render(line.replace(/^\s*(?:[-*•]|\d+[.)])\s/, ''))}</li>)}</ul> : <p key={index}>{render(paragraph)}</p>;
    })}</div>
  </section>;
}

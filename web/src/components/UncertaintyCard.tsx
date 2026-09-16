'use client';
import { useLocale } from './LanguageProvider';
import type { Answer } from '@/lib/types';
export function UncertaintyCard({ answer }: { answer: Answer }) {
  const { t } = useLocale();
  return <section className="card uncertainty"><h2>{t("Onzekerheden en ontbrekende informatie")}</h2>{[
    { title: t("Ontbreekt in de bronnen"), items: answer.gaps, tone: 'amber' },
    { title: t("Waarschuwingen over toepasselijkheid"), items: answer.warnings, tone: 'amber' },
    { title: t("Tegenstrijdige passages"), items: answer.conflicts, tone: 'red' },
  ].map(({ title, items, tone }) => items.length > 0 && <div key={title} className={`notice notice-${tone}`}><h3>{title}</h3><ul>{items.map((item, index) => <li key={index}>{t(item)}</li>)}</ul></div>)}
    {!answer.gaps.length && !answer.warnings.length && !answer.conflicts.length && <p className="muted">{t("Geen onzekerheden gemeld door het systeem. Controle door een medewerker blijft nodig.")}</p>}
    {answer.uncitedSentences > 0 && <p className="notice notice-red">{answer.uncitedSentences}{' '}{t("zin(nen) zonder bronverwijzing — extra controleren.")}</p>}
  </section>;
}

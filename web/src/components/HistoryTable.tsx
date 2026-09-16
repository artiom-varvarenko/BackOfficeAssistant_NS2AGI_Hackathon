'use client';

import { useLocale } from './LanguageProvider';

import Link from 'next/link';
import type { AnswerListItem } from '@/lib/types';
import { dateLabel, StatusBadge } from './Badge';
import { Icon } from './Icon';
export function HistoryTable({ answers }: { answers: AnswerListItem[] }) {
  const { t, locale } = useLocale();
  if (!answers.length) return <div className="card collection-empty"><div className="collection-empty-icon"><Icon name="question" size={28} /></div><div className="collection-empty-copy"><h2>{t("Uw volgende antwoord begint hier")}</h2><p>{t("Nog geen vragen gesteld. Stel een vraag en bouw een overzicht op van uw antwoorden en beoordelingen.")}</p><Link className="button primary" href="/">{t("Stel uw eerste vraag")}<Icon name="chevron-right" size={18} /></Link></div></div>;
  return <div className="table-scroll" tabIndex={0} role="region" aria-label={t("Eerdere vragen, horizontaal verschuifbaar")}><table className="history-table"><caption className="sr-only">{t("Eerdere vragen en beoordelingen")}</caption><thead><tr><th scope="col">{t("Vraag")}</th><th scope="col">{t("Datum")}</th><th scope="col">{t("Status")}</th><th scope="col">{t("Broncontrole")}</th></tr></thead><tbody>{answers.map((answer) => <tr key={answer.id}><td className="history-question"><Link href={`/geschiedenis/${encodeURIComponent(answer.id)}`}>{answer.question}</Link><p className="muted">{answer.citationCount} {answer.citationCount === 1 ? t("bronverwijzing") : t("bronverwijzingen")}</p></td><td><time dateTime={answer.createdAt}>{dateLabel(answer.createdAt, locale)}</time></td><td><StatusBadge status={answer.status} /></td><td className="history-review"><span>{answer.checkedCount}/{answer.citationCount}{' '}{t("gecontroleerd")}</span><progress className="history-progress" value={answer.checkedCount} max={Math.max(1, answer.citationCount)} aria-label={t('{checked} van {total} bronverwijzingen gecontroleerd voor: {question}', { checked: answer.checkedCount, total: answer.citationCount, question: answer.question })} /></td></tr>)}</tbody></table></div>;
}

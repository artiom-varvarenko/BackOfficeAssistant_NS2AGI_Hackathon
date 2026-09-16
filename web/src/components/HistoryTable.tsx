import Link from 'next/link';
import type { AnswerListItem } from '@/lib/types';
import { dateLabel, StatusBadge } from './Badge';
export function HistoryTable({ answers }: { answers: AnswerListItem[] }) {
  if (!answers.length) return <p className="card">Nog geen vragen gesteld.</p>;
  return <div className="table-scroll"><table><caption className="sr-only">Eerdere vragen en beoordelingen</caption><thead><tr><th>Datum</th><th>Vraag</th><th>Status</th><th>Bronverwijzingen</th><th>Controle</th></tr></thead><tbody>{answers.map((answer) => <tr key={answer.id}><td>{dateLabel(answer.createdAt)}</td><td><Link href={`/geschiedenis/${encodeURIComponent(answer.id)}`}>{answer.question}</Link></td><td><StatusBadge status={answer.status} /></td><td>{answer.citationCount} bronverwijzingen</td><td>{answer.checkedCount}/{answer.citationCount} gecontroleerd</td></tr>)}</tbody></table></div>;
}

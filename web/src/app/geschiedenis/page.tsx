'use client';
import { getAnswers } from '@/lib/api-client';
import { ResourceView } from '@/components/ResourceView';
import { HistoryTable } from '@/components/HistoryTable';
export default function HistoryPage() { return <><div className="page-heading"><div><h1>Geschiedenis</h1><p>Vragen, beoordelingen en de bronpassages die toen zijn gebruikt.</p></div></div><ResourceView load={getAnswers} loading="Geschiedenis laden…">{(answers) => <HistoryTable answers={answers} />}</ResourceView></>; }

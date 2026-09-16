'use client';
import Link from 'next/link';
import { use, useCallback } from 'react';
import { getAnswer } from '@/lib/api-client';
import { ResourceView } from '@/components/ResourceView';
import { AnswerWorkspace } from '@/components/AnswerWorkspace';
import { dateLabel } from '@/components/Badge';
export default function HistoryDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params); const load = useCallback(() => getAnswer(id), [id]);
  return <><Link href="/geschiedenis">← Terug naar geschiedenis</Link><ResourceView key={id} load={load} loading="Antwoord laden…">{(answer) => <><div className="page-heading"><div><p className="eyebrow">VRAAG VAN {dateLabel(answer.createdAt)}</p><h1>{answer.question}</h1></div></div>{(answer.sourcesChangedSince || answer.citations.some((c) => !c.sourceEnabled || !c.isCurrentVersion)) && <p className="notice notice-amber">Sinds dit antwoord zijn bronnen gewijzigd (vervangen of uitgeschakeld). Het bewijs hieronder is de versie die toen gebruikt werd.</p>}<AnswerWorkspace key={answer.id} initialAnswer={answer} /></>}</ResourceView></>;
}

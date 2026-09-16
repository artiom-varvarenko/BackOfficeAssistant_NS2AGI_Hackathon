'use client';
import Link from 'next/link';
import { use, useCallback } from 'react';
import { getAnswer } from '@/lib/api-client';
import { ResourceView } from '@/components/ResourceView';
import { AnswerWorkspace } from '@/components/AnswerWorkspace';
import { dateLabel } from '@/components/Badge';
import { useLocale } from '@/components/LanguageProvider';
export default function HistoryDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { locale, t } = useLocale();
  const { id } = use(params); const load = useCallback(() => getAnswer(id), [id]);
  return <><Link href="/geschiedenis">← {t('Terug naar geschiedenis')}</Link><ResourceView key={id} load={load} loading={t('Antwoord laden…')}>{(answer) => <><div className="page-heading"><div><p className="eyebrow">{t('VRAAG VAN {date}', { date: dateLabel(answer.createdAt, locale) })}</p><h1>{answer.question}</h1></div></div><AnswerWorkspace key={answer.id} initialAnswer={answer} history /></>}</ResourceView></>;
}

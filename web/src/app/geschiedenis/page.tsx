'use client';
import { getAnswers } from '@/lib/api-client';
import { ResourceView } from '@/components/ResourceView';
import { HistoryTable } from '@/components/HistoryTable';
import { useLocale } from '@/components/LanguageProvider';
export default function HistoryPage() {
  const { t } = useLocale();
  return <><div className="page-heading"><div><h1>{t('Geschiedenis')}</h1><p>{t('Vragen, beoordelingen en de bronpassages die toen zijn gebruikt.')}</p></div></div><ResourceView load={getAnswers} loading={t('Geschiedenis laden…')}>{(answers) => <HistoryTable answers={answers} />}</ResourceView></>;
}

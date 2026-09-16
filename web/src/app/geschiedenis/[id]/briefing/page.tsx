'use client';

import { use, useCallback } from 'react';
import { BriefingView } from '@/components/BriefingView';
import { ResourceView } from '@/components/ResourceView';
import { getAnswer } from '@/lib/api-client';
import { useLocale } from '@/components/LanguageProvider';

export default function BriefingPage({ params }: { params: Promise<{ id: string }> }) {
  const { t } = useLocale();
  const { id } = use(params);
  const load = useCallback(() => getAnswer(id), [id]);
  return <ResourceView key={id} load={load} loading={t('Briefing laden…')}>{(answer) => <BriefingView answer={answer} />}</ResourceView>;
}

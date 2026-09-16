'use client';
import type { TaskModel } from '@/lib/types';
import { Badge, providerLabels } from './Badge';
import { useLocale } from './LanguageProvider';
export function ModelBadge({ model }: { model: TaskModel }) { const { t } = useLocale(); return <Badge>Model: {model.model} ({t(providerLabels[model.provider])})</Badge>; }

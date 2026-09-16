import type { TaskModel } from '@/lib/types';
import { Badge, providerLabels } from './Badge';
export function ModelBadge({ model }: { model: TaskModel }) { return <Badge>Model: {model.model} ({providerLabels[model.provider]})</Badge>; }

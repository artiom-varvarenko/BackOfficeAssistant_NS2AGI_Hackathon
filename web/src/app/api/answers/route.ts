import { handle } from '@/lib/api';
import { listAnswers } from '@/lib/dto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return handle(() => Response.json(listAnswers()));
}

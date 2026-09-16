import { handle } from '@/lib/api';
import { listSources } from '@/lib/dto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return handle(() => Response.json(listSources()));
}

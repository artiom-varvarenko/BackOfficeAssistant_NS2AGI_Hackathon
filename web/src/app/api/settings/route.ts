import { handle } from '@/lib/api';
import { getSettingsDto } from '@/lib/settings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return handle(() => Response.json(getSettingsDto()));
}

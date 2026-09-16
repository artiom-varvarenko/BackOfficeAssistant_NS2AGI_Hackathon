import type { NextRequest } from 'next/server';
import { ApiError, handle, readJson } from '@/lib/api';
import { getSettingsDto, updateSettings, type SettingsUpdate } from '@/lib/settings';
import { jsonObject } from '@/lib/source-forms';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return handle(() => Response.json(getSettingsDto()));
}

const SECTIONS = ['tasks', 'keys', 'custom', 'azure', 'tts', 'retrieval'] as const;

// Shape guard only: each section of the body must be an object when present;
// the field-level validation (and its 400 `invalid_settings` messages) lives in
// updateSettings.
export async function PUT(req: NextRequest) {
  return handle(async () => {
    const body = jsonObject(await readJson<unknown>(req));
    for (const section of SECTIONS) {
      const value = body[section];
      if (value !== undefined && (typeof value !== 'object' || value === null || Array.isArray(value))) {
        throw new ApiError(400, 'invalid_settings', `Het onderdeel '${section}' moet een object zijn.`);
      }
    }
    // Checked above: every present section is a plain object; the values
    // inside are validated by updateSettings.
    return Response.json(updateSettings(body as SettingsUpdate));
  });
}

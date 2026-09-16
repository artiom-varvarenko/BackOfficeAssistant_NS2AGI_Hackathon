import type { NextRequest } from 'next/server';
import { ApiError, handle, readJson } from '@/lib/api';
import { synthesizeAnswer } from '@/lib/tts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  return handle(async () => {
    const body = await readJson<unknown>(req);
    if (typeof body !== 'object' || body === null || Array.isArray(body) ||
      !('answerId' in body) || typeof body.answerId !== 'string' || !body.answerId.trim()) {
      throw new ApiError(400, 'invalid_input', 'Geef het antwoord op dat u wilt laten voorlezen (answerId).');
    }
    return synthesizeAnswer(body.answerId.trim());
  });
}

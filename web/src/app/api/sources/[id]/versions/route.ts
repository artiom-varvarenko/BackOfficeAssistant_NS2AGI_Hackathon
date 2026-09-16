import type { NextRequest } from 'next/server';
import { ApiError, handle } from '@/lib/api';
import { getSource } from '@/lib/dto';
import { addVersion } from '@/lib/ingest';
import { parseVersionFields, readForm, readUpload } from '@/lib/source-forms';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Multipart upload of a new version. On success the new version becomes
// current (`unverified`) and the previous current one `superseded`; an
// unreadable PDF leaves a failed version behind and answers 422.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await params;
    if (!getSource(id)) throw new ApiError(404, 'not_found', 'Bron niet gevonden.');
    const form = await readForm(req);
    const upload = await readUpload(form);
    const version = parseVersionFields(form);
    await addVersion(upload.buffer, id, { fileName: upload.fileName, ...version });
    return Response.json(getSource(id));
  });
}

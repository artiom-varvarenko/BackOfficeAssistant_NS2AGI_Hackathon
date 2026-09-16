import type { NextRequest } from 'next/server';
import { handle } from '@/lib/api';
import { getSource, listSources } from '@/lib/dto';
import { createSource } from '@/lib/ingest';
import { requestLocale } from '@/lib/request-locale';
import {
  parseInitialApplicability,
  parseSourceFields,
  parseVersionFields,
  readForm,
  readUpload,
} from '@/lib/source-forms';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return handle(() => Response.json(listSources()));
}

// Multipart upload with synchronous ingest. An unreadable PDF leaves the
// source with a failed version and answers 422 (IngestError), which the
// Bronnen table shows as "Mislukt: …".
export async function POST(req: NextRequest) {
  return handle(async () => {
    const form = await readForm(req);
    const upload = await readUpload(form);
    const source = parseSourceFields(form);
    const version = parseVersionFields(form);
    const applicability = parseInitialApplicability(form.get('applicability'));
    const { sourceId } = await createSource(upload.buffer, source, {
      fileName: upload.fileName,
      applicability,
      ...version,
    }, requestLocale(req));
    return Response.json(getSource(sourceId), { status: 201 });
  });
}

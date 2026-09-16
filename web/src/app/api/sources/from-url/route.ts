import type { NextRequest } from 'next/server';
import { handle, readJson } from '@/lib/api';
import { getSource } from '@/lib/dto';
import { createSource, type SourceMeta } from '@/lib/ingest';
import { downloadSourcePdf } from '@/lib/source-download';
import {
  FIELD_LABELS,
  jsonObject,
  optionalIsoDate,
  optionalText,
  parseDocType,
  parseInitialApplicability,
  parseLevel,
  requiredText,
} from '@/lib/source-forms';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  return handle(async () => {
    const body = jsonObject(await readJson<unknown>(req));
    const url = requiredText(body.url, 'URL van het PDF-bestand');
    // Use the upload field validators directly: JSON objects/arrays must never
    // be coerced to text by converting them to multipart fields.
    const source: SourceMeta = {
      title: requiredText(body.title, FIELD_LABELS.title),
      authority: optionalText(body.authority, FIELD_LABELS.authority),
      level: parseLevel(body.level),
      docType: parseDocType(body.docType),
      scope: optionalText(body.scope, FIELD_LABELS.scope),
      originalUrl: url,
    };
    const version = {
      documentDate: optionalIsoDate(body.documentDate, FIELD_LABELS.documentDate),
      versionLabel: optionalText(body.versionLabel, FIELD_LABELS.versionLabel),
      validFrom: optionalIsoDate(body.validFrom, FIELD_LABELS.validFrom),
      validUntil: optionalIsoDate(body.validUntil, FIELD_LABELS.validUntil),
      applicability: parseInitialApplicability(body.applicability),
    };
    const { buffer, fileName } = await downloadSourcePdf(url);
    // Same ready/failed states, immutable version storage and source events as
    // uploads. originalUrl is the requested URL, not a transient redirect URL.
    const { sourceId } = await createSource(buffer, source, { ...version, fileName });
    return Response.json(getSource(sourceId), { status: 201 });
  });
}

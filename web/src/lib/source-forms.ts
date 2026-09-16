// Request parsing for the write endpoints (PLAN.md section 7): multipart
// uploads (POST /api/sources, POST /api/sources/:id/versions) and JSON bodies
// (PATCH /api/sources/:id, PATCH /api/sources/:id/versions/:vid, and the
// generic object/text checks reused by the answer and settings routes). Every
// check throws ApiError 400 with a Dutch message; nothing here touches the
// database. The same text/date/enum checks serve both body kinds: a multipart
// field arrives as string | File | null, a JSON field as any JSON value.
import { ApiError } from './api';
import type { SourceMeta, VersionMeta } from './ingest';
import type { Applicability, DocType, Level } from './types';

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

const LEVELS: readonly Level[] = ['municipal', 'provincial', 'flemish', 'federal'];
const DOC_TYPES: readonly DocType[] = [
  'bylaw',
  'fee_regulation',
  'subsidy_regulation',
  'royal_decree',
  'brochure',
  'manual',
  'other',
];
// What an upload may start as, and what an officer may set later. `superseded`
// is assigned by addVersion only.
const INITIAL_APPLICABILITIES = ['unverified', 'historical'] as const;
const OFFICER_APPLICABILITIES = ['unverified', 'verified', 'historical'] as const;
export type InitialApplicability = (typeof INITIAL_APPLICABILITIES)[number];
export type OfficerApplicability = (typeof OFFICER_APPLICABILITIES)[number];

// Dutch names of the editable fields, used in error messages and in the detail
// of `metadata_edited` events ("titel, bestuursniveau").
export const FIELD_LABELS = {
  title: 'titel',
  authority: 'uitgevende instantie',
  level: 'bestuursniveau',
  docType: 'documenttype',
  scope: 'toepassingsgebied',
  originalUrl: 'originele URL',
  documentDate: 'documentdatum',
  versionLabel: 'versielabel',
  validFrom: 'geldig van',
  validUntil: 'geldig tot',
  applicability: 'toepasselijkheid',
  applicabilityNote: 'toelichting',
} as const;

export const APPLICABILITY_LABELS: Record<Applicability, string> = {
  unverified: 'niet geverifieerd',
  verified: 'geverifieerd',
  historical: 'historisch',
  superseded: 'vervangen',
};

export function invalidInput(message: string): ApiError {
  return new ApiError(400, 'invalid_input', message);
}

// ---------------------------------------------------------------------------
// Field checks

// Absent, null or blank → null; text is trimmed.
export function optionalText(value: unknown, label: string): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') throw invalidInput(`Het veld ${label} moet tekst zijn.`);
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

export function requiredText(value: unknown, label: string): string {
  const text = optionalText(value, label);
  if (text === null) throw invalidInput(`Het veld ${label} mag niet leeg zijn.`);
  return text;
}

// ISO calendar date (YYYY-MM-DD); blank → null ("datum onbekend").
export function optionalIsoDate(value: unknown, label: string): string | null {
  const text = optionalText(value, label);
  if (text === null) return null;
  const time = /^\d{4}-\d{2}-\d{2}$/.test(text) ? Date.parse(`${text}T00:00:00Z`) : Number.NaN;
  if (Number.isNaN(time) || new Date(time).toISOString().slice(0, 10) !== text) {
    throw invalidInput(`Ongeldige datum voor ${label}: '${text}' (verwacht JJJJ-MM-DD).`);
  }
  return text;
}

// http(s) URL, stored as typed (not normalised); blank → null.
export function optionalHttpUrl(value: unknown, label: string): string | null {
  const text = optionalText(value, label);
  if (text === null) return null;
  let protocol: string | null = null;
  try {
    protocol = new URL(text).protocol;
  } catch {
    protocol = null;
  }
  if (protocol !== 'http:' && protocol !== 'https:') {
    throw invalidInput(`Ongeldige ${label} '${text}' (verwacht http:// of https://).`);
  }
  return text;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return typeof value === 'string' && allowed.includes(value as T) ? (value as T) : null;
}

export function parseLevel(value: unknown): Level {
  const level = oneOf(value, LEVELS);
  if (level === null) {
    throw invalidInput(`Ongeldig bestuursniveau (toegestaan: ${LEVELS.join(', ')}).`);
  }
  return level;
}

export function parseDocType(value: unknown): DocType {
  const docType = oneOf(value, DOC_TYPES);
  if (docType === null) {
    throw invalidInput(`Ongeldig documenttype (toegestaan: ${DOC_TYPES.join(', ')}).`);
  }
  return docType;
}

// Applicability of a freshly uploaded version; absent/blank → unverified.
export function parseInitialApplicability(value: unknown): InitialApplicability {
  if (value === null || value === undefined || value === '') return 'unverified';
  const applicability = oneOf(value, INITIAL_APPLICABILITIES);
  if (applicability === null) {
    throw invalidInput(
      `Ongeldige toepasselijkheid (toegestaan bij aanmaak: ${INITIAL_APPLICABILITIES.join(', ')}).`,
    );
  }
  return applicability;
}

// Applicability an officer sets on an existing version.
export function parseOfficerApplicability(value: unknown): OfficerApplicability {
  const applicability = oneOf(value, OFFICER_APPLICABILITIES);
  if (applicability === null) {
    throw invalidInput(
      value === 'superseded'
        ? `Toepasselijkheid '${APPLICABILITY_LABELS.superseded}' wordt automatisch toegekend zodra een nieuwere versie is toegevoegd en kan niet handmatig worden ingesteld.`
        : `Ongeldige toepasselijkheid (toegestaan: ${OFFICER_APPLICABILITIES.join(', ')}).`,
    );
  }
  return applicability;
}

// ---------------------------------------------------------------------------
// Multipart bodies

export async function readForm(req: Request): Promise<FormData> {
  // Enforce the byte ceiling while reading, before the multipart parser can
  // allocate an arbitrarily large file. Allow bounded metadata overhead in
  // addition to the separate 25 MiB file limit checked by readUpload.
  const maxBytes = MAX_UPLOAD_BYTES + 64 * 1024;
  const length = Number(req.headers.get('content-length'));
  if (Number.isFinite(length) && length > maxBytes) {
    throw new ApiError(400, 'file_too_large', 'Bestand groter dan 25 MB.');
  }
  let received = 0;
  const limited = req.body?.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      received += chunk.byteLength;
      if (received > maxBytes) {
        throw new ApiError(400, 'file_too_large', 'Bestand groter dan 25 MB.');
      }
      controller.enqueue(chunk);
    },
  }));
  try {
    return await new Response(limited ?? null, { headers: req.headers }).formData();
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw invalidInput('Verwacht een multipart/form-data aanvraag met een bestand.');
  }
}

// The `file` part. Size is checked before the bytes are copied out; the PDF
// itself is not inspected here — ingest decides whether it is readable, so an
// unreadable upload still gets its failed version row.
export async function readUpload(form: FormData): Promise<{ buffer: Buffer; fileName: string }> {
  const file = form.get('file');
  if (file === null || typeof file === 'string' || file.size === 0) {
    throw new ApiError(400, 'missing_file', 'Geen bestand meegestuurd.');
  }
  if (file.size > MAX_UPLOAD_BYTES) throw new ApiError(400, 'file_too_large', 'Bestand groter dan 25 MB.');
  // Browsers send a bare name, but strip any path a client may include.
  const fileName = file.name.split(/[\\/]/).pop() || 'document.pdf';
  return { buffer: Buffer.from(await file.arrayBuffer()), fileName };
}

export function parseSourceFields(form: FormData): SourceMeta {
  return {
    title: requiredText(form.get('title'), FIELD_LABELS.title),
    authority: optionalText(form.get('authority'), FIELD_LABELS.authority),
    level: parseLevel(form.get('level')),
    docType: parseDocType(form.get('docType')),
    scope: optionalText(form.get('scope'), FIELD_LABELS.scope),
    originalUrl: optionalHttpUrl(form.get('originalUrl'), FIELD_LABELS.originalUrl),
  };
}

export function parseVersionFields(form: FormData): Omit<VersionMeta, 'fileName' | 'applicability'> {
  return {
    documentDate: optionalIsoDate(form.get('documentDate'), FIELD_LABELS.documentDate),
    versionLabel: optionalText(form.get('versionLabel'), FIELD_LABELS.versionLabel),
    validFrom: optionalIsoDate(form.get('validFrom'), FIELD_LABELS.validFrom),
    validUntil: optionalIsoDate(form.get('validUntil'), FIELD_LABELS.validUntil),
  };
}

// ---------------------------------------------------------------------------
// JSON bodies

export function jsonObject(body: unknown): Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw invalidInput('Verwacht een JSON-object.');
  }
  return body as Record<string, unknown>;
}

// A key that is absent (or JSON-less `undefined`) is left alone; `null` or ""
// clears an optional field. Unknown keys are ignored.
export interface SourcePatch {
  title?: string;
  authority?: string | null;
  level?: Level;
  docType?: DocType;
  scope?: string | null;
  originalUrl?: string | null;
  enabled?: boolean;
}

export function parseSourcePatch(body: Record<string, unknown>): SourcePatch {
  const patch: SourcePatch = {};
  if (body.title !== undefined) patch.title = requiredText(body.title, FIELD_LABELS.title);
  if (body.authority !== undefined) patch.authority = optionalText(body.authority, FIELD_LABELS.authority);
  if (body.level !== undefined) patch.level = parseLevel(body.level);
  if (body.docType !== undefined) patch.docType = parseDocType(body.docType);
  if (body.scope !== undefined) patch.scope = optionalText(body.scope, FIELD_LABELS.scope);
  if (body.originalUrl !== undefined) patch.originalUrl = optionalHttpUrl(body.originalUrl, FIELD_LABELS.originalUrl);
  if (body.enabled !== undefined) {
    if (typeof body.enabled !== 'boolean') throw invalidInput('Het veld enabled moet true of false zijn.');
    patch.enabled = body.enabled;
  }
  return patch;
}

export interface VersionPatch {
  applicability?: OfficerApplicability;
  applicabilityNote?: string | null;
  documentDate?: string | null;
  versionLabel?: string | null;
  validFrom?: string | null;
  validUntil?: string | null;
}

export function parseVersionPatch(body: Record<string, unknown>): VersionPatch {
  const patch: VersionPatch = {};
  if (body.applicability !== undefined) patch.applicability = parseOfficerApplicability(body.applicability);
  if (body.applicabilityNote !== undefined) {
    patch.applicabilityNote = optionalText(body.applicabilityNote, FIELD_LABELS.applicabilityNote);
  }
  if (body.documentDate !== undefined) patch.documentDate = optionalIsoDate(body.documentDate, FIELD_LABELS.documentDate);
  if (body.versionLabel !== undefined) patch.versionLabel = optionalText(body.versionLabel, FIELD_LABELS.versionLabel);
  if (body.validFrom !== undefined) patch.validFrom = optionalIsoDate(body.validFrom, FIELD_LABELS.validFrom);
  if (body.validUntil !== undefined) patch.validUntil = optionalIsoDate(body.validUntil, FIELD_LABELS.validUntil);
  return patch;
}

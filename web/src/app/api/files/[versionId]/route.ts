import fs from 'node:fs';
import type { NextRequest } from 'next/server';
import { ApiError, handle } from '@/lib/api';
import { getVersionFile } from '@/lib/dto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Serves the stored PDF of a version `inline`, so that `#page=N` links open the
// browser viewer at the cited page. Files are at most 25 MB (ingest limit), so
// the whole file is read into memory.
export async function GET(req: NextRequest, { params }: { params: Promise<{ versionId: string }> }) {
  return handle(async () => {
    const { versionId } = await params;
    const notFound = new ApiError(404, 'not_found', 'Bestand niet gevonden.');
    const file = getVersionFile(versionId);
    if (!file) throw notFound;

    let bytes: Buffer<ArrayBuffer>;
    try {
      bytes = fs.readFileSync(file.filePath);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') throw notFound;
      throw err;
    }

    // RFC 6266: an ASCII fallback plus the UTF-8 form. `'()*` are outside
    // RFC 5987 attr-char and would break the quoted form, so encode them too.
    const asciiName = file.fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
    const utf8Name = encodeURIComponent(file.fileName).replace(
      /['()*]/g,
      (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
    );

    const headers = new Headers({
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${asciiName}"; filename*=UTF-8''${utf8Name}`,
        'Content-Length': String(bytes.byteLength),
        'Cache-Control': 'private, no-store',
        'Accept-Ranges': 'bytes',
    });
    // Browser PDF viewers request individual ranges when jumping to a page.
    // Ignore unsupported/malformed or multipart ranges, as permitted by HTTP.
    // With no validators, If-Range must receive the complete representation.
    const range = req.headers.has('if-range') ? null : /^bytes=(\d*)-(\d*)$/.exec(req.headers.get('range') ?? '');
    if (range && (range[1] || range[2])) {
      const length = bytes.byteLength;
      const suffix = range[1] === '';
      const first = Number(range[1]);
      const last = Number(range[2]);
      const start = suffix ? Math.max(0, length - last) : first;
      const end = suffix || range[2] === '' ? length - 1 : Math.min(last, length - 1);
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= length || end < start) {
        headers.set('Content-Range', `bytes */${length}`);
        headers.set('Content-Length', '0');
        return new Response(null, { status: 416, headers });
      }
      headers.set('Content-Range', `bytes ${start}-${end}/${length}`);
      headers.set('Content-Length', String(end - start + 1));
      return new Response(bytes.subarray(start, end + 1), { status: 206, headers });
    }
    return new Response(bytes, { headers });
  });
}

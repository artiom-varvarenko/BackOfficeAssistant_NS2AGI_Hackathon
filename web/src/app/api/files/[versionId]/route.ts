import fs from 'node:fs';
import type { NextRequest } from 'next/server';
import { ApiError, handle } from '@/lib/api';
import { getVersionFile } from '@/lib/dto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Serves the stored PDF of a version `inline`, so that `#page=N` links open the
// browser viewer at the cited page. Files are at most 25 MB (ingest limit), so
// the whole file is read into memory.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ versionId: string }> }) {
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

    return new Response(bytes, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${asciiName}"; filename*=UTF-8''${utf8Name}`,
        'Content-Length': String(bytes.byteLength),
        'Cache-Control': 'private, max-age=3600',
        'Accept-Ranges': 'bytes',
      },
    });
  });
}

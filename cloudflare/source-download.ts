import { Buffer } from 'node:buffer';
import { isIP } from 'node:net';
import { ApiError } from '../web/src/lib/api';
import { MAX_UPLOAD_BYTES } from '../web/src/lib/source-forms';

const DOWNLOAD_TIMEOUT_MS = 20_000;
const MAX_REDIRECTS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const PDF_MAGIC = Buffer.from('%PDF');

function unsafeSourceUrl(): ApiError {
  return new ApiError(422, 'unsafe_source_url', 'Deze URL verwijst niet naar een toegestane openbare bron.');
}

function downloadFailed(): ApiError {
  return new ApiError(502, 'download_failed', 'De PDF kon niet worden gedownload.');
}

// Kept API-compatible with the native downloader's conservative public-unicast
// policy. Workers fetch requires DNS hostnames, so literal addresses are rejected
// by sourceUrl even when this classifier says they are public.
export function isPublicSourceAddress(address: string): boolean {
  if (address.includes('%')) return false;
  const family = isIP(address);
  if (family === 4) {
    const [a, b, c] = address.split('.').map(Number);
    return !(
      a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (
        (b === 0 && (c === 0 || c === 2)) ||
        (b === 31 && c === 196) || (b === 52 && c === 193) ||
        (b === 88 && c === 99) || b === 168 || (b === 175 && c === 48)
      )) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113) || address === '168.63.129.16'
    );
  }
  if (family !== 6 || address.includes('.')) return false;
  const halves = address.split('::');
  const leading = halves[0] ? halves[0].split(':').map((word) => parseInt(word, 16)) : [];
  const trailing = halves[1] ? halves[1].split(':').map((word) => parseInt(word, 16)) : [];
  const words = halves.length === 1 ? leading
    : [...leading, ...Array<number>(8 - leading.length - trailing.length).fill(0), ...trailing];
  const [first, second] = words;
  const allocated = (
    (first === 0x2001 && (
      (second >= 0x0200 && second <= 0x0fff) ||
      (second >= 0x1200 && second <= 0x4dff) ||
      (second >= 0x5000 && second <= 0x5fff) ||
      (second >= 0x8000 && second <= 0xbfff)
    )) ||
    (first === 0x2003 && second < 0x4000) ||
    (first >= 0x2400 && first <= 0x241f) ||
    (first >= 0x2600 && first <= 0x260f) ||
    ((first === 0x2610 || first === 0x2620) && second < 0x0200) ||
    (first >= 0x2630 && first <= 0x263f) ||
    (first >= 0x2800 && first <= 0x280f) ||
    (first >= 0x2a00 && first <= 0x2a1f) ||
    (first >= 0x2c00 && first <= 0x2c0f)
  );
  if (!allocated || (first === 0x2001 && second === 0x0db8) ||
    (first === 0x2620 && second === 0x004f && words[2] === 0x8000)) return false;
  return !((words[4] === 0 || words[4] === 0x0200) && words[5] === 0x5efe);
}

function sourceUrl(value: string, previous?: URL): URL {
  let url: URL;
  try {
    url = previous ? new URL(value, previous) : new URL(value);
  } catch {
    if (previous) throw unsafeSourceUrl();
    throw new ApiError(400, 'invalid_url', 'Voer een geldige HTTP- of HTTPS-URL in.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    if (previous) throw unsafeSourceUrl();
    throw new ApiError(400, 'invalid_url', 'Voer een geldige HTTP- of HTTPS-URL in.');
  }
  if (url.username || url.password || url.port ||
    (previous?.protocol === 'https:' && url.protocol === 'http:')) throw unsafeSourceUrl();
  // WHATWG URL first canonicalizes alternate IP notation and encoded hostnames.
  const hostname = url.hostname.toLowerCase().replace(/\.+$/, '');
  if (
    isIP(hostname) !== 0 || hostname.startsWith('[') ||
    !hostname.includes('.') || hostname.length > 253 ||
    hostname.split('.').some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) ||
    /(?:^|\.)(?:localhost|local|internal|intranet|lan|home|test|invalid|onion)$/.test(hostname) ||
    hostname.endsWith('.home.arpa') || hostname.endsWith('.in-addr.arpa') || hostname.endsWith('.ip6.arpa')
  ) throw unsafeSourceUrl();
  url.hostname = hostname;
  url.hash = '';
  return url;
}

async function readPdf(response: Response): Promise<Buffer> {
  if (Number(response.headers.get('content-length')) > MAX_UPLOAD_BYTES) {
    await response.body?.cancel();
    throw new ApiError(422, 'file_too_large', 'Het PDF-bestand mag niet groter zijn dan 25 MiB.');
  }
  if (!response.body) throw downloadFailed();
  const reader = response.body.getReader();
  let body = Buffer.alloc(0);
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const nextLength = length + value.byteLength;
      if (nextLength > MAX_UPLOAD_BYTES) {
        throw new ApiError(422, 'file_too_large', 'Het PDF-bestand mag niet groter zijn dan 25 MiB.');
      }
      for (let i = 0; i < Math.min(value.byteLength, PDF_MAGIC.length - length); i++) {
        if (value[i] !== PDF_MAGIC[length + i]) {
          throw new ApiError(422, 'invalid_pdf', 'De gedownloade inhoud is geen PDF-bestand.');
        }
      }
      if (nextLength > body.length) {
        const capacity = Math.min(MAX_UPLOAD_BYTES, Math.max(nextLength, body.length * 2, 64 * 1024));
        const grown = Buffer.allocUnsafe(capacity);
        body.copy(grown, 0, 0, length);
        body = grown;
      }
      body.set(value, length);
      length = nextLength;
    }
    if (length < PDF_MAGIC.length) {
      throw new ApiError(422, 'invalid_pdf', 'De gedownloade inhoud is geen PDF-bestand.');
    }
    return body.subarray(0, length);
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
}

function sourceFileName(url: URL): string {
  let name: string;
  try {
    name = decodeURIComponent(url.pathname.slice(url.pathname.lastIndexOf('/') + 1));
  } catch {
    return 'document.pdf';
  }
  name = name.replace(/[<>:"/\\|?*\p{Cc}\p{Cf}]/gu, '_')
    .replace(/^[ .]+|[ .]+$/g, '').replace(/\.pdf$/i, '');
  let stem = '';
  let bytes = 0;
  for (const character of name) {
    const width = Buffer.byteLength(character);
    if (bytes + width > 180) break;
    stem += character;
    bytes += width;
  }
  stem = stem.replace(/[ .]+$/, '');
  if (!stem) return 'document.pdf';
  if (/^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³]|conin\$|conout\$)(?: *\.| *$)/i.test(stem)) stem = `_${stem}`;
  return `${stem}.pdf`;
}

// Deployment contract: enable global_fetch_strictly_public. Global fetch then
// routes as a public Internet request rather than bypassing same-zone security.
// https://developers.cloudflare.com/workers/configuration/compatibility-flags/#global-fetch-strictly-public
// Never replace global fetch here with a VPC/service binding: private network
// access is explicitly granted through those bindings. Unlike the native Node
// implementation this uses the Worker network boundary, not DNS/socket pinning.
// https://developers.cloudflare.com/workers-vpc/configuration/vpc-networks/
// https://developers.cloudflare.com/workers/platform/known-issues/#fetch-to-ip-addresses
export async function downloadSourcePdf(url: string): Promise<{ buffer: Buffer; fileName: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new ApiError(
    502, 'download_timeout', 'Het downloaden van de PDF duurde langer dan 20 seconden.',
  )), DOWNLOAD_TIMEOUT_MS);
  try {
    let destination = sourceUrl(url);
    let redirects = 0;
    while (true) {
      // A fresh request forwards no inbound session, authorization or CF headers.
      // Manual redirects prevent fetch from forwarding credentials across hosts.
      // https://developers.cloudflare.com/workers/runtime-apis/request/#properties
      const response = await fetch(destination, {
        method: 'GET', redirect: 'manual', signal: controller.signal, cache: 'no-store',
        headers: { Accept: 'application/pdf', 'Accept-Encoding': 'identity' },
      });
      if (REDIRECT_STATUSES.has(response.status)) {
        const location = response.headers.get('location');
        await response.body?.cancel();
        if (!location?.trim()) throw downloadFailed();
        if (redirects === MAX_REDIRECTS) {
          throw new ApiError(422, 'too_many_redirects', 'De URL verwijst te vaak door (maximaal 5 keer).');
        }
        destination = sourceUrl(location, destination);
        redirects++;
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw downloadFailed();
      }
      // Workers transparently decodes supported response compression. Enforce
      // the limit on bytes actually read, regardless of Content-Length/Encoding.
      return { buffer: await readPdf(response), fileName: sourceFileName(destination) };
    }
  } catch (error) {
    if (controller.signal.aborted) throw controller.signal.reason;
    if (error instanceof ApiError) throw error;
    throw downloadFailed();
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

export const fetchPdfFromUrl = downloadSourcePdf;

import { Buffer } from 'node:buffer';
import { lookup, type LookupAddress } from 'node:dns';
import { request as requestHttp, type ClientRequest, type IncomingMessage } from 'node:http';
import { request as requestHttps, type RequestOptions } from 'node:https';
import { isIP, type LookupFunction, type TcpSocketConnectOpts } from 'node:net';
import { ApiError } from './api';
import { MAX_UPLOAD_BYTES } from './source-forms';

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

// Conservative public-unicast policy: special-purpose/transition networks are
// not PDF origins, even where IANA defines a globally reachable exception.
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
      (a === 203 && b === 0 && c === 113) ||
      // Azure's platform virtual IP is not a public document origin.
      address === '168.63.129.16'
    );
  }
  if (family !== 6 || address.includes('.')) return false;

  const halves = address.split('::');
  const leading = halves[0] ? halves[0].split(':').map((word) => parseInt(word, 16)) : [];
  const trailing = halves[1] ? halves[1].split(':').map((word) => parseInt(word, 16)) : [];
  const words = halves.length === 1
    ? leading
    : [...leading, ...Array<number>(8 - leading.length - trailing.length).fill(0), ...trailing];

  // IANA native RIR allocations (2025-10-10). The rest of 2000::/3 is
  // reserved too, not just space outside that global-unicast supernet.
  // https://www.iana.org/assignments/ipv6-unicast-address-assignments/
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
  if (
    !allocated ||
    (first === 0x2001 && second === 0x0db8) ||
    (first === 0x2620 && second === 0x004f && words[2] === 0x8000)
  ) return false;

  // ISATAP can tunnel to an embedded IPv4 destination under a public prefix.
  return !((words[4] === 0 || words[4] === 0x0200) && words[5] === 0x5efe);
}

function hostnameOf(url: URL): string {
  return url.hostname.startsWith('[') ? url.hostname.slice(1, -1) : url.hostname;
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
  if (
    url.username || url.password ||
    (url.port && url.port !== (url.protocol === 'http:' ? '80' : '443')) ||
    (previous?.protocol === 'https:' && url.protocol === 'http:')
  ) throw unsafeSourceUrl();

  // WHATWG URL normalizes alternate IPv4 notation before this check.
  const hostname = hostnameOf(url).toLowerCase().replace(/\.+$/, '');
  if (
    hostname === 'localhost' || hostname.endsWith('.localhost') ||
    hostname === 'local' || hostname.endsWith('.local') ||
    (isIP(hostname) !== 0 && !isPublicSourceAddress(hostname))
  ) throw unsafeSourceUrl();
  url.hash = '';
  return url;
}

function resolvePublicAddress(url: URL, signal: AbortSignal): Promise<LookupAddress> {
  const { promise, resolve, reject } = Promise.withResolvers<LookupAddress>();
  let settled = false;
  const finish = (error: ApiError | undefined, address?: LookupAddress) => {
    if (settled) return;
    settled = true;
    signal.removeEventListener('abort', onAbort);
    if (error) reject(error);
    else if (address) resolve(address);
    else reject(downloadFailed());
  };
  const onAbort = () => finish(signal.reason);
  signal.addEventListener('abort', onAbort, { once: true });
  if (signal.aborted) {
    onAbort();
    return promise;
  }
  try {
    // The native lookup cannot be cancelled; ignore a late callback after the
    // deadline and never let it create a socket. Check *all* returned addresses.
    lookup(hostnameOf(url), { all: true, verbatim: true }, (error, addresses) => {
      if (settled) return;
      if (error || addresses.length === 0) {
        finish(downloadFailed());
        return;
      }
      if (addresses.some(({ address, family }) => family !== isIP(address) || !isPublicSourceAddress(address))) {
        finish(unsafeSourceUrl());
        return;
      }
      finish(undefined, addresses[0]);
    });
  } catch {
    finish(downloadFailed());
  }
  return promise;
}

type DownloadHop = { location: string } | { buffer: Buffer };

function downloadHop(url: URL, address: LookupAddress, signal: AbortSignal): Promise<DownloadHop> {
  const { promise, resolve, reject } = Promise.withResolvers<DownloadHop>();
  let request: ClientRequest | undefined;
  let response: IncomingMessage | undefined;
  let settled = false;
  const dispose = () => {
    signal.removeEventListener('abort', onAbort);
    response?.destroy();
    request?.destroy();
  };
  const fail = (error: ApiError) => {
    if (settled) return;
    settled = true;
    dispose();
    reject(error);
  };
  const succeed = (result: DownloadHop) => {
    if (settled) return;
    settled = true;
    dispose();
    resolve(result);
  };
  const onAbort = () => fail(signal.reason);
  const onTransportError = () => fail(downloadFailed());
  signal.addEventListener('abort', onAbort, { once: true });
  if (signal.aborted) {
    onAbort();
    return promise;
  }

  const pinnedLookup: LookupFunction = (_hostname, options, callback) => {
    if (options.all) callback(null, [address]);
    else callback(null, address.address, address.family);
  };
  const options: RequestOptions & Pick<TcpSocketConnectOpts, 'autoSelectFamily'> = {
    method: 'GET',
    agent: false,
    lookup: pinnedLookup,
    family: address.family,
    autoSelectFamily: false,
    // Keep the original URL host for HTTP Host, TLS verification and SNI.
    rejectUnauthorized: true,
    servername: isIP(hostnameOf(url)) === 0 ? hostnameOf(url) : undefined,
    headers: { Accept: 'application/pdf', 'Accept-Encoding': 'identity' },
    maxHeaderSize: 16 * 1024,
  };

  try {
    const send = url.protocol === 'https:' ? requestHttps : requestHttp;
    request = send(url, options, (incoming) => {
      response = incoming;
      incoming.on('error', onTransportError);
      incoming.once('close', () => {
        if (!settled) onTransportError();
      });
      if (settled) {
        incoming.destroy();
        return;
      }
      const status = incoming.statusCode ?? 0;
      if (REDIRECT_STATUSES.has(status)) {
        const location = incoming.headers.location;
        if (!location?.trim()) fail(downloadFailed());
        else succeed({ location });
        return;
      }
      if (status < 200 || status >= 300) {
        fail(downloadFailed());
        return;
      }
      const encoding = incoming.headers['content-encoding'];
      if (encoding !== undefined && encoding.trim().toLowerCase() !== 'identity') {
        fail(downloadFailed());
        return;
      }
      const contentLength = incoming.headers['content-length'];
      if (contentLength !== undefined && Number(contentLength) > MAX_UPLOAD_BYTES) {
        fail(new ApiError(422, 'file_too_large', 'Het PDF-bestand mag niet groter zijn dan 25 MiB.'));
        return;
      }

      // Grow a bounded buffer instead of retaining arbitrary numbers of tiny
      // chunks. Content-Length never determines allocation or the streaming cap.
      let body = Buffer.alloc(0);
      let length = 0;
      incoming.on('data', (chunk: Buffer) => {
        if (settled) return;
        const nextLength = length + chunk.length;
        if (nextLength > MAX_UPLOAD_BYTES) {
          fail(new ApiError(422, 'file_too_large', 'Het PDF-bestand mag niet groter zijn dan 25 MiB.'));
          return;
        }
        for (let i = 0; i < Math.min(chunk.length, PDF_MAGIC.length - length); i++) {
          if (chunk[i] !== PDF_MAGIC[length + i]) {
            fail(new ApiError(422, 'invalid_pdf', 'De gedownloade inhoud is geen PDF-bestand.'));
            return;
          }
        }
        if (nextLength > body.length) {
          const capacity = Math.min(MAX_UPLOAD_BYTES, Math.max(nextLength, body.length * 2, 64 * 1024));
          const grown = Buffer.allocUnsafe(capacity);
          body.copy(grown, 0, 0, length);
          body = grown;
        }
        chunk.copy(body, length);
        length = nextLength;
      });
      incoming.once('end', () => {
        if (length < PDF_MAGIC.length) {
          fail(new ApiError(422, 'invalid_pdf', 'De gedownloade inhoud is geen PDF-bestand.'));
        } else {
          succeed({ buffer: body.subarray(0, length) });
        }
      });
    });
    request.on('error', onTransportError);
    request.once('close', () => {
      if (!response && !settled) onTransportError();
    });
    request.once('upgrade', (_incoming, socket) => {
      socket.destroy();
      fail(downloadFailed());
    });
    request.end();
  } catch {
    fail(downloadFailed());
  }
  return promise;
}

function sourceFileName(url: URL): string {
  let name: string;
  try {
    name = decodeURIComponent(url.pathname.slice(url.pathname.lastIndexOf('/') + 1));
  } catch {
    return 'document.pdf';
  }
  name = name
    .replace(/[<>:"/\\|?*\p{Cc}\p{Cf}]/gu, '_')
    .replace(/^[ .]+|[ .]+$/g, '')
    .replace(/\.pdf$/i, '');
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

export async function downloadSourcePdf(url: string): Promise<{ buffer: Buffer; fileName: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new ApiError(502, 'download_timeout', 'Het downloaden van de PDF duurde langer dan 20 seconden.'));
  }, DOWNLOAD_TIMEOUT_MS);
  try {
    let destination = sourceUrl(url);
    let redirects = 0;
    while (true) {
      const address = await resolvePublicAddress(destination, controller.signal);
      const result = await downloadHop(destination, address, controller.signal);
      if ('buffer' in result) {
        return { buffer: result.buffer, fileName: sourceFileName(destination) };
      }
      if (redirects === MAX_REDIRECTS) {
        throw new ApiError(422, 'too_many_redirects', 'De URL verwijst te vaak door (maximaal 5 keer).');
      }
      destination = sourceUrl(result.location, destination);
      redirects++;
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

// Only the API engine's PDF filesystem operations are implemented here. The
// build aliases fs/node:fs to this module; uploaded files live in durable SQL.
import { Buffer } from 'node:buffer';
import { getRuntimeContext } from './runtime-context';

export const FILE_DDL = `
CREATE TABLE IF NOT EXISTS runtime_files (
  path TEXT PRIMARY KEY,
  byte_length INTEGER NOT NULL,
  chunk_count INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS runtime_file_chunks (
  path TEXT NOT NULL REFERENCES runtime_files(path) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL,
  bytes BLOB NOT NULL,
  PRIMARY KEY (path, ordinal)
);`;

const CHUNK_SIZE = 512 * 1024;
type FilePath = string | Buffer | URL;
type EncodingOption = BufferEncoding | { encoding?: BufferEncoding | null } | null;

function fsError(code: string, file: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`${code}: ${file}`), { code, path: file });
}

function fileKey(input: FilePath): string {
  const raw = input instanceof URL ? decodeURIComponent(input.pathname) : input.toString();
  const name = raw.replaceAll('\\', '/').split('/').at(-1) ?? '';
  if (!/^[A-Za-z0-9_-]+\.pdf$/i.test(name)) throw fsError('EINVAL', raw);
  // The database stores original file paths, including Windows paths imported
  // from the laptop. UUID filenames give them one portable durable identity.
  return `files/${name}`;
}

export function mkdirSync(_path: FilePath, _options?: unknown): undefined {
  return undefined;
}

export function writeFileSync(input: FilePath, data: string | ArrayBufferView, options?: EncodingOption): void {
  const key = fileKey(input);
  const encoding = typeof options === 'string' ? options : options?.encoding ?? 'utf8';
  const bytes = typeof data === 'string' ? Buffer.from(data, encoding)
    : Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  const { storage } = getRuntimeContext();
  storage.transactionSync(() => {
    // Source version PDFs are immutable evidence. An identical bootstrap retry
    // is safe, while an attempt to replace existing evidence is rejected.
    const existing = storage.sql.exec('SELECT byte_length FROM runtime_files WHERE path = ?', key).toArray()[0];
    if (existing) {
      if (Number(existing.byte_length) === bytes.byteLength && readFileSync(input).equals(bytes)) return;
      throw fsError('EEXIST', key);
    }
    const chunkCount = Math.ceil(bytes.byteLength / CHUNK_SIZE);
    storage.sql.exec('INSERT INTO runtime_files (path, byte_length, chunk_count) VALUES (?, ?, ?)', key, bytes.byteLength, chunkCount);
    for (let ordinal = 0; ordinal < chunkCount; ordinal++) {
      const chunk = bytes.subarray(ordinal * CHUNK_SIZE, (ordinal + 1) * CHUNK_SIZE);
      storage.sql.exec('INSERT INTO runtime_file_chunks (path, ordinal, bytes) VALUES (?, ?, ?)', key, ordinal, Uint8Array.from(chunk).buffer);
    }
  });
}

export function readFileSync(input: FilePath): Buffer<ArrayBuffer>;
export function readFileSync(input: FilePath, options: BufferEncoding | { encoding: BufferEncoding }): string;
export function readFileSync(input: FilePath, options?: EncodingOption): Buffer<ArrayBuffer> | string {
  const key = fileKey(input);
  const { storage } = getRuntimeContext();
  const metadata = storage.sql.exec('SELECT byte_length, chunk_count FROM runtime_files WHERE path = ?', key).toArray()[0];
  if (!metadata) throw fsError('ENOENT', key);
  const byteLength = Number(metadata.byte_length);
  const bytes = Buffer.alloc(byteLength);
  const chunks = storage.sql.exec('SELECT ordinal, bytes FROM runtime_file_chunks WHERE path = ? ORDER BY ordinal', key).toArray();
  if (chunks.length !== Number(metadata.chunk_count)) throw fsError('EIO', key);
  let offset = 0;
  for (let ordinal = 0; ordinal < chunks.length; ordinal++) {
    const chunk = chunks[ordinal];
    if (Number(chunk.ordinal) !== ordinal) throw fsError('EIO', key);
    const value = chunk.bytes;
    const part = value instanceof ArrayBuffer ? Buffer.from(value)
      : ArrayBuffer.isView(value) ? Buffer.from(value.buffer, value.byteOffset, value.byteLength)
      : null;
    if (!part || part.byteLength !== Math.min(CHUNK_SIZE, byteLength - offset)) throw fsError('EIO', key);
    part.copy(bytes, offset);
    offset += part.byteLength;
  }
  if (offset !== byteLength) throw fsError('EIO', key);
  const encoding = typeof options === 'string' ? options : options?.encoding;
  return encoding ? bytes.toString(encoding) : bytes;
}

export function existsSync(input: FilePath): boolean {
  try {
    const key = fileKey(input);
    return getRuntimeContext().storage.sql.exec('SELECT 1 FROM runtime_files WHERE path = ?', key).toArray().length > 0;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EINVAL') return false;
    throw error;
  }
}

export default { mkdirSync, writeFileSync, readFileSync, existsSync };

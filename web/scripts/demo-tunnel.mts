// Guarded Quick Tunnel launch. Run the production app separately on loopback.
// https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http, { type IncomingHttpHeaders } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import nextEnv from '@next/env';
import { getSessionConfig } from '../src/lib/auth';

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const origin = 'http://127.0.0.1:3000';
const forwardedHeaders = { Host: 'demo-preflight.example', 'CF-Connecting-IP': '203.0.113.10', 'X-Forwarded-Proto': 'https' };

// Node fetch may replace a supplied Host header with the URL's authority. Use
// the HTTP client so this probes the actual public-host boundary on the wire.
function preflight(route: string): Promise<{ status: number; headers: IncomingHttpHeaders; text: string }> {
  return new Promise((resolve, reject) => {
    const request = http.request(new URL(route, origin), { headers: forwardedHeaders }, (response) => {
      const chunks: Buffer[] = [];
      let received = 0;
      response.on('data', (chunk: Buffer) => {
        received += chunk.length;
        if (received > 64 * 1024) request.destroy(new Error('Unexpectedly large response during authentication preflight.'));
        else chunks.push(chunk);
      });
      response.once('error', (error) => { clearTimeout(timer); reject(error); });
      response.once('end', () => {
        clearTimeout(timer);
        resolve({ status: response.statusCode ?? 0, headers: response.headers, text: Buffer.concat(chunks).toString('utf8') });
      });
    });
    const timer = setTimeout(() => request.destroy(new Error('The local authentication preflight timed out.')), 5000);
    request.once('error', (error) => { clearTimeout(timer); reject(error); });
    request.end();
  });
}

async function main() {
  if (process.argv.includes('--help')) {
    console.log('tsx scripts/demo-tunnel.mts [--check]\nRequires the protected production app on 127.0.0.1:3000; --check never opens a tunnel.');
    return;
  }
  nextEnv.loadEnvConfig(webRoot, false, { info() {}, error() {} });
  if (process.env.APP_TRUST_PROXY !== 'cloudflare' || process.env.APP_STREAMING !== 'off') {
    throw new Error('Configure APP_TRUST_PROXY=cloudflare and APP_STREAMING=off, then restart the app.');
  }
  if (!getSessionConfig()) throw new Error('Configure APP_PASSWORD and a valid APP_SESSION_SECRET before opening a tunnel.');

  for (const name of ['config.yaml', 'config.yml']) {
    if (fs.existsSync(path.join(os.homedir(), '.cloudflared', name))) {
      throw new Error('An existing .cloudflared configuration may conflict with Quick Tunnels. Resolve it before starting; no file was changed.');
    }
  }
  if (process.platform === 'win32') {
    const listener = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      'Get-NetTCPConnection -State Listen -LocalPort 3000 -ErrorAction Stop | Select-Object -ExpandProperty LocalAddress | ConvertTo-Json -Compress'],
    { windowsHide: true, encoding: 'utf8' });
    if (listener.status !== 0) throw new Error('No running application listener found on port 3000.');
    const value: unknown = JSON.parse(listener.stdout);
    const addresses: unknown[] = Array.isArray(value) ? value : [value];
    if (!addresses.length || addresses.some((address) => address !== '127.0.0.1' && address !== '::1')) {
      throw new Error('The application must listen only on loopback. Start it with npm run start -- -H 127.0.0.1.');
    }
  }

  for (const route of ['/api/sources', '/api/files/preflight']) {
    const response = await preflight(route);
    if (response.status !== 401 || JSON.parse(response.text).error?.code !== 'unauthorized') {
      throw new Error(`The running app did not protect ${route}. Restart it with the configured authentication before opening a tunnel.`);
    }
  }
  const page = await preflight('/');
  const location = page.headers.location;
  if (page.status !== 307 || !location || new URL(location).origin !== 'https://demo-preflight.example' || new URL(location).pathname !== '/login') {
    throw new Error('The running app did not redirect the public origin to its login page.');
  }
  console.log('Protected loopback app verified; API/PDF access requires login and public redirects preserve HTTPS.');
  if (process.argv.includes('--check')) return;

  const binary = process.env.CLOUDFLARED_BIN || (process.platform === 'win32'
    ? path.join(process.env.LOCALAPPDATA || '', 'EconomieAssistent', 'bin', 'cloudflared.exe') : 'cloudflared');
  if (process.platform === 'win32' && !fs.existsSync(binary)) {
    throw new Error('cloudflared is missing. Install the official binary or set CLOUDFLARED_BIN to its path.');
  }
  // The connector receives OS configuration, without app/provider credentials.
  const allowed = new Set(['PATH', 'SYSTEMROOT', 'WINDIR', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'APPDATA', 'LOCALAPPDATA', 'TEMP', 'TMP', 'PROGRAMDATA', 'COMSPEC', 'HOME']);
  const childEnv: NodeJS.ProcessEnv = {
    NODE_ENV: 'production',
    ...Object.fromEntries(Object.entries(process.env).filter(([name]) => allowed.has(name.toUpperCase()))),
  };
  const connector = spawn(binary, ['tunnel', '--url', origin, '--no-autoupdate', '--loglevel', 'info', '--metrics', '127.0.0.1:0'], {
    cwd: webRoot, windowsHide: true, stdio: 'inherit', env: childEnv,
  });
  const stop = () => { connector.kill(); };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  connector.once('error', () => { console.error('Unable to start cloudflared. Verify its binary path.'); process.exitCode = 1; });
  connector.once('exit', (code) => {
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
    process.exitCode = code ?? 0;
  });
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Tunnel preflight failed.');
  process.exitCode = 1;
});

import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { proxy } from '../src/proxy';

process.env.APP_PASSWORD = 'redirect-regression';
process.env.APP_SESSION_SECRET = '0123456789abcdef-fedcba9876543210-redirect';
process.env.APP_TRUST_PROXY = 'local';

const local = await proxy(new NextRequest('http://127.0.0.1:3100/geschiedenis?q=markt', {
  headers: { host: 'localhost:3100', 'x-forwarded-host': 'attacker.invalid' },
}));
assert.equal(local.status, 307);
const localLocation = new URL(local.headers.get('location')!);
assert.equal(localLocation.origin, 'http://localhost:3100');
assert.equal(localLocation.pathname, '/login');
assert.equal(localLocation.searchParams.get('next'), '/geschiedenis?q=markt');

process.env.APP_TRUST_PROXY = 'cloudflare';
const publicHeaders = {
  host: 'demo.example', 'cf-connecting-ip': '203.0.113.10',
  'x-forwarded-proto': 'https', 'x-forwarded-host': 'attacker.invalid',
};
const publicPage = await proxy(new NextRequest('http://localhost:3100/briefing?from=%2F', {
  headers: publicHeaders,
}));
assert.equal(publicPage.status, 307);
const publicLocation = new URL(publicPage.headers.get('location')!);
assert.equal(publicLocation.origin, 'https://demo.example');
assert.equal(publicLocation.pathname, '/login');
assert.equal(publicLocation.searchParams.get('next'), '/briefing?from=%2F');

const mutation = await proxy(new NextRequest('http://localhost:3100/briefing', {
  method: 'POST', headers: publicHeaders,
}));
assert.equal(mutation.status, 303);
assert.equal(new URL(mutation.headers.get('location')!).origin, 'https://demo.example');

const api = await proxy(new NextRequest('http://localhost:3100/api/sources', {
  headers: publicHeaders,
}));
assert.equal(api.status, 401);
assert.equal(api.headers.has('location'), false);
console.log('PASS: local/public redirects use absolute validated origins and relative return targets; APIs remain JSON 401.');

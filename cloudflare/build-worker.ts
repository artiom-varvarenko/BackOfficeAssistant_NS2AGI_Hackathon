import { build } from 'esbuild';
import path from 'node:path';
import fs from 'node:fs';

const root = path.resolve(import.meta.dirname, '..');
const web = path.join(root, 'web/src');
const apiRoot = path.join(web, 'app/api');
const files = fs.readdirSync(apiRoot, { recursive: true }).filter((file) => String(file).endsWith('route.ts')).map(String).sort((a, b) => Number(a.includes('[')) - Number(b.includes('[')));
const imports: string[] = [];
const dispatch: string[] = [];
files.forEach((file, index) => {
  const fullPath = path.join(apiRoot, file);
  const routePath = '/api/' + file.replace(/\\/g, '/').replace(/\/?route\.ts$/, '');
  const names: string[] = [];
  const pattern = routePath.replace(/\[([^\]]+)\]/g, (_, name: string) => { names.push(name); return '([^/]+)'; }).replace(/\/$/, '');
  imports.push(`import * as route${index} from ${JSON.stringify(path.relative(path.join(import.meta.dirname, 'build'), fullPath).replace(/\\/g, '/'))};`);
  const source = fs.readFileSync(fullPath, 'utf8');
  for (const match of source.matchAll(/export async function (GET|POST|PUT|PATCH|DELETE|HEAD)\s*\(([^)]*)\)/g)) {
    const method = match[1];
    const params = names.map((name, i) => `${JSON.stringify(name)}: decodeURIComponent(m[${i + 1}])`).join(',');
    const args = !match[2].trim() ? '' : names.length ? `request, { params: Promise.resolve({${params}}) }` : 'request';
    dispatch.push(`if (request.method === '${method}' && (m = new RegExp(${JSON.stringify('^' + pattern + '/?$')}).exec(path))) return route${index}.${method}(${args});`);
  }
});
fs.mkdirSync(path.join(import.meta.dirname, 'build'), { recursive: true });
fs.writeFileSync(path.join(import.meta.dirname, 'build/routes.ts'), `${imports.join('\n')}\nimport type { NextRequest } from '../next-server';\nexport async function dispatch(request: NextRequest): Promise<Response> { const path = new URL(request.url).pathname; let m: RegExpExecArray | null; ${dispatch.join('\n')} return Response.json({error:{code:'not_found',message:'Not found.'}},{status:404}); }\n`);
await build({
  entryPoints: [path.join(import.meta.dirname, 'worker.ts')],
  outfile: path.join(import.meta.dirname, 'build/worker.js'),
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  target: 'es2022',
  conditions: ['workerd', 'worker', 'browser', 'import', 'default'],
  mainFields: ['module', 'main'],
  external: ['cloudflare:*', 'node:*'],
  minify: true,
  sourcemap: true,
  plugins: [{ name: 'cloudflare-adapters', setup(build) {
    build.onResolve({ filter: /^(better-sqlite3|node:fs|fs|next\/server)$/ }, ({ path: specifier }) => ({
      path: path.join(import.meta.dirname, specifier === 'better-sqlite3' ? 'runtime-db.ts' : specifier === 'next/server' ? 'next-server.ts' : 'runtime-fs.ts'),
    }));
    build.onResolve({ filter: /^@\// }, ({ path: specifier }) => ({
      path: specifier === '@/lib/source-download'
        ? path.join(import.meta.dirname, 'source-download.ts')
        : fs.existsSync(path.join(web, specifier.slice(2) + '.ts')) ? path.join(web, specifier.slice(2) + '.ts') : path.join(web, specifier.slice(2), 'index.ts'),
    }));
  } }],
});

const fs = require('node:fs');
const path = require('node:path');
const dir = path.join(__dirname, '.private');
const base = process.argv[2];
if (!base || !/^https:\/\/[a-z0-9.-]+\.workers\.dev$/.test(base)) throw new Error('Pass the deployed HTTPS workers.dev origin.');
const secrets = JSON.parse(fs.readFileSync(path.join(dir, 'secrets.json'), 'utf8'));
const data = JSON.parse(fs.readFileSync(path.join(dir, 'workspace.json'), 'utf8'));
async function send(route, body, contentType) {
  const response = await fetch(base + route, {
    method: 'POST', headers: { authorization: `Bearer ${secrets.BOOTSTRAP_TOKEN}`, 'content-type': contentType },
    body, signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) {
    const text = (await response.text()).slice(0, 300);
    throw new Error(`Import failed at ${route}: ${response.status} ${text}`);
  }
  return response.json();
}
(async () => {
  for (const [table, rows] of Object.entries(data)) {
    for (let offset = 0; offset < rows.length; offset += 30) {
      await send('/__bootstrap/data', JSON.stringify({ table, rows: rows.slice(offset, offset + 30) }), 'application/json');
    }
    console.log(`${table}: ${rows.length} rows imported`);
  }
  for (const version of data.source_versions) {
    const original = path.resolve(__dirname, '../web/storage/files', `${version.id}.pdf`);
    const file = fs.existsSync(original) ? original : version.file_path;
    if (!fs.existsSync(file)) throw new Error(`Missing PDF for version ${version.id}`);
    const content = fs.readFileSync(file);
    await send(`/__bootstrap/file?id=${encodeURIComponent(version.id)}`, content, 'application/pdf');
    console.log(`PDF ${version.id}: ${content.byteLength} bytes imported`);
  }
  await send('/__bootstrap/finish', '{}', 'application/json');
  const access = path.join(dir, 'jury-access.txt');
  fs.writeFileSync(access, fs.readFileSync(access, 'utf8').replace('pending deployment', base));
  console.log('Workspace import complete.');
})().catch(error => { console.error(error.message); process.exitCode = 1; });

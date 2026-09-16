// Seeds the nine documents of PLAN.md section 8.2 through the same code path
// as an upload (createSource). Idempotent: a file whose sha256 is already in
// source_versions is skipped. Run from web/:
//   npm run seed [-- --skip <file> [--skip <file> ...]]
// DATA_DIR overrides the default ../data directory.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { getDb } from '@/lib/db';
import { createSource, findVersionBySha, IngestError, type SourceMeta, type VersionMeta } from '@/lib/ingest';

type SeedEntry = { file: string } & SourceMeta & Omit<VersionMeta, 'fileName'>;

const SEED: SeedEntry[] = [
  {
    file: 'Schoten-marktreglement-2024.pdf',
    title: 'Bijzonder politiereglement voor de openbare markt',
    authority: 'Gemeente Schoten — gemeenteraad',
    level: 'municipal',
    docType: 'bylaw',
    scope: 'Schoten',
    documentDate: '2024-03-28',
    versionLabel: 'GR 28-03-2024, in werking 01-04-2024',
    validFrom: '2024-04-01',
    validUntil: null,
    applicability: 'unverified',
    originalUrl:
      'https://www.schoten.be/sites/default/files/2024-03/GR%2028-03-2024_2000_Uittreksel%20in%20pdf_Marktreglement.pdf',
  },
  {
    file: 'Schoten-markt-en-kermisretributies-2026-2031.pdf',
    title: 'Retributiereglement openbare markten en kermissen',
    authority: 'Gemeente Schoten — gemeenteraad',
    level: 'municipal',
    docType: 'fee_regulation',
    scope: 'Schoten',
    documentDate: '2025-11-24',
    versionLabel: 'Goedgekeurd 24-11-2025, geldig 2026–2031',
    validFrom: '2026-01-01',
    validUntil: '2031-12-31',
    applicability: 'unverified',
    originalUrl:
      'https://www.schoten.be/sites/default/files/public/documenten/Reglementen/Retributiereglementen%2026-31/Retributiereglement%20op%20de%20openbare%20markten%20en%20kermissen%202026-2031.pdf',
  },
  {
    file: 'Schoten-terrassen-en-uitstallingen-ongedateerd.pdf',
    title: 'Reglement voor terrassen en uitstallingen',
    authority: 'Gemeente Schoten',
    level: 'municipal',
    docType: 'bylaw',
    scope: 'Schoten',
    documentDate: null,
    versionLabel: 'ongedateerd',
    validFrom: null,
    validUntil: null,
    applicability: 'unverified',
    originalUrl: null,
  },
  {
    file: 'VLAIO-mijn-eigen-zaak-januari-2026.pdf',
    title: 'Mijn eigen zaak — Starten met kennis van zaken',
    authority: 'VLAIO — Agentschap Innoveren & Ondernemen',
    level: 'flemish',
    docType: 'brochure',
    scope: 'Vlaanderen',
    documentDate: null,
    versionLabel: 'Versie januari 2026 (richtlijn, geen wetgeving)',
    validFrom: null,
    validUntil: null,
    applicability: 'unverified',
    originalUrl: null,
  },
  {
    file: 'FAVV-heffingen-FAQ-juni-2026.pdf',
    title: 'Brochure heffingen 2026',
    authority: 'Federaal Agentschap voor de Veiligheid van de Voedselketen',
    level: 'federal',
    docType: 'brochure',
    scope: 'België',
    documentDate: '2026-06-15',
    versionLabel: '15/06/26 (richtlijn, geen wetgeving)',
    validFrom: null,
    validUntil: null,
    applicability: 'unverified',
    originalUrl: null,
  },
  {
    file: 'Antwerpen-innovatiefonds-reglement-2026.pdf',
    title: 'Subsidiereglement Innovatiefonds Provincie Antwerpen',
    authority: 'Provincie Antwerpen',
    level: 'provincial',
    docType: 'subsidy_regulation',
    scope: 'Provincie Antwerpen',
    documentDate: null,
    versionLabel: '2026; volgens tekst van kracht vanaf 1 juni 2026',
    validFrom: '2026-06-01',
    validUntil: null,
    applicability: 'unverified',
    originalUrl: null,
  },
  {
    file: 'HISTORICAL-Omgevingsloket-kleinhandel-2019.pdf',
    title: 'Handleiding Omgevingsloket — Kleinhandelsactiviteiten',
    authority: 'Vlaamse overheid — Omgeving / VLAIO',
    level: 'flemish',
    docType: 'manual',
    scope: 'Vlaanderen',
    documentDate: null,
    versionLabel: 'versie 01/2019',
    validFrom: null,
    validUntil: null,
    applicability: 'historical',
    originalUrl: null,
  },
  {
    file: 'HISTORICAL-FAVV-koninklijk-besluit-2006.pdf',
    title: 'Koninklijk besluit van 16 januari 2006 (FAVV erkenningen, toelatingen en registraties)',
    authority: 'Federale overheid — Belgisch Staatsblad',
    level: 'federal',
    docType: 'royal_decree',
    scope: 'België',
    documentDate: '2006-01-16',
    versionLabel: 'KB 16-01-2006, BS 02-03-2006; niet-geconsolideerde versie',
    validFrom: '2006-03-15',
    validUntil: null,
    applicability: 'historical',
    originalUrl: null,
  },
  {
    file: 'HISTORICAL-FAVV-controle-gids-cover-2022.pdf',
    title: 'De weg naar een feilloze FAVV-controle',
    authority: 'Federaal Agentschap voor de Veiligheid van de Voedselketen',
    level: 'federal',
    docType: 'brochure',
    scope: 'België',
    documentDate: null,
    versionLabel: 'cover 2022, colofon november 2018',
    validFrom: null,
    validUntil: null,
    applicability: 'historical',
    originalUrl: null,
  },
];

const MARKTREGLEMENT_FILE = 'Schoten-marktreglement-2024.pdf';

interface VersionSummary {
  title: string;
  page_count: number | null;
  processing_status: string;
  processing_error: string | null;
  extraction_warning: string | null;
  passage_count: number;
}

async function main(): Promise<void> {
  const skip = new Set<string>();
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--skip' && args[i + 1]) skip.add(args[++i]);
    else throw new Error(`Onbekend argument: ${args[i]} (gebruik: npm run seed -- --skip <bestand>)`);
  }
  const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.resolve(process.cwd(), '..', 'data');
  const db = getDb();
  console.log(`Seed uit ${dataDir}`);

  const shaByFile: Record<string, string> = {};
  for (const entry of SEED) {
    const { file, title, authority, level, docType, scope, originalUrl, ...version } = entry;
    const filePath = path.join(dataDir, file);
    if (!fs.existsSync(filePath)) {
      console.log(`${file}: ${skip.has(file) ? 'overgeslagen (--skip)' : `MISLUKT · bestand niet gevonden (${filePath})`}`);
      continue;
    }
    const buffer = fs.readFileSync(filePath);
    const sha = createHash('sha256').update(buffer).digest('hex');
    shaByFile[file] = sha;
    if (skip.has(file)) {
      console.log(`${file}: overgeslagen (--skip)`);
      continue;
    }
    const existing = findVersionBySha(sha);
    if (existing) {
      console.log(`${file}: overgeslagen (bestaat al, versie ${existing.versionId})`);
      continue;
    }
    try {
      const result = await createSource(buffer, { title, authority, level, docType, scope, originalUrl }, { fileName: file, ...version });
      const warning = result.warning ? ` · ⚠ ${result.warning}` : '';
      console.log(`${file}: verwerkt · ${result.pageCount} p. · ${result.passageCount} passages${warning}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.log(`${file}: MISLUKT · ${message}${err instanceof IngestError ? '' : ' (onverwachte fout)'}`);
    }
  }

  console.log('\nOverzicht (huidige versie per document):');
  const summaryStmt = db.prepare(
    `SELECT s.title, v.page_count, v.processing_status, v.processing_error, v.extraction_warning,
            (SELECT COUNT(*) FROM passages p WHERE p.version_id = v.id) AS passage_count
     FROM source_versions v JOIN sources s ON s.id = v.source_id
     WHERE v.sha256 = ? ORDER BY v.created_at DESC LIMIT 1`,
  );
  for (const entry of SEED) {
    const sha = shaByFile[entry.file];
    const row = sha ? (summaryStmt.get(sha) as VersionSummary | undefined) : undefined;
    if (!row) {
      console.log(`${entry.title} · niet aanwezig`);
      continue;
    }
    const status = row.processing_status === 'failed' ? `failed (${row.processing_error})` : row.processing_status;
    console.log(`${row.title} · ${row.page_count ?? '?'} p. · ${row.passage_count} passages · ${status} · ${row.extraction_warning ?? '—'}`);
  }

  // Sanity check (PLAN.md section 8.2 step 9): Article 13 §3 spans p. 5-6.
  const marktSha = shaByFile[MARKTREGLEMENT_FILE];
  const markt = marktSha ? findVersionBySha(marktSha) : null;
  if (!markt) {
    console.log('\nSANITY CHECK: overgeslagen (marktreglement niet aanwezig)');
    return;
  }
  const hits = db
    .prepare(
      `SELECT page_start, page_end, article, section, text FROM passages
       WHERE version_id = ? AND text LIKE '%aanvraagformulier op de website%'`,
    )
    .all(markt.versionId) as { page_start: number; page_end: number; article: string | null; section: string | null; text: string }[];
  const hit = hits[0];
  const pass = hits.length === 1 && hit.page_start === 5 && hit.page_end === 6 && hit.article?.startsWith('Artikel 13') === true;
  console.log(`\nSANITY CHECK: ${pass ? 'PASS' : 'FAIL'} (${hits.length} passage(s) met "aanvraagformulier op de website")`);
  for (const h of hits) {
    console.log(`  article=${JSON.stringify(h.article)} section=${JSON.stringify(h.section)} pages=${h.page_start}–${h.page_end}`);
    console.log(`  text: ${JSON.stringify(h.text.slice(0, 200))}`);
  }
  if (!pass) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

import type { Database } from 'better-sqlite3';

// Keep the stored notices stable so a successful retry removes exactly its
// own optional-enrichment warning, without hiding unreadable-page warnings.
export const ENRICHMENT_WARNINGS = {
  summary: 'De automatische samenvatting is niet gelukt. Controleer Instellingen en gebruik Samenvatting genereren op de bronpagina.',
  embeddings: 'De automatische embeddings zijn niet gelukt. Controleer Instellingen en gebruik Embeddings berekenen op de bronpagina.',
} as const;

export type EnrichmentKind = keyof typeof ENRICHMENT_WARNINGS;

// Call inside the successful operation's transaction, after its version guard.
// Read the latest warning there: the other enrichment may have changed it.
export function clearEnrichmentWarning(versionId: string, kind: EnrichmentKind, db: Database): void {
  const version = db.prepare<[string], { extraction_warning: string | null }>(
    'SELECT extraction_warning FROM source_versions WHERE id = ?',
  ).get(versionId);
  const warning = version?.extraction_warning;
  const notice = ENRICHMENT_WARNINGS[kind];
  if (!warning?.includes(notice)) return;
  const remaining = warning.split(notice).map((part) => part.trim()).filter(Boolean).join(' ');
  db.prepare('UPDATE source_versions SET extraction_warning = ? WHERE id = ?').run(remaining || null, versionId);
}

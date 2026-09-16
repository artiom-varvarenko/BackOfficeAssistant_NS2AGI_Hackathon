import type { Answer, AnswerListItem, Citation, Settings, Source, SourceVersion } from './types';

// Development data only. Never silently substitute fixtures for a failed API call.
const at = '2026-09-16T09:00:00.000Z';
export const exampleQuestions = [
  'Ik wil een vaste standplaats op de markt in Schoten. Hoe dien ik een aanvraag in?',
  'Ik wil één keer op zaterdag op de markt staan zonder abonnement. Waar en wanneer moet ik me aanmelden en wat kost dat?',
  'Welke startpremie kan ik als nieuwe zelfstandige in Schoten aanvragen en hoeveel bedraagt die?',
];

const entries: Array<Pick<Source, 'title' | 'authority' | 'level' | 'docType' | 'scope' | 'originalUrl'> & {
  file: string; pages: number; date: string | null; label: string; historical?: boolean; warning?: string;
}> = [
  { title: 'Bijzonder politiereglement voor de openbare markt', authority: 'Gemeente Schoten — gemeenteraad', level: 'municipal', docType: 'bylaw', scope: 'Schoten', file: 'Schoten-marktreglement-2024.pdf', pages: 11, date: '2024-03-28', label: 'GR 28-03-2024, in werking 01-04-2024', originalUrl: 'https://www.schoten.be/sites/default/files/2024-03/GR%2028-03-2024_2000_Uittreksel%20in%20pdf_Marktreglement.pdf' },
  { title: 'Retributiereglement openbare markten en kermissen', authority: 'Gemeente Schoten — gemeenteraad', level: 'municipal', docType: 'fee_regulation', scope: 'Schoten', file: 'Schoten-markt-en-kermisretributies-2026-2031.pdf', pages: 2, date: '2025-11-24', label: 'Goedgekeurd 24-11-2025, geldig 2026–2031', originalUrl: 'https://www.schoten.be/sites/default/files/public/documenten/Reglementen/Retributiereglementen%2026-31/Retributiereglement%20op%20de%20openbare%20markten%20en%20kermissen%202026-2031.pdf' },
  { title: 'Reglement voor terrassen en uitstallingen', authority: 'Gemeente Schoten', level: 'municipal', docType: 'bylaw', scope: 'Schoten', file: 'Schoten-terrassen-en-uitstallingen-ongedateerd.pdf', pages: 4, date: null, label: 'ongedateerd', originalUrl: null },
  { title: 'Mijn eigen zaak — Starten met kennis van zaken', authority: 'VLAIO — Agentschap Innoveren & Ondernemen', level: 'flemish', docType: 'brochure', scope: 'Vlaanderen', file: 'VLAIO-mijn-eigen-zaak-januari-2026.pdf', pages: 36, date: null, label: 'Versie januari 2026 (richtlijn, geen wetgeving)', originalUrl: null },
  { title: 'Brochure heffingen 2026', authority: 'Federaal Agentschap voor de Veiligheid van de Voedselketen', level: 'federal', docType: 'brochure', scope: 'België', file: 'FAVV-heffingen-FAQ-juni-2026.pdf', pages: 40, date: '2026-06-15', label: '15/06/26 (richtlijn, geen wetgeving)', originalUrl: null },
  { title: 'Subsidiereglement Innovatiefonds Provincie Antwerpen', authority: 'Provincie Antwerpen', level: 'provincial', docType: 'subsidy_regulation', scope: 'Provincie Antwerpen', file: 'Antwerpen-innovatiefonds-reglement-2026.pdf', pages: 10, date: null, label: '2026; volgens tekst van kracht vanaf 1 juni 2026', originalUrl: null },
  { title: 'Handleiding Omgevingsloket — Kleinhandelsactiviteiten', authority: 'Vlaamse overheid — Omgeving / VLAIO', level: 'flemish', docType: 'manual', scope: 'Vlaanderen', file: 'HISTORICAL-Omgevingsloket-kleinhandel-2019.pdf', pages: 5, date: null, label: 'versie 01/2019', historical: true, originalUrl: null },
  { title: 'Koninklijk besluit van 16 januari 2006 (FAVV erkenningen, toelatingen en registraties)', authority: 'Federale overheid — Belgisch Staatsblad', level: 'federal', docType: 'royal_decree', scope: 'België', file: 'HISTORICAL-FAVV-koninklijk-besluit-2006.pdf', pages: 66, date: '2006-01-16', label: 'KB 16-01-2006, BS 02-03-2006; niet-geconsolideerde versie', historical: true, warning: "35 van 66 pagina's bevatten geen leesbare tekst", originalUrl: null },
  { title: 'De weg naar een feilloze FAVV-controle', authority: 'Federaal Agentschap voor de Veiligheid van de Voedselketen', level: 'federal', docType: 'brochure', scope: 'België', file: 'HISTORICAL-FAVV-controle-gids-cover-2022.pdf', pages: 40, date: null, label: 'cover 2022, colofon november 2018', historical: true, warning: "6 van 40 pagina's bevatten geen leesbare tekst", originalUrl: null },
];

export const fixtureSources: Source[] = entries.map((entry, index) => {
  const id = `fixture-source-${index + 1}`;
  const version: SourceVersion = {
    id: `${id}-v1`, sourceId: id, versionNo: 1, fileName: entry.file, pageCount: entry.pages,
    documentDate: entry.date, versionLabel: entry.label,
    validFrom: [ '2024-04-01', '2026-01-01', null, null, null, '2026-06-01', null, '2006-03-15', null ][index],
    validUntil: index === 1 ? '2031-12-31' : null, applicability: entry.historical ? 'historical' : 'unverified',
    applicabilityNote: null, verifiedAt: null, processingStatus: 'ready', processingError: null,
    extractionWarning: entry.warning ?? null, passageCount: entry.pages * 3,
    pdfUrl: `/api/files/${id}-v1`, createdAt: at,
  };
  const versions = [version];
  if (index === 1) versions.push({ ...version, id: `${id}-v0`, versionNo: 0, applicability: 'superseded', versionLabel: 'Voorbeeld van een vervangen versie', pdfUrl: `/api/files/${id}-v0` });
  return { id, title: entry.title, authority: entry.authority, level: entry.level, docType: entry.docType,
    scope: entry.scope, originalUrl: entry.originalUrl, enabled: true, summary: null,
    currentVersion: version, versions, createdAt: at, updatedAt: at };
});

const market = fixtureSources[0];
const version = market.currentVersion!;
const citation = (marker: number, pageStart: number, pageEnd: number, article: string, section: string, quoteText: string): Citation => ({
  marker, passageId: `fixture-passage-${marker}`, versionId: version.id, sourceId: market.id,
  sourceTitle: market.title, authority: market.authority, level: market.level, originalUrl: market.originalUrl,
  documentDate: version.documentDate, versionLabel: version.versionLabel, applicability: 'unverified',
  applicabilityNote: null, verifiedAt: null, sourceEnabled: true, isCurrentVersion: true, pageStart, pageEnd, article, section,
  quoteText, highlight: marker === 1 ? 'aanvraagformulier op de website van de gemeente Schoten' : null,
  pdfUrl: `${version.pdfUrl}#page=${pageStart}`, checked: marker === 1, checkNote: null, checkedAt: marker === 1 ? at : null,
});

export const fixtureAnswer: Answer = {
  id: 'fixture-answer-1', question: exampleQuestions[0], status: 'draft', canAnswer: 'gedeeltelijk',
  generatedAnswer: 'Dien uw kandidatuur voor een vaste standplaats in via het aanvraagformulier op de website van de gemeente Schoten. Dat kan na de melding van een vacature of op elk ander tijdstip. [1]\n\nVermeld uw contactgegevens, ondernemingsgegevens, productomschrijving en het aantal gewenste kavels. Voeg de gevraagde bewijsstukken toe, waaronder een FAVV-attest als u voeding verkoopt. [1]\n\nU ontvangt een ontvangstbewijs en vervolgens een bevestiging of een plaats op de wachtlijst. De aanvragen worden chronologisch behandeld. [2]\n\nBevestig jaarlijks uw kandidatuur om op de wachtlijst te blijven staan. [3]',
  reviewedAnswer: null, reviewNote: null, emailDraft: null,
  gaps: ['De quota-bijlage is niet opgenomen in de aangeleverde bronnen.', 'De rechtstreekse URL van het aanvraagformulier ontbreekt.'],
  warnings: ['De toepasselijkheid van het marktreglement is niet geverifieerd door een medewerker.', 'Controleer of de vermelde bewijsstukken op uw situatie van toepassing zijn.'], conflicts: [], uncitedSentences: 0,
  citations: [
    citation(1, 5, 6, 'Artikel 13 — Vacature en kandidatuurstelling standplaats met abonnement', '§3', '§3. Een onderneming die een standplaats met abonnement wenst te bekomen, dient zich kandidaat te stellen door het invullen van het aanvraagformulier op de website van de gemeente Schoten, na melding van een vacature of op elk ander tijdstip.'),
    citation(2, 6, 6, 'Artikel 13 — Vacature en kandidatuurstelling standplaats met abonnement', '§6–7', 'Voorbeeldpassage: ontvangstbewijs, bevestiging of wachtlijst; chronologische behandeling. Deze fixture is geen letterlijke PDF-extractie.'),
    citation(3, 6, 6, 'Artikel 14 — Wachtregister', '§2', 'Voorbeeldpassage: de kandidatuur moet jaarlijks worden bevestigd, anders vervalt ze. Deze fixture is geen letterlijke PDF-extractie.'),
  ],
  events: [{ type: 'generated', at, detail: 'Voorbeeldantwoord voor ontwikkeling' }],
  provider: 'openai', model: 'gpt-6-astra', effort: 'low', passagesSent: 8, sourcesUsed: 1,
  regeneratedFromId: null, sourcesChangedSince: false, scopeSourceIds: null, createdAt: at, updatedAt: at, reviewedAt: null,
};

export const fixtureHistory: AnswerListItem[] = [
  { id: fixtureAnswer.id, question: fixtureAnswer.question, status: 'draft', canAnswer: 'gedeeltelijk', citationCount: 3, checkedCount: 1, createdAt: at },
  { id: 'fixture-answer-2', question: exampleQuestions[2], status: 'rejected', canAnswer: 'nee', citationCount: 0, checkedCount: 0, createdAt: '2026-09-15T14:30:00.000Z' },
];

export const fixtureSettings: Settings = {
  municipality: 'Schoten', testedConfiguration: 'openai/gpt-6-astra',
  tasks: { answer: { provider: 'openai', model: 'gpt-6-astra', effort: 'low' }, draft: { provider: 'openai', model: 'gpt-5.6-terra', effort: 'none' }, summary: { provider: 'openai', model: 'gpt-5.6-luna', effort: 'none' } },
  providers: [ 'openai', 'anthropic', 'google', 'mistral', 'azure', 'custom' ].map((id) => ({ id: id as Settings['providers'][number]['id'], label: { openai: 'OpenAI', anthropic: 'Anthropic', google: 'Google', mistral: 'Mistral', azure: 'Azure OpenAI', custom: 'OpenAI-compatibel' }[id]!, hasKey: false, keySource: null, maskedKey: null, baseUrl: null, models: id === 'openai' ? ['gpt-6-astra', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna'] : [], supportsEffort: id === 'openai' || id === 'azure' })),
  tts: { provider: 'none', voiceId: null, hasKey: false }, retrieval: { mode: 'bm25', embeddingsAvailable: false },
};

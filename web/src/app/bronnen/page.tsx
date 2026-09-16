'use client';
import { getSources } from '@/lib/api-client';
import { ResourceView } from '@/components/ResourceView';
import { SourceTable } from '@/components/SourceTable';
export default function SourcesPage() { return <><div className="page-heading"><div><h1>Bronnen</h1><p>Alleen ingeschakelde en verwerkte bronnen worden gebruikt voor nieuwe antwoorden. Eerdere antwoorden behouden hun eigen bronversies.</p></div></div><ResourceView load={getSources} loading="Bronnen laden…">{(sources) => <SourceTable sources={sources} />}</ResourceView></>; }

import { SourceDetail } from '@/components/SourceDetail';

export default async function SourcePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <SourceDetail key={id} sourceId={id} />;
}

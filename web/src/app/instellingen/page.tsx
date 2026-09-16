import { SettingsPage } from '@/components/SettingsPage';
import { connection } from 'next/server';

export default async function Page() {
  await connection();
  const configuredBudget = Number.parseInt(process.env.RETRIEVAL_CHAR_BUDGET ?? '', 10);
  const retrievalBudget = Number.isFinite(configuredBudget) && configuredBudget > 0 ? configuredBudget : 60000;
  return <SettingsPage retrievalBudget={retrievalBudget} />;
}

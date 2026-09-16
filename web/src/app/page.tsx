import { QuestionPage } from '@/components/QuestionPage';

export const dynamic = 'force-dynamic';

export default function Page() {
  return <QuestionPage streamingEnabled={process.env.APP_STREAMING !== 'off'} />;
}

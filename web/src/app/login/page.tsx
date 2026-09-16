import { redirect } from 'next/navigation';
import { LoginForm } from '@/components/LoginForm';

export const dynamic = 'force-dynamic';

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  if (!process.env.APP_PASSWORD) redirect('/');
  const { next } = await searchParams;
  const destination = typeof next === 'string' && next.startsWith('/') && !next.startsWith('//') && !next.includes('\\') ? next : '/';
  return <LoginForm destination={destination} />;
}

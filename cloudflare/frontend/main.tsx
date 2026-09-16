import { Component, useCallback, useEffect, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { AppShell } from '@/components/AppShell';
import { LanguageProvider, useLocale } from '@/components/LanguageProvider';
import { QuestionPage } from '@/components/QuestionPage';
import { SourceLibrary } from '@/components/SourceLibrary';
import { SourceDetail } from '@/components/SourceDetail';
import { HistoryTable } from '@/components/HistoryTable';
import { AnswerWorkspace } from '@/components/AnswerWorkspace';
import { BriefingView } from '@/components/BriefingView';
import { SettingsPage } from '@/components/SettingsPage';
import { EventLog } from '@/components/EventLog';
import { LoginForm } from '@/components/LoginForm';
import { ResourceView } from '@/components/ResourceView';
import { dateLabel } from '@/components/Badge';
import { getAnswer, getAnswers } from '@/lib/api-client';
import { getClientLocale, translate } from '@/lib/i18n';
import { useLocation, usePathname, useRouter } from './navigation';
import Link from './link';
import '@/app/globals.css';

function HistoryPage() {
  const { t } = useLocale();
  return <><div className="page-heading"><div><h1>{t('Geschiedenis')}</h1><p>{t('Vragen, beoordelingen en de bronpassages die toen zijn gebruikt.')}</p></div></div><ResourceView load={getAnswers} loading={t('Geschiedenis laden…')}>{(answers) => <HistoryTable answers={answers} />}</ResourceView></>;
}

function AnswerPage({ id, briefing }: { id: string; briefing?: boolean }) {
  const { locale, t } = useLocale();
  const load = useCallback(() => getAnswer(id), [id]);
  return <>{!briefing && <Link href="/geschiedenis">← {t('Terug naar geschiedenis')}</Link>}<ResourceView key={id} load={load} loading={t(briefing ? 'Briefing laden…' : 'Antwoord laden…')}>{(answer) => briefing
    ? <BriefingView answer={answer} />
    : <><div className="page-heading"><div><p className="eyebrow">{t('VRAAG VAN {date}', { date: dateLabel(answer.createdAt, locale) })}</p><h1>{answer.question}</h1></div></div><AnswerWorkspace key={answer.id} initialAnswer={answer} history /></>}
  </ResourceView></>;
}

function Page() {
  const pathname = usePathname().replace(/\/$/, '') || '/';
  const location = useLocation();
  const { t } = useLocale();
  if (pathname === '/') return <QuestionPage streamingEnabled />;
  if (pathname === '/bronnen') return <SourceLibrary />;
  const source = /^\/bronnen\/([^/]+)$/.exec(pathname);
  if (source) return <SourceDetail key={source[1]} sourceId={decodeURIComponent(source[1])} />;
  if (pathname === '/geschiedenis') return <HistoryPage />;
  const answer = /^\/geschiedenis\/([^/]+)(\/briefing)?$/.exec(pathname);
  if (answer) return <AnswerPage key={`${answer[1]}${answer[2] ?? ''}`} id={decodeURIComponent(answer[1])} briefing={!!answer[2]} />;
  if (pathname === '/instellingen') return <SettingsPage retrievalBudget={60000} />;
  if (pathname === '/logboek') return <EventLog />;
  if (pathname === '/login') {
    const requested = new URL(location, window.location.origin).searchParams.get('next');
    const destination = requested?.startsWith('/') && !requested.startsWith('//') && !requested.includes('\\') ? requested : '/';
    return <LoginForm destination={destination} />;
  }
  return <section className="card empty-state"><h1>404</h1><Link href="/">{t('Nieuwe vraag')}</Link></section>;
}

function SessionGate({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { t } = useLocale();
  const [checked, setChecked] = useState(pathname === '/login');
  useEffect(() => {
    if (pathname === '/login') return;
    let alive = true;
    fetch('/api/settings', { cache: 'no-store' }).then((response) => {
      if (!alive) return;
      if (response.status === 401) router.replace(`/login?next=${encodeURIComponent(`${window.location.pathname}${window.location.search}`)}`);
      setChecked(true);
    }).catch(() => { if (alive) setChecked(true); });
    return () => { alive = false; };
  }, [pathname, router]);
  return checked || pathname === '/login' ? children : <main className="login-main"><p className="card" role="status">{t('Gegevens laden…')}</p></main>;
}

function Workspace() {
  const location = useLocation();
  const pathname = usePathname();
  const { locale, t } = useLocale();
  useEffect(() => {
    document.title = t('Economie-assistent · Dienst lokale economie');
    document.querySelector('meta[name="description"]')?.setAttribute('content', t('Van ondernemersvraag naar een onderbouwd antwoord. Brononderzoek, heldere verwijzingen en menselijke beoordeling in één gemeentelijke werkruimte.'));
  }, [locale, t]);
  useEffect(() => {
    const hash = new URL(location, window.location.origin).hash.slice(1);
    if (hash) requestAnimationFrame(() => document.getElementById(decodeURIComponent(hash))?.scrollIntoView());
    else document.getElementById('inhoud')?.focus({ preventScroll: true });
  }, [location]);
  return <SessionGate><AppShell municipality="Schoten"><Page key={pathname} /></AppShell></SessionGate>;
}

class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (!this.state.failed) return this.props.children;
    const locale = getClientLocale();
    return <main className="login-main"><section className="card notice-red" role="alert"><h1>{translate('Gegevens konden niet worden geladen.', locale)}</h1><button onClick={() => window.location.reload()}>{translate('Opnieuw proberen', locale)}</button></section></main>;
  }
}

createRoot(document.getElementById('root')!).render(<ErrorBoundary><LanguageProvider initialLocale={getClientLocale()}><Workspace /></LanguageProvider></ErrorBoundary>);

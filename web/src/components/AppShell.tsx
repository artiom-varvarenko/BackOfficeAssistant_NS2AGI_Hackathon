'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { getSettings, useFixtures } from '@/lib/api-client';
import type { Settings } from '@/lib/types';
import { ModelBadge } from './ModelBadge';
import { ToastProvider } from './Toast';
import { ReviewNavigationProvider } from './ReviewNavigation';

export function AppShell({ children, municipality }: { children: ReactNode; municipality: string }) {
  const pathname = usePathname(); const [settings, setSettings] = useState<Settings | null>(null); const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (pathname === '/login') return;
    let alive = true; let sequence = 0;
    const refresh = () => {
      const request = ++sequence;
      getSettings().then((data) => { if (alive && request === sequence) { setSettings(data); setFailed(false); } }).catch(() => { if (alive && request === sequence) setFailed(true); });
    };
    refresh(); window.addEventListener('settings-updated', refresh);
    return () => { alive = false; window.removeEventListener('settings-updated', refresh); };
  }, [pathname]);
  if (pathname === '/login') return <ToastProvider><ReviewNavigationProvider><main id="inhoud" className="login-main">{children}</main></ReviewNavigationProvider></ToastProvider>;
  const nav = (href: string, label: string, symbol: string) => <Link href={href} className={`nav-link ${href === '/' ? pathname === '/' ? 'active' : '' : pathname.startsWith(href) ? 'active' : ''}`} aria-current={(href === '/' ? pathname === '/' : pathname.startsWith(href)) ? 'page' : undefined}><span aria-hidden="true">{symbol}</span>{label}</Link>;
  return <ToastProvider><ReviewNavigationProvider><div className="app-shell">
    <a href="#inhoud" className="skip-link">Naar de inhoud</a>
    <aside className="sidebar"><Link href="/" className="brand"><span className="brand-icon" aria-hidden="true">E</span><span>Economie<span className="brand-subtitle">assistent</span></span></Link><p className="sidebar-label">WERKRUIMTE</p><nav aria-label="Hoofdnavigatie">{nav('/', 'Nieuwe vraag', '+')}{nav('/bronnen', 'Bronnen', '▤')}{nav('/geschiedenis', 'Geschiedenis', '◷')}{nav('/logboek', 'Logboek', '≡')}</nav><div className="sidebar-bottom"><nav aria-label="Werkruimte-instellingen">{nav('/instellingen', 'Instellingen', '⚙')}</nav><p>Gemeente {settings?.municipality ?? municipality}<br />Dienst lokale economie</p></div></aside>
    <div className="workspace"><header className="topbar"><div><strong>Economie-assistent — Gemeente {settings?.municipality ?? municipality}</strong><p>Interne werkruimte dienst lokale economie · antwoorden worden nooit automatisch verzonden</p></div>{settings ? <ModelBadge model={settings.tasks.answer} /> : <span className="muted" role="status">{failed ? 'Modelinstellingen niet beschikbaar' : 'Modelinstellingen laden…'}</span>}</header>
      {useFixtures && <div className="fixture-banner" role="status">Voorbeeldmodus · vaste voorbeeldantwoorden, geen AI-aanroepen. Wijzigingen worden alleen in deze browser bewaard. PDF-bestanden en context vereisen de backend.</div>}
      <main id="inhoud" tabIndex={-1}>{children}</main><footer className="workspace-footer">Ondersteuning bij brononderzoek · controleer de toepasselijkheid en beoordeel ieder antwoord.</footer>
    </div>
  </div></ReviewNavigationProvider></ToastProvider>;
}

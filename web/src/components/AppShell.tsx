'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { getSettings } from '@/lib/api-client';
import type { Settings } from '@/lib/types';
import { Icon, type IconName } from './Icon';
import { ModelBadge } from './ModelBadge';
import { ToastProvider } from './Toast';
import { ReviewNavigationProvider } from './ReviewNavigation';
import { LanguageSwitch, useLocale } from './LanguageProvider';

const navigation: { href: string; label: string; icon: IconName }[] = [
  { href: '/', label: 'Nieuwe vraag', icon: 'question' },
  { href: '/bronnen', label: 'Bronnen', icon: 'library' },
  { href: '/geschiedenis', label: 'Geschiedenis', icon: 'history' },
  { href: '/logboek', label: 'Logboek', icon: 'logbook' },
];

function pageTitle(pathname: string): string {
  if (pathname.endsWith('/briefing')) return 'Briefing';
  if (pathname.startsWith('/bronnen/')) return 'Brondetail';
  if (pathname.startsWith('/geschiedenis/')) return 'Antwoord bekijken';
  if (pathname.startsWith('/instellingen')) return 'Instellingen';
  return navigation.find(({ href }) => href === pathname)?.label ?? 'Werkruimte';
}

export function AppShell({ children, municipality }: { children: ReactNode; municipality: string }) {
  const pathname = usePathname();
  const { t } = useLocale();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (pathname === '/login') return;
    let alive = true;
    let sequence = 0;
    const refresh = () => {
      const request = ++sequence;
      getSettings().then((data) => {
        if (alive && request === sequence) { setSettings(data); setFailed(false); }
      }).catch(() => { if (alive && request === sequence) setFailed(true); });
    };
    refresh();
    window.addEventListener('settings-updated', refresh);
    return () => { alive = false; window.removeEventListener('settings-updated', refresh); };
  }, [pathname]);

  if (pathname === '/login') return <ToastProvider><ReviewNavigationProvider><div className="login-language"><LanguageSwitch /></div><main id="inhoud" className="login-main">{children}</main></ReviewNavigationProvider></ToastProvider>;

  const municipalityName = settings?.municipality ?? municipality;
  const initials = `Gemeente ${municipalityName}`.split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]).join('').toUpperCase();
  const nav = (href: string, label: string, icon: IconName) => {
    const active = href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);
    return <Link key={href} href={href} className={`nav-link${active ? ' active' : ''}`} aria-current={active ? 'page' : undefined}>
      <Icon name={icon} className="nav-icon" /><span className="nav-label">{t(label)}</span>{active && <span className="nav-active-dot" aria-hidden="true" />}
    </Link>;
  };

  return <ToastProvider><ReviewNavigationProvider><div className="app-shell">
    <a href="#inhoud" className="skip-link">{t('Naar de inhoud')}</a>
    <aside className="sidebar">
      <Link href="/" className="brand" aria-label={t('Economie-assistent, naar nieuwe vraag')}>
        <span className="brand-icon"><Icon name="civic" size={29} /></span>
        <span className="brand-wordmark">{t('Economie')}<span className="brand-subtitle">{t('assistent')}</span></span>
      </Link>
      <p className="sidebar-label">{t('WERKRUIMTE')}</p>
      <nav aria-label={t('Hoofdnavigatie')}>{navigation.map(({ href, label, icon }) => nav(href, label, icon))}</nav>
      <div className="sidebar-bottom">
        <div className="sidebar-review-note"><Icon name="shield" size={20} /><div><strong>{t('U houdt de regie')}</strong><p>{t('Bronnen controleren.')}<br />{t('Antwoorden beoordelen.')}</p></div></div>
        <nav aria-label={t('Werkruimte-instellingen')}>{nav('/instellingen', 'Instellingen', 'settings')}</nav>
        <div className="workspace-identity">
          <span className="workspace-avatar" aria-hidden="true">{initials}</span>
          <div className="workspace-identity-copy"><strong>{t('Gemeente {name}', { name: municipalityName })}</strong><span>{t('Dienst lokale economie')}</span></div>
        </div>
      </div>
    </aside>
    <div className="workspace">
      <header className="topbar">
        <div className="topbar-path" aria-label={t('Huidige pagina')}><span className="topbar-section">{t('Werkruimte')}</span><Icon name="chevron-right" size={14} /><strong className="topbar-title">{t(pageTitle(pathname))}</strong></div>
        <div className="topbar-actions">
          <span className="private-workspace"><Icon name="lock" size={14} />{t('Interne werkruimte')}</span>
          <LanguageSwitch />
          {settings ? <ModelBadge model={settings.tasks.answer} /> : <span className="muted" role="status">{t(failed ? 'Modelinstellingen niet beschikbaar' : 'Modelinstellingen laden…')}</span>}
        </div>
      </header>
      <main id="inhoud" tabIndex={-1}>{children}</main>
      <footer className="workspace-footer"><span className="footer-mark"><Icon name="shield" size={15} />{t('Altijd met menselijke beoordeling')}</span><span>{t('Antwoorden worden nooit automatisch verzonden.')}</span></footer>
    </div>
  </div></ReviewNavigationProvider></ToastProvider>;
}

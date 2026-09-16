'use client';
import { useLocale } from './LanguageProvider';

import { useRef, useState } from 'react';
import { ApiClientError, login } from '@/lib/api-client';

export function LoginForm({ destination }: { destination: string }) {
  const { t } = useLocale();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const running = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  async function submit() {
    if (running.current || !password) return;
    running.current = true; setBusy(true); setError('');
    try {
      await login(password);
      setPassword('');
      // Resolve and compare origins before using an untrusted return path.
      const target = new URL(destination, window.location.origin);
      window.location.assign(target.origin === window.location.origin && target.pathname !== '/login' ? `${target.pathname}${target.search}${target.hash}` : '/');
    } catch (e) {
      setError(e instanceof ApiClientError && (e.status === 401 || e.code === 'invalid_password') ? t("Onjuist wachtwoord.") : e instanceof Error ? e.message : t("Aanmelden is mislukt. Probeer opnieuw."));
      setBusy(false); running.current = false;
      input.current?.focus();
    }
  }
  return <section className="card login-card"><span className="login-emblem" aria-hidden="true"><svg width="32" height="32" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M7 4h12l6 6v18H7zM19 4v7h6M12 16h8M12 21h5" strokeLinejoin="round" /></svg></span><p className="eyebrow">{t("ECONOMIE-ASSISTENT")}</p><h1>{t("Welkom in")}<br />{t("uw werkruimte.")}</h1><p className="login-intro">{t("Uw bronnen, helder inzicht.")}<br />{t("Samen werken aan zorgvuldig onderbouwde antwoorden.")}</p><form onSubmit={(event) => { event.preventDefault(); void submit(); }}>
    <label className="field" htmlFor="workspace-password">{t("Wachtwoord van de werkruimte")}<input ref={input} id="workspace-password" type="password" name="password" autoComplete="current-password" autoFocus required value={password} onChange={(event) => setPassword(event.target.value)} readOnly={busy} aria-invalid={!!error} aria-describedby={error ? 'login-error' : undefined} /></label>
    <button className="primary" type="submit" disabled={busy || !password}>{busy ? t("Aanmelden…") : t("Werkruimte openen")}</button>
    {error && <p className="notice notice-red" id="login-error" role="alert">{error}</p>}
  </form><p className="login-footnote">{t("Een besloten werkruimte.")}<br />{t("De medewerker houdt altijd de regie.")}</p></section>;
}

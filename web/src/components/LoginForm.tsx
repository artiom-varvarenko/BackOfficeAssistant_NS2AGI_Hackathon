'use client';

import { useRef, useState } from 'react';
import { ApiClientError, login } from '@/lib/api-client';

export function LoginForm({ destination }: { destination: string }) {
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
      setError(e instanceof ApiClientError && (e.status === 401 || e.code === 'invalid_password') ? 'Onjuist wachtwoord.' : e instanceof Error ? e.message : 'Aanmelden is mislukt. Probeer opnieuw.');
      setBusy(false); running.current = false;
      input.current?.focus();
    }
  }
  return <section className="card login-card"><p className="eyebrow">ECONOMIE-ASSISTENT</p><h1>Aanmelden</h1><p>Voer het wachtwoord in om de werkruimte te openen.</p><form onSubmit={(event) => { event.preventDefault(); void submit(); }}>
    <label className="field" htmlFor="workspace-password">Wachtwoord van de werkruimte<input ref={input} id="workspace-password" type="password" name="password" autoComplete="current-password" autoFocus required value={password} onChange={(event) => setPassword(event.target.value)} readOnly={busy} aria-invalid={!!error} aria-describedby={error ? 'login-error' : undefined} /></label>
    <button className="primary" type="submit" disabled={busy || !password}>{busy ? 'Aanmelden…' : 'Werkruimte openen'}</button>
    {error && <p className="notice notice-red" id="login-error" role="alert">{error}</p>}
  </form></section>;
}

'use client';
import { useLocale } from './LanguageProvider';
import { useEffect, useState, type ReactNode } from 'react';
export function ResourceView<T>({ load, children, loading = 'Gegevens laden…' }: { load: () => Promise<T>; children: (value: T) => ReactNode; loading?: string }) {
  const { t } = useLocale();
  const [state, setState] = useState<{ value?: T; error?: string }>({}); const [attempt, setAttempt] = useState(0);
  useEffect(() => { let alive = true; load().then((value) => { if (alive) setState({ value }); }).catch((error) => { if (alive) setState({ error: error instanceof Error ? error.message : 'Gegevens konden niet worden geladen.' }); }); return () => { alive = false; }; }, [load, attempt]);
  if (state.error) return <section className="card notice-red" role="alert"><h2>{t("Gegevens konden niet worden geladen.")}</h2><p>{t(state.error)}</p><button onClick={() => { setState({}); setAttempt((value) => value + 1); }}>{t("Opnieuw proberen")}</button></section>;
  if (state.value === undefined) return <p className="card" role="status" aria-live="polite">{t(loading)}</p>;
  return children(state.value);
}

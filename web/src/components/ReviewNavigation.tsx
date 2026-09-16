'use client';

import { usePathname, useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react';

interface ReviewRegistration {
  needsSave: () => boolean;
  flush: () => Promise<unknown>;
}

interface ReviewNavigation {
  register: (review: ReviewRegistration) => () => void;
  flush: () => Promise<void>;
  saving: boolean;
}

const ReviewNavigationContext = createContext<ReviewNavigation>({
  register: () => () => undefined,
  flush: async () => undefined,
  saving: false,
});

export const useReviewNavigation = () => useContext(ReviewNavigationContext);

// Session drafts cover browser Back and refresh, which cannot be blocked by a
// normal link handler. In-memory fallback still covers client navigation when
// browser storage is unavailable. Never store keys or generated model prompts.
export interface ReviewDraft { text: string; note: string; baseText: string; baseNote: string }
const drafts = new Map<string, ReviewDraft>();
const draftKey = (id: string) => `economie-assistent:review-draft:${id}`;

export function readReviewDraft(id: string): ReviewDraft | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(draftKey(id));
    if (raw) {
      const value: unknown = JSON.parse(raw);
      if (typeof value === 'object' && value !== null && ['text', 'note', 'baseText', 'baseNote'].every((key) => typeof (value as Record<string, unknown>)[key] === 'string')) return value as ReviewDraft;
    }
  } catch { /* The in-memory draft remains available. */ }
  return drafts.get(id) ?? null;
}

export function writeReviewDraft(id: string, draft: ReviewDraft | null) {
  if (draft) drafts.set(id, draft); else drafts.delete(id);
  try {
    if (draft) window.sessionStorage.setItem(draftKey(id), JSON.stringify(draft));
    else window.sessionStorage.removeItem(draftKey(id));
  } catch { /* Session storage may be unavailable in private browsing. */ }
}

export function ReviewNavigationProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const reviews = useRef(new Set<ReviewRegistration>());
  const savingPromise = useRef<Promise<void> | null>(null);
  const navigating = useRef(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { setError(''); }, [pathname]);

  const register = useCallback((review: ReviewRegistration) => {
    reviews.current.add(review);
    return () => { reviews.current.delete(review); };
  }, []);

  const flush = useCallback((): Promise<void> => {
    if (savingPromise.current) return savingPromise.current;
    const pending = [...reviews.current].filter((review) => review.needsSave());
    setError('');
    if (!pending.length) return Promise.resolve();
    setSaving(true);
    const operation = (async () => {
      for (const review of pending) await review.flush();
    })().catch((reason) => {
      setError(`Uw beoordeling kon niet worden opgeslagen. U blijft op deze pagina. ${reason instanceof Error ? reason.message : 'Probeer opnieuw.'}`);
      throw reason;
    }).finally(() => { savingPromise.current = null; setSaving(false); });
    savingPromise.current = operation;
    return operation;
  }, []);

  function capture(event: MouseEvent<HTMLDivElement>) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null;
    if (!(anchor instanceof HTMLAnchorElement) || anchor.hasAttribute('download') || (anchor.target && anchor.target !== '_self')) return;
    const destination = new URL(anchor.href, window.location.href);
    if (destination.origin !== window.location.origin || !['http:', 'https:'].includes(destination.protocol)) return;
    // In-page anchors (including the skip link) do not remove the editor.
    if (destination.pathname === window.location.pathname && destination.search === window.location.search && destination.hash) return;
    if (![...reviews.current].some((review) => review.needsSave()) && !savingPromise.current) return;
    event.preventDefault();
    event.stopPropagation();
    if (navigating.current) return;
    navigating.current = true;
    void flush().then(() => router.push(`${destination.pathname}${destination.search}${destination.hash}`)).catch(() => undefined).finally(() => { navigating.current = false; });
  }

  const value = useMemo(() => ({ register, flush, saving }), [register, flush, saving]);
  return <ReviewNavigationContext.Provider value={value}><div style={{ display: 'contents' }} onClickCapture={capture}>
    {error && <div className="notice notice-red review-navigation-error" role="alert"><p>{error}</p><button type="button" onClick={() => setError('')}>Melding sluiten</button></div>}
    <span className="sr-only" role="status" aria-live="polite">{saving ? 'Beoordeling opslaan voordat u verdergaat…' : ''}</span>
    {children}
  </div></ReviewNavigationContext.Provider>;
}

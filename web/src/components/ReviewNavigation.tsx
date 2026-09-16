'use client';

import { usePathname, useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react';

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
const drafts = new Map<string, ReviewDraft | null>();
const draftKey = (id: string) => `economie-assistent:review-draft:${id}`;

export function readReviewDraft(id: string): ReviewDraft | null {
  if (typeof window === 'undefined') return null;
  if (drafts.has(id)) return drafts.get(id) ?? null;
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
  drafts.set(id, draft);
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
  const navigationAttempt = useRef(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [activePathname, setActivePathname] = useState(pathname);
  // Reset this provider's status before rendering the new page, while keeping
  // its children and editor registrations mounted across route transitions.
  if (activePathname !== pathname) {
    setActivePathname(pathname);
    setSaving(false);
    setError('');
  }
  const invalidatePendingNavigation = useCallback(() => {
    navigationAttempt.current++;
    navigating.current = false;
    // The server request can finish, but no longer owns this page's navigation.
    savingPromise.current = null;
  }, []);
  const invalidateNavigation = useCallback(() => {
    invalidatePendingNavigation();
    setSaving(false);
    setError('');
  }, [invalidatePendingNavigation]);
  useLayoutEffect(() => { invalidatePendingNavigation(); }, [pathname, invalidatePendingNavigation]);
  useEffect(() => {
    window.addEventListener('popstate', invalidateNavigation);
    return () => {
      window.removeEventListener('popstate', invalidateNavigation);
      invalidatePendingNavigation();
    };
  }, [invalidateNavigation, invalidatePendingNavigation]);

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
    const operation: Promise<void> = (async () => {
      for (const review of pending) await review.flush();
    })().catch((reason) => {
      if (savingPromise.current === operation) setError(`Uw wijzigingen zijn niet afgehandeld. U blijft op deze pagina. ${reason instanceof Error ? reason.message : 'Probeer opnieuw.'}`);
      throw reason;
    }).finally(() => {
      if (savingPromise.current === operation) { savingPromise.current = null; setSaving(false); }
    });
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
    const attempt = ++navigationAttempt.current;
    const origin = window.location.href;
    void flush().then(() => {
      if (attempt === navigationAttempt.current && window.location.href === origin) router.push(`${destination.pathname}${destination.search}${destination.hash}`);
    }).catch(() => undefined).finally(() => {
      if (attempt === navigationAttempt.current) navigating.current = false;
    });
  }

  const value = useMemo(() => ({ register, flush, saving }), [register, flush, saving]);
  return <ReviewNavigationContext.Provider value={value}><div style={{ display: 'contents' }} onClickCapture={capture}>
    {error && <div className="notice notice-red review-navigation-error" role="alert"><p>{error}</p><button type="button" onClick={() => setError('')}>Melding sluiten</button></div>}
    <span className="sr-only" role="status" aria-live="polite">{saving ? 'Wijzigingen controleren voordat u verdergaat…' : ''}</span>
    {children}
  </div></ReviewNavigationContext.Provider>;
}

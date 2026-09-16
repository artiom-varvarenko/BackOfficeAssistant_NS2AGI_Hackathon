import { useSyncExternalStore } from 'react';

const NAVIGATE_EVENT = 'ea:navigate';
const subscribe = (listener: () => void) => {
  window.addEventListener('popstate', listener);
  window.addEventListener(NAVIGATE_EVENT, listener);
  window.addEventListener('hashchange', listener);
  return () => {
    window.removeEventListener('popstate', listener);
    window.removeEventListener(NAVIGATE_EVENT, listener);
    window.removeEventListener('hashchange', listener);
  };
};
const snapshot = () => `${window.location.pathname}${window.location.search}${window.location.hash}`;
export const useLocation = () => useSyncExternalStore(subscribe, snapshot, () => '/');
export const usePathname = () => useLocation().split(/[?#]/, 1)[0];
export const useSearchParams = () => new URLSearchParams(useLocation().split('?')[1]?.split('#')[0] ?? '');

function navigate(href: string, replace = false, scroll = true) {
  const target = new URL(href, window.location.href);
  if (target.origin !== window.location.origin || !['http:', 'https:'].includes(target.protocol)) {
    window.location.assign(target.href);
    return;
  }
  window.history[replace ? 'replaceState' : 'pushState'](null, '', `${target.pathname}${target.search}${target.hash}`);
  window.dispatchEvent(new Event(NAVIGATE_EVENT));
  if (scroll && !target.hash) window.scrollTo(0, 0);
}

const router = {
  push: (href: string, options?: { scroll?: boolean }) => navigate(href, false, options?.scroll !== false),
  replace: (href: string, options?: { scroll?: boolean }) => navigate(href, true, options?.scroll !== false),
  back: () => window.history.back(),
  forward: () => window.history.forward(),
  refresh: () => window.dispatchEvent(new Event('ea:refresh')),
  prefetch: () => undefined,
};

export const useRouter = () => router;

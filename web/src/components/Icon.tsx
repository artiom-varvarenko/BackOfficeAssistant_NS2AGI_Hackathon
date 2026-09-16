import type { SVGProps } from 'react';

export type IconName = 'civic' | 'question' | 'library' | 'history' | 'logbook' | 'settings' | 'shield' | 'lock' | 'chevron-right' | 'document' | 'plus' | 'link' | 'refresh' | 'check';

export function Icon({ name, size = 20, className = '', ...props }: SVGProps<SVGSVGElement> & { name: IconName; size?: number }) {
  const paths = {
    civic: <><path d="M12 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7M8 12h5m-5 4h8" /><path d="m18 2 1.2 3.8L23 7l-3.8 1.2L18 12l-1.2-3.8L13 7l3.8-1.2z" /></>,
    question: <><path d="M12 4H7a3 3 0 0 0-3 3v13l4-4h9a3 3 0 0 0 3-3v-1" /><path d="M17 3v6m-3-3h6M8 9h3m-3 3h7" /></>,
    library: <><path d="M4 5h5v15H4zM9 7h5v13H9z" /><path d="m15 5 4-1 4 15-4 1zM5 9h3m2 2h3" /></>,
    history: <><path d="M3 10a9 9 0 1 1 2 8M3 4v6h6" /><path d="M12 7v5l3 2" /></>,
    logbook: <><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M9 8h6m-6 4h6m-6 4h4M3 7h3m-3 5h3m-3 5h3" /></>,
    settings: <><path d="M4 7h5m4 0h7M4 17h9m4 0h3" /><circle cx="11" cy="7" r="2" /><circle cx="15" cy="17" r="2" /></>,
    shield: <><path d="m12 3 8 3v5c0 5-3 8-8 10-5-2-8-5-8-10V6z" /><path d="m8.5 11.5 2.5 2.5 4.5-5" /></>,
    lock: <><rect x="6" y="10" width="12" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2" /></>,
    'chevron-right': <path d="m9 5 7 7-7 7" />,
    document: <><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6" /><path d="M8 13h8m-8 4h5" /></>,
    plus: <path d="M12 5v14M5 12h14" />,
    link: <><path d="m9 15 6-6m-5-3 2-2a5 5 0 0 1 7 7l-2 2M7 11l-2 2a5 5 0 0 0 7 7l2-2" /></>,
    refresh: <><path d="M20 7a9 9 0 0 0-15-2L3 7m0-5v5h5M4 17a9 9 0 0 0 15 2l2-2m0 5v-5h-5" /></>,
    check: <path d="m5 12 4 4L19 6" />,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" className={`ui-icon ${className}`} {...props}>{paths[name]}</svg>;
}

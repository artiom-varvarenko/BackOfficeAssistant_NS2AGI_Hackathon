'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

const ToastContext = createContext<(message: string) => void>(() => undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = useCallback((text: string) => {
    if (timer.current) clearTimeout(timer.current);
    setMessage(text);
    timer.current = setTimeout(() => setMessage(''), 5000);
  }, []);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  return <ToastContext.Provider value={show}>{children}<div className={`toast-region${message ? ' visible' : ''}`} role="status" aria-live="polite" aria-atomic="true">{message && <><span>{message}</span><button type="button" aria-label="Melding sluiten" onClick={() => setMessage('')}>×</button></>}</div></ToastContext.Provider>;
}

export const useToast = () => useContext(ToastContext);

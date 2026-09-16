'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { ApiClientError } from '@/lib/api-client';

export function ReadAloudButton({ loadAudio, revision, disabled = false }: { loadAudio: () => Promise<Blob>; revision: string; disabled?: boolean }) {
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [needsSettings, setNeedsSettings] = useState(false);
  const audio = useRef<HTMLAudioElement>(null);
  const currentUrl = useRef<string | null>(null);
  const request = useRef(0);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      request.current += 1;
      if (currentUrl.current) URL.revokeObjectURL(currentUrl.current);
    };
  }, []);

  useEffect(() => {
    request.current += 1;
    audio.current?.pause();
    if (currentUrl.current) URL.revokeObjectURL(currentUrl.current);
    currentUrl.current = null;
    setUrl(null);
    setBusy(false);
    setError('');
    setNeedsSettings(false);
  }, [revision]);

  async function read() {
    const id = ++request.current;
    setBusy(true);
    setError('');
    setNeedsSettings(false);
    audio.current?.pause();
    try {
      const blob = await loadAudio();
      if (!mounted.current || id !== request.current) return;
      if (!blob.size) throw new Error('Er is geen audio ontvangen. Probeer opnieuw.');
      if (currentUrl.current) URL.revokeObjectURL(currentUrl.current);
      const nextUrl = URL.createObjectURL(blob);
      currentUrl.current = nextUrl;
      setUrl(nextUrl);
    } catch (reason) {
      if (!mounted.current || id !== request.current) return;
      setError(reason instanceof Error ? reason.message : 'Voorlezen is niet gelukt.');
      setNeedsSettings(reason instanceof ApiClientError && ['no_tts_configured', 'no_model_configured'].includes(reason.code));
    } finally {
      if (mounted.current && id === request.current) setBusy(false);
    }
  }

  return <div className="read-aloud">
    <button type="button" disabled={disabled || busy} onClick={() => void read()}>{busy ? 'Audio maken…' : 'Lees voor'}</button>
    {busy && <span className="sr-only" role="status">Audio van de tekst voor communicatie wordt gemaakt.</span>}
    {url && <div><audio ref={audio} controls autoPlay src={url} aria-label="Voorgelezen tekst voor communicatie" onError={() => setError('De browser kan deze audio niet afspelen. Probeer opnieuw.')} /><p className="muted">De eerste 2.500 tekens worden voorgelezen, zonder bronverwijzingsnummers.</p></div>}
    {error && <p className="notice notice-red" role="alert">{error}{needsSettings && <> <Link href="/instellingen">Ga naar Instellingen</Link> om voorlezen in te stellen.</>}</p>}
  </div>;
}

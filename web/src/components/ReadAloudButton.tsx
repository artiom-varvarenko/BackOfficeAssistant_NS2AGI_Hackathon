'use client';

import { useLocale } from './LanguageProvider';
import Link from 'next/link';
import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { ApiClientError } from '@/lib/api-client';

function releaseMedia(element: HTMLAudioElement | null) {
  if (!element?.hasAttribute('src')) return;
  element.pause();
  element.removeAttribute('src');
  element.load();
}

export function ReadAloudButton({ loadAudio, revision, disabled = false }: { loadAudio: () => Promise<Blob>; revision: string; disabled?: boolean }) {
  return <PlaybackButton key={revision} loadAudio={loadAudio} disabled={disabled} />;
}

function PlaybackButton({ loadAudio, disabled }: { loadAudio: () => Promise<Blob>; disabled: boolean }) {
  const { t } = useLocale();
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [needsSettings, setNeedsSettings] = useState(false);
  const audio = useRef<HTMLAudioElement>(null);
  const currentUrl = useRef<string | null>(null);
  const request = useRef(0);
  const mounted = useRef(false);

  const releaseAudio = useCallback(() => {
    const previousUrl = currentUrl.current;
    currentUrl.current = null;
    releaseMedia(audio.current);
    if (previousUrl) URL.revokeObjectURL(previousUrl);
  }, []);

  const setAudioElement = useCallback((element: HTMLAudioElement | null) => {
    if (audio.current !== element) releaseMedia(audio.current);
    audio.current = element;
    if (!element) return;
    if (url !== null && currentUrl.current === url) {
      // Ref replay can reattach the same element after its source was released.
      if (element.getAttribute('src') !== url) element.src = url;
    } else {
      releaseMedia(element);
    }
  }, [url]);

  // A revision remounts only playback. Invalidate during commit so an old
  // request cannot start playing after the officer changes the text.
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      request.current += 1;
      releaseAudio();
    };
  }, [releaseAudio]);

  async function read() {
    const id = ++request.current;
    releaseAudio();
    setUrl(null);
    setBusy(true);
    setError('');
    setNeedsSettings(false);
    try {
      const blob = await loadAudio();
      if (!mounted.current || id !== request.current) return;
      if (!blob.size) throw new Error('Er is geen audio ontvangen. Probeer opnieuw.');
      const nextUrl = URL.createObjectURL(blob);
      currentUrl.current = nextUrl;
      setUrl(nextUrl);
    } catch (reason) {
      if (!mounted.current || id !== request.current) return;
      releaseAudio();
      setUrl(null);
      setError(reason instanceof Error ? reason.message : 'Voorlezen is niet gelukt.');
      setNeedsSettings(reason instanceof ApiClientError && ['no_tts_configured', 'no_model_configured'].includes(reason.code));
    } finally {
      if (mounted.current && id === request.current) setBusy(false);
    }
  }

  return <div className="read-aloud">
    <button type="button" disabled={disabled || busy} onClick={() => void read()}>{busy ? t("Audio maken…") : t("Lees voor")}</button>
    {busy && <span className="sr-only" role="status">{t("Audio van de tekst voor communicatie wordt gemaakt.")}</span>}
    {url && <div><audio key={url} ref={setAudioElement} controls autoPlay src={url} aria-label={t("Voorgelezen tekst voor communicatie")} onError={(event) => {
      if (!mounted.current || event.currentTarget !== audio.current || currentUrl.current !== url) return;
      releaseAudio();
      setUrl(null);
      setNeedsSettings(false);
      setError(t("De browser kan deze audio niet afspelen. Probeer opnieuw."));
    }} /><p className="muted">{t("De eerste 2.500 tekens worden voorgelezen, zonder bronverwijzingsnummers.")}</p></div>}
    {error && <p className="notice notice-red" role="alert">{t(error)}{needsSettings && <> <Link href="/instellingen">{t("Ga naar Instellingen")}</Link>{' '}{t("om voorlezen in te stellen.")}</>}</p>}
  </div>;
}

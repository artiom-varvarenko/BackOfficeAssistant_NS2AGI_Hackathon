import OpenAI from 'openai';
import { ApiError } from './api';
import { getDb } from './db';
import { safeModelErrorMessage } from './model-errors';
import { getTtsConfig, resolveKey } from './settings';

const MAX_TEXT_CHARACTERS = 2500;
const PROVIDER_TIMEOUT_MS = 30000;
const MAX_AUDIO_BYTES = 16 * 1024 * 1024;
type SpeechProvider = 'elevenlabs' | 'openai';

interface AnswerText {
  generated_answer: string;
  reviewed_answer: string | null;
}

function notConfigured(): ApiError {
  return new ApiError(409, 'no_tts_configured', 'Voorlezen is niet ingesteld. Kies onder Instellingen een spraakaanbieder en stel de sleutel en eventueel de stem-ID in.');
}

async function readAudio(response: Response): Promise<ArrayBuffer> {
  const contentType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
  if (!response.ok || !response.body || (contentType && !['audio/mpeg', 'audio/mp3', 'application/octet-stream'].includes(contentType))) {
    void response.body?.cancel().catch(() => undefined);
    throw new Error('Geen bruikbare audio ontvangen.');
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_AUDIO_BYTES) throw new Error('Het audiobestand is te groot.');
      chunks.push(value);
    }
    if (total === 0) throw new Error('Geen audio ontvangen.');
    const bytes = new ArrayBuffer(total);
    const output = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) {
      output.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes;
  } catch (error) {
    void reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
}

async function requestSpeech(
  provider: SpeechProvider,
  credential: string,
  request: (signal: AbortSignal) => Promise<Response>,
): Promise<Response> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error('De spraakaanvraag duurde te lang.'));
    }, PROVIDER_TIMEOUT_MS);
  });
  try {
    // The SDK timeout ends when headers arrive. Keep our deadline active until
    // the complete body has been checked, including an error response body.
    const audio = await Promise.race([
      (async () => readAudio(await request(controller.signal)))(),
      deadline,
    ]);
    return new Response(audio, {
      headers: { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store', 'X-TTS-Provider': provider },
    });
  } catch {
    const label = provider === 'openai' ? 'OpenAI' : 'ElevenLabs';
    // SDK messages may contain the provider's response body. Only our Dutch
    // description crosses the API boundary, using the captured credential.
    const message = controller.signal.aborted
      ? `Voorlezen via ${label} duurde te lang. Probeer opnieuw.`
      : `Voorlezen via ${label} is mislukt. Controleer de sleutel en stem onder Instellingen en probeer opnieuw.`;
    throw new ApiError(502, 'tts_failed', safeModelErrorMessage(message, [credential]));
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

function openAiSpeech(text: string, key: string, voice: string): Promise<Response> {
  return requestSpeech('openai', key, async (signal) => {
    // Leaving baseURL unset preserves the SDK's OPENAI_BASE_URL support.
    // Disable SDK logging even if OPENAI_LOG requests headers/body diagnostics.
    const client = new OpenAI({ apiKey: key, timeout: PROVIDER_TIMEOUT_MS, maxRetries: 0, logLevel: 'off', fetchOptions: { redirect: 'error' } });
    return client.audio.speech.create(
      { model: 'gpt-4o-mini-tts', voice, input: text, response_format: 'mp3' },
      { signal },
    );
  });
}

export async function synthesizeAnswer(answerId: string): Promise<Response> {
  const answer = getDb().prepare('SELECT generated_answer, reviewed_answer FROM answers WHERE id = ?').get(answerId) as AnswerText | undefined;
  if (!answer) throw new ApiError(404, 'not_found', 'Antwoord niet gevonden.');

  // Snapshot both credentials before the first await. The fallback never uses
  // an ElevenLabs key or voice, including during a concurrent settings change.
  const config = getTtsConfig();
  const resolvedOpenAiKey = resolveKey('openai')?.key;
  const openAiKey = resolvedOpenAiKey?.trim() ? resolvedOpenAiKey : null;
  if (config.provider === 'none') throw notConfigured();

  const text = (answer.reviewed_answer ?? answer.generated_answer)
    .replace(/\[\s*\d+(?:\s*,\s*\d+)*\s*\]/g, '')
    .trim()
    .slice(0, MAX_TEXT_CHARACTERS);
  if (!text.trim()) throw new ApiError(422, 'empty_answer', 'Dit antwoord bevat geen tekst om voor te lezen.');

  if (config.provider === 'openai') {
    const key = config.key ?? openAiKey;
    if (key === null) throw notConfigured();
    return openAiSpeech(text, key, config.voiceId?.trim() || 'alloy');
  }

  const voice = config.voiceId?.trim();
  if (config.key && voice) {
    const key = config.key;
    try {
      return await requestSpeech('elevenlabs', key, (signal) => fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}`,
        {
          method: 'POST',
          headers: { 'xi-api-key': key, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
          body: JSON.stringify({ text, model_id: 'eleven_multilingual_v2' }),
          signal,
          redirect: 'error',
          cache: 'no-store',
        },
      ));
    } catch (error) {
      if (openAiKey === null) throw error;
    }
  }
  if (openAiKey === null) throw notConfigured();
  return openAiSpeech(text, openAiKey, 'alloy');
}

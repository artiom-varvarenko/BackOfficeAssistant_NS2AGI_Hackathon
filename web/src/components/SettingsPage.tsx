'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { embedSource, getAnswers, getSettings, getSources, readAnswerAloud, testSettings, updateSettings, type SettingsPatch } from '@/lib/api-client';
import type { LlmTask, ProviderId, Settings, TaskModel } from '@/lib/types';
import { Badge } from './Badge';
import { ProviderKeyRow } from './ProviderKeyRow';
import { ResourceView } from './ResourceView';
import { useReviewNavigation } from './ReviewNavigation';
import { TaskModelRow, type ModelTestResult } from './TaskModelRow';
import { useToast } from './Toast';

type RunOperation = <T,>(operation: () => Promise<T>) => Promise<T>;
type SaveSettings = (patch: SettingsPatch) => Promise<Settings>;

export function SettingsPage({ retrievalBudget }: { retrievalBudget: number }) {
  return <>
    <div className="page-heading"><div><h1>Instellingen</h1><p>Kies de modellen, sleutels en zoekmethode van de werkruimte.</p></div></div>
    <ResourceView load={getSettings} loading="Instellingen laden…">{(settings) => <SettingsEditor initialSettings={settings} retrievalBudget={retrievalBudget} />}</ResourceView>
  </>;
}

function SettingsEditor({ initialSettings, retrievalBudget }: { initialSettings: Settings; retrievalBudget: number }) {
  const [settings, setSettings] = useState(initialSettings);
  const [busy, setBusy] = useState(false);
  const [pendingProviders, setPendingProviders] = useState<Partial<Record<ProviderId, boolean>>>({});
  const [pendingTts, setPendingTts] = useState(false);
  const locked = useRef(false);
  const toast = useToast();
  const navigation = useReviewNavigation();
  const pendingCredentials = Object.values(pendingProviders).some(Boolean) || pendingTts;
  const navigationState = useRef({ pendingCredentials, busy });
  navigationState.current = { pendingCredentials, busy };
  const providerChanged = useCallback((provider: ProviderId, dirty: boolean) => {
    setPendingProviders((previous) => previous[provider] === dirty ? previous : { ...previous, [provider]: dirty });
  }, []);

  useEffect(() => navigation.register({
    needsSave: () => navigationState.current.pendingCredentials || navigationState.current.busy,
    flush: async () => {
      if (locked.current) throw new Error('Wacht tot de huidige instellingenbewerking voltooid is.');
      if (navigationState.current.pendingCredentials && !window.confirm('Er zijn niet-opgeslagen sleutels, verbindingsgegevens of spraakinstellingen. Deze invoer wordt niet hersteld. Wilt u de wijzigingen weggooien en deze pagina verlaten?')) {
        throw new Error('Uw invoer is behouden. Sla de instellingen op of bevestig bij het verlaten dat u de wijzigingen wilt weggooien.');
      }
    },
  }), [navigation.register]);

  useEffect(() => {
    if (!pendingCredentials && !busy) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [pendingCredentials, busy]);

  const run: RunOperation = async (operation) => {
    if (locked.current) throw new Error('Wacht tot de huidige bewerking voltooid is.');
    locked.current = true;
    setBusy(true);
    try { return await operation(); }
    finally { locked.current = false; setBusy(false); }
  };

  async function persist(patch: SettingsPatch) {
    const next = await updateSettings(patch);
    setSettings(next);
    window.dispatchEvent(new Event('settings-updated'));
    toast('Instellingen opgeslagen.');
    return next;
  }

  const save: SaveSettings = (patch) => run(() => persist(patch));
  const saveTask = async (task: LlmTask, model: TaskModel) => { await save({ tasks: { [task]: model } }); };
  const testTask = (task: LlmTask, model: TaskModel, saveFirst: boolean): Promise<ModelTestResult> => run(async () => {
    if (pendingProviders[model.provider]) throw new Error('Sla eerst de sleutel en verbindingsgegevens van deze aanbieder op.');
    if (saveFirst) await persist({ tasks: { [task]: model } });
    return testSettings(task);
  });

  return <>
    <section className="card"><h2>Taalmodel per taak</h2>
      <p className="muted">Elke taak gebruikt een eigen model. Een test gebruikt de opgeslagen sleutel en kan kosten bij de aanbieder veroorzaken. Sla nieuwe sleutels hieronder eerst op.</p>
      {(['answer', 'draft', 'summary'] as const).map((task) => <TaskModelRow key={task} task={task} saved={settings.tasks[task]} providers={settings.providers} pendingProviders={pendingProviders} busy={busy} onSave={saveTask} onTest={testTask} />)}
    </section>
    <section className="card"><h2>API-sleutels per aanbieder</h2>
      <p className="muted">Sleutels worden alleen op de server bewaard. Opgeslagen sleutels worden uitsluitend gemaskeerd naar de browser teruggestuurd. Verwijderen wist de opgeslagen sleutel; een sleutel uit de omgeving blijft beschikbaar.</p>
      <p className="muted">Dit prototype bewaart ingevoerde sleutels onversleuteld in de lokale database.</p>
      <p className="muted">Sla nieuwe sleutels en verbindingsgegevens op voordat u verdergaat. Niet-opgeslagen invoer wordt niet in de browser bewaard en kan na Vorige of Vernieuwen niet worden hersteld.</p>
      {settings.providers.map((provider) => <ProviderKeyRow key={provider.id} provider={provider} busy={busy} onSave={save} onDirtyChange={providerChanged} />)}
    </section>
    <TtsSettings settings={settings.tts} busy={busy} openaiPending={Boolean(pendingProviders.openai)} save={save} run={run} persist={persist} onDirtyChange={setPendingTts} />
    <RetrievalSettings settings={settings.retrieval} busy={busy} openaiPending={Boolean(pendingProviders.openai)} save={save} run={run} />
    <section className="card"><h2>Werkruimte</h2>
      <dl className="metadata-list"><dt>Gemeente</dt><dd>{settings.municipality}</dd><dt>Zoekbudget</dt><dd>{new Intl.NumberFormat('nl-BE').format(retrievalBudget)} tekens aan bronpassages per vraag</dd><dt>Geteste configuratie</dt><dd>{settings.testedConfiguration}</dd></dl>
      <p className="muted">De gemeente en het zoekbudget worden door de beheerder ingesteld.</p>
      <div className="source-links"><a href="/api/settings" target="_blank" rel="noreferrer">Instellingen als JSON</a><a href="/api/sources" target="_blank" rel="noreferrer">Bronnen als JSON</a><a href="/api/answers" target="_blank" rel="noreferrer">Antwoorden als JSON</a></div>
    </section>
  </>;
}

function TtsSettings({ settings, busy, openaiPending, save, run, persist, onDirtyChange }: {
  settings: Settings['tts']; busy: boolean; openaiPending: boolean; save: SaveSettings; run: RunOperation; persist: SaveSettings; onDirtyChange: (dirty: boolean) => void;
}) {
  const [provider, setProvider] = useState(settings.provider);
  const [voice, setVoice] = useState(settings.voiceId ?? '');
  const [key, setKey] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [sampleQuestion, setSampleQuestion] = useState('');
  const [testing, setTesting] = useState(false);
  const [missingAnswer, setMissingAnswer] = useState(false);
  const audio = useRef<HTMLAudioElement>(null);
  const mounted = useRef(true);
  const dirty = provider !== settings.provider || voice.trim() !== (settings.voiceId ?? '') || key.trim().length > 0;
  const patch: SettingsPatch = { tts: { provider, voiceId: voice.trim() || null, ...(key.trim() ? { key: key.trim() } : provider !== settings.provider ? { key: null } : {}) } };

  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => () => { if (audioUrl) URL.revokeObjectURL(audioUrl); }, [audioUrl]);
  useEffect(() => { if (audioUrl) void audio.current?.play().catch(() => undefined); }, [audioUrl]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  function changed() { setMessage(''); setError(''); setAudioUrl(null); setMissingAnswer(false); }

  async function store(remove: boolean) {
    setMessage(''); setError('');
    try {
      const updated = await save(remove ? { tts: { key: null } } : patch);
      if (!remove) { setProvider(updated.tts.provider); setVoice(updated.tts.voiceId ?? ''); }
      setKey('');
      setAudioUrl(null);
      setMessage(remove ? 'Eventuele eigen spraaksleutel gewist. Een sleutel uit de omgeving of van OpenAI blijft beschikbaar.' : 'Instellingen voor voorlezen opgeslagen.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Opslaan is mislukt.'); }
  }

  async function test() {
    setMessage(''); setError(''); setMissingAnswer(false); setTesting(true); setAudioUrl(null);
    try {
      await run(async () => {
        if (provider === 'openai' && openaiPending) throw new Error('Sla eerst uw nieuwe OpenAI-sleutel op om het voorlezen te proberen.');
        if (dirty) {
          const updated = await persist(patch);
          setProvider(updated.tts.provider);
          setVoice(updated.tts.voiceId ?? '');
          setKey('');
        }
        const answers = await getAnswers();
        const latest = answers.filter((answer) => answer.status === 'approved').sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
        if (!mounted.current) return;
        if (!latest) { setMissingAnswer(true); return; }
        const blob = await readAnswerAloud(latest.id);
        if (!mounted.current) return;
        setAudioUrl(URL.createObjectURL(blob));
        setSampleQuestion(latest.question);
        setMessage('Het goedgekeurde antwoord staat klaar om te beluisteren.');
      });
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Proefbeluisteren is mislukt. Controleer de spraakaanbieder, sleutel en stem-ID en probeer opnieuw.'); }
    finally { setTesting(false); }
  }

  return <section className="card"><div className="section-heading"><h2>Voorlezen (optioneel)</h2><Badge tone={settings.hasKey ? 'green' : 'neutral'}>{settings.hasKey ? 'Sleutel ingesteld' : 'Geen spraaksleutel ingesteld'}</Badge></div>
    <div className="settings-grid">
      <label className="field">Aanbieder<select value={provider} disabled={busy} onChange={(event) => { setProvider(event.target.value as Settings['tts']['provider']); setVoice(''); setKey(''); changed(); }}><option value="none">Uit</option><option value="elevenlabs">ElevenLabs</option><option value="openai">OpenAI</option></select></label>
      <label className="field">Stem-ID<input value={voice} disabled={busy || provider === 'none'} autoCapitalize="none" spellCheck={false} placeholder={provider === 'openai' ? 'alloy' : 'Stem-ID van ElevenLabs'} onChange={(event) => { setVoice(event.target.value); changed(); }} /></label>
      <label className="field">Nieuwe spraaksleutel<input type="password" value={key} disabled={busy || provider === 'none'} autoComplete="new-password" autoCapitalize="none" spellCheck={false} placeholder="Leeg laten om de bestaande sleutel te behouden" onChange={(event) => { setKey(event.target.value); changed(); }} /></label>
    </div>
    <p className="muted">OpenAI kan de opgeslagen OpenAI-sleutel gebruiken. Een aparte spraaksleutel heeft voorrang. Bij OpenAI is de standaardstem alloy; bij ElevenLabs vult u een stem-ID in.</p>
    <p className="muted">Proefbeluisteren leest het meest recente goedgekeurde antwoord voor en kan kosten veroorzaken. De audiotekst wordt naar de gekozen spraakaanbieder gestuurd.</p>
    <div className="actions"><button type="button" disabled={busy || !dirty} onClick={() => void store(false)}>Opslaan</button><button type="button" className="danger-button" disabled={busy || !settings.hasKey} onClick={() => void store(true)}>Eigen spraaksleutel wissen</button><button type="button" disabled={busy || provider === 'none' || (provider === 'elevenlabs' && !voice.trim()) || (provider === 'openai' && openaiPending)} onClick={() => void test()}>{testing ? 'Audio voorbereiden…' : dirty ? 'Opslaan en proefbeluisteren' : 'Proefbeluisteren'}</button></div>
    {provider === 'openai' && openaiPending && <p className="muted">Sla eerst uw nieuwe OpenAI-sleutel op om het voorlezen te proberen.</p>}
    {missingAnswer && <p className="notice notice-amber">Er is nog geen goedgekeurd antwoord om te beluisteren. Keur eerst een antwoord goed. <Link href="/geschiedenis">Open de geschiedenis</Link>.</p>}
    {audioUrl && <div><p>Goedgekeurd antwoord op: {sampleQuestion}</p><audio ref={audio} controls src={audioUrl} aria-label="Voorlezen van het goedgekeurde antwoord" /></div>}
    <p className="save-status" role="status" aria-live="polite">{message}</p>
    {error && <p className="notice notice-red" role="alert">{error}</p>}
  </section>;
}

function RetrievalSettings({ settings, busy, openaiPending, save, run }: {
  settings: Settings['retrieval']; busy: boolean; openaiPending: boolean; save: SaveSettings; run: RunOperation;
}) {
  const [mode, setMode] = useState(settings.mode);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [failures, setFailures] = useState<string[]>([]);
  const [embedding, setEmbedding] = useState(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  async function store() {
    setMessage(''); setError('');
    try { await save({ retrieval: { mode } }); setMessage('Zoekmethode opgeslagen.'); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'De zoekmethode kon niet worden opgeslagen.'); }
  }

  async function embed() {
    setMessage(''); setError(''); setFailures([]); setEmbedding(true);
    try {
      await run(async () => {
        if (openaiPending) throw new Error('Sla eerst uw nieuwe OpenAI-sleutel op om embeddings te berekenen.');
        const sources = (await getSources()).filter((source) => source.currentVersion?.processingStatus === 'ready');
        if (!sources.length) { setMessage('Er zijn nog geen verwerkte bronnen. Voeg eerst een PDF toe bij Bronnen.'); return; }
        let embedded = 0;
        let successful = 0;
        const failed: string[] = [];
        for (let index = 0; index < sources.length; index++) {
          if (!mounted.current) return;
          const source = sources[index];
          setMessage(`Embeddings berekenen: ${index + 1}/${sources.length} · ${source.title}`);
          try { const result = await embedSource(source.id); embedded += result.embedded; successful++; }
          catch (cause) { failed.push(`${source.title}: ${cause instanceof Error ? cause.message : 'Berekenen mislukt.'}`); }
        }
        setFailures(failed);
        setMessage(`${successful}/${sources.length} bronnen verwerkt · ${embedded} embeddings berekend.${failed.length ? ' Probeer de mislukte bronnen opnieuw via hun bronpagina.' : ''}`);
      });
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Embeddings konden niet worden berekend.'); }
    finally { setEmbedding(false); }
  }

  return <section className="card"><h2>Zoeken</h2>
    <fieldset className="settings-row" disabled={busy}><legend className="sr-only">Zoekmethode</legend>
      <label className="checkbox-label"><input type="radio" name="retrieval-mode" value="bm25" checked={mode === 'bm25'} onChange={() => { setMode('bm25'); setMessage(''); setError(''); }} />Alleen tekstzoeken (BM25)</label>
      <label className="checkbox-label"><input type="radio" name="retrieval-mode" value="hybrid" checked={mode === 'hybrid'} disabled={!settings.embeddingsAvailable} onChange={() => { setMode('hybrid'); setMessage(''); setError(''); }} />Hybride (BM25 + embeddings)</label>
    </fieldset>
    {!settings.embeddingsAvailable && <p className="muted">Vereist een OpenAI-sleutel voor embeddings.</p>}
    <p className="muted">Hybride zoeken combineert zoekwoorden met betekenis. Bereken eerst de embeddings van uw bronnen. Beide methoden gebruiken alleen ingeschakelde, verwerkte bronnen.</p>
    <div className="actions"><button type="button" disabled={busy || mode === settings.mode || (mode === 'hybrid' && !settings.embeddingsAvailable)} onClick={() => void store()}>Zoekmethode opslaan</button><button type="button" disabled={busy || !settings.embeddingsAvailable || openaiPending} onClick={() => void embed()}>{embedding ? 'Embeddings berekenen…' : 'Embeddings berekenen voor alle bronnen'}</button></div>
    {openaiPending && <p className="muted">Sla eerst uw nieuwe OpenAI-sleutel op om embeddings te berekenen.</p>}
    <p className="muted">De berekening verwerkt de huidige versie van elke verwerkte bron en kan kosten bij OpenAI veroorzaken. Ook uitgeschakelde bronnen worden voorbereid voor later gebruik.</p>
    <p className="save-status" role="status" aria-live="polite">{message}</p>
    {error && <p className="notice notice-red" role="alert">{error}</p>}
    {failures.length > 0 && <div className="notice notice-red" role="alert"><p>Niet alle bronnen konden worden verwerkt:</p><ul>{failures.map((failure, index) => <li key={index}>{failure}</li>)}</ul></div>}
  </section>;
}

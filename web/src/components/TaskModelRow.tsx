'use client';

import { useState } from 'react';
import type { Effort, LlmTask, ProviderId, ProviderInfo, TaskModel } from '@/lib/types';
import { ModelBadge } from './ModelBadge';

export type ModelTestResult = { ok: boolean; latencyMs: number; provider: ProviderId; model: string; error?: string };
const taskLabels: Record<LlmTask, string> = { answer: 'Antwoord', draft: 'E-mailconcept', summary: 'Samenvatting' };
const effortLabels: Record<Effort, string> = { none: 'Geen', low: 'Laag', medium: 'Gemiddeld', high: 'Hoog' };

function allowedEfforts(model: string): Effort[] {
  return /^gpt-6(?:-|$)/i.test(model.trim()) ? ['low', 'medium'] : ['none', 'low', 'medium', 'high'];
}

export function TaskModelRow({ task, saved, providers, pendingProviders, busy, onSave, onTest }: {
  task: LlmTask;
  saved: TaskModel;
  providers: ProviderInfo[];
  pendingProviders: Partial<Record<ProviderId, boolean>>;
  busy: boolean;
  onSave: (task: LlmTask, model: TaskModel) => Promise<void>;
  onTest: (task: LlmTask, model: TaskModel, saveFirst: boolean) => Promise<ModelTestResult>;
}) {
  const [value, setValue] = useState(saved);
  const [customModel, setCustomModel] = useState(!providers.find((provider) => provider.id === saved.provider)?.models.includes(saved.model));
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [testing, setTesting] = useState(false);
  const provider = providers.find((item) => item.id === value.provider);
  const gpt6 = /^gpt-6(?:-|$)/i.test(value.model.trim());
  const effort = gpt6 && value.effort !== 'low' && value.effort !== 'medium' ? 'low' : value.effort;
  const normalized: TaskModel = { ...value, model: value.model.trim(), effort: provider?.supportsEffort ? effort : null };
  const dirty = normalized.provider !== saved.provider || normalized.model !== saved.model || normalized.effort !== saved.effort;
  const valid = normalized.model.length > 0;

  function change(next: TaskModel) {
    const supportsEffort = providers.find((item) => item.id === next.provider)?.supportsEffort;
    const efforts = allowedEfforts(next.model);
    if (!supportsEffort) next.effort = null;
    else if ((next.effort && !efforts.includes(next.effort)) || (efforts.length === 2 && !next.effort)) next.effort = 'low';
    setValue(next);
    setMessage('');
    setError('');
  }

  async function act(test: boolean) {
    setMessage('');
    setError('');
    setTesting(test);
    try {
      if (test) {
        const result = await onTest(task, normalized, dirty);
        if (!result.ok) setError(result.error || 'De verbindingstest is mislukt. Controleer het model en de opgeslagen sleutel.');
        else setMessage(`OK · ${new Intl.NumberFormat('nl-BE', { maximumFractionDigits: 1 }).format(result.latencyMs / 1000)} s · ${result.provider}/${result.model}`);
      } else {
        await onSave(task, normalized);
        setMessage('Modelinstellingen opgeslagen.');
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Modelinstellingen konden niet worden verwerkt.');
    } finally { setTesting(false); }
  }

  return <div className="settings-row">
    <div className="section-heading"><h3>{taskLabels[task]}</h3><ModelBadge model={saved} /></div>
    <div className="settings-grid">
      <label className="field">Aanbieder
        <select value={value.provider} disabled={busy} onChange={(event) => {
          const next = providers.find((item) => item.id === event.target.value);
          if (!next) return;
          setCustomModel(next.models.length === 0);
          change({ provider: next.id, model: next.models[0] ?? '', effort: next.supportsEffort ? 'low' : null });
        }}>{providers.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select>
      </label>
      <label className="field">{value.provider === 'azure' ? 'Model / implementatienaam' : 'Model'}
        <select value={customModel ? '__custom__' : value.model} disabled={busy} onChange={(event) => {
          const custom = event.target.value === '__custom__';
          setCustomModel(custom);
          change({ ...value, model: custom ? '' : event.target.value });
        }}>
          {provider?.models.map((model) => <option key={model} value={model}>{model}</option>)}
          <option value="__custom__">Ander model-ID…</option>
        </select>
      </label>
      {customModel && <label className="field">{value.provider === 'azure' ? 'Azure-implementatienaam' : 'Model-ID'}
        <input value={value.model} disabled={busy} autoCapitalize="none" spellCheck={false} onChange={(event) => change({ ...value, model: event.target.value })} placeholder={value.provider === 'azure' ? 'Naam van uw modelimplementatie' : 'Volledige model-ID'} />
      </label>}
      {provider?.supportsEffort && <label className="field">Redeneerinspanning
        <select value={normalized.effort ?? ''} disabled={busy} onChange={(event) => change({ ...value, effort: event.target.value ? event.target.value as Effort : null })}>
          {!gpt6 && <option value="">Standaard van aanbieder</option>}
          {allowedEfforts(value.model).map((effort) => <option key={effort} value={effort}>{effortLabels[effort]}</option>)}
        </select>
      </label>}
    </div>
    {task === 'answer' && <p className="muted">Getest met OpenAI gpt-6-astra. Andere aanbieders worden ondersteund maar zijn niet afgestemd.</p>}
    {/^gpt-6(?:-|$)/i.test(value.model.trim()) && <p className="muted">Voor GPT-6 kiest u laag of gemiddeld om kosten en wachttijd te beperken.</p>}
    {value.provider === 'azure' && <p className="muted">{provider?.baseUrl ? 'Gebruik uw Azure-implementatienaam als model en controleer de verbinding met Test.' : 'Azure: niet getest. Vul hieronder eerst de resourcenaam in.'}</p>}
    <div className="actions">
      <button type="button" disabled={busy || !dirty || !valid} onClick={() => void act(false)}>Opslaan</button>
      <button type="button" disabled={busy || !valid || pendingProviders[value.provider]} onClick={() => void act(true)}>{testing ? 'Testen…' : dirty ? 'Opslaan en testen' : 'Test'}</button>
      {dirty && <span className="muted">Niet-opgeslagen wijzigingen</span>}
    </div>
    {pendingProviders[value.provider] && <p className="muted">Sla eerst de nieuwe sleutel en verbindingsgegevens van deze aanbieder op om te testen.</p>}
    <p className="save-status" role="status" aria-live="polite">{message}</p>
    {error && <p className="notice notice-red" role="alert">{error}</p>}
  </div>;
}

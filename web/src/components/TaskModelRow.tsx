'use client';

import { useLocale } from './LanguageProvider';
import { useState } from 'react';
import type { Effort, LlmTask, ProviderId, ProviderInfo, TaskModel } from '@/lib/types';
import { ModelBadge } from './ModelBadge';

export type ModelTestResult = { ok: boolean; latencyMs: number; provider: ProviderId; model: string; error?: string };
const taskLabels: Record<LlmTask, string> = { answer: 'Antwoord', draft: 'E-mailconcept', summary: 'Samenvatting' };
const effortLabels: Record<Effort, string> = { none: 'Geen', low: 'Laag', medium: 'Gemiddeld', high: 'Hoog', xhigh: 'Extra hoog' };

function allowedEfforts(model: string): Effort[] {
  return /^gpt-6(?:-|$)/i.test(model.trim()) ? ['low', 'medium'] : ['none', 'low', 'medium', 'high', 'xhigh'];
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
  const { t, locale } = useLocale();
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
  const unsupportedAstra = normalized.model.toLowerCase() === 'gpt-6-astra' && !provider?.supportsEffort;
  const valid = normalized.model.length > 0 && !unsupportedAstra;

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
        else setMessage(`OK · ${new Intl.NumberFormat(locale === 'en' ? 'en-GB' : 'nl-BE', { maximumFractionDigits: 1 }).format(result.latencyMs / 1000)} s · ${result.provider}/${result.model}`);
      } else {
        await onSave(task, normalized);
        setMessage('Modelinstellingen opgeslagen.');
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Modelinstellingen konden niet worden verwerkt.');
    } finally { setTesting(false); }
  }

  return <div className="settings-row">
    <div className="section-heading"><h3>{t(taskLabels[task])}</h3><ModelBadge model={saved} /></div>
    <div className="settings-grid">
      <label className="field">{t("Aanbieder")}{' '}<select value={value.provider} disabled={busy} onChange={(event) => {
          const next = providers.find((item) => item.id === event.target.value);
          if (!next) return;
          setCustomModel(next.models.length === 0);
          change({ provider: next.id, model: next.models[0] ?? '', effort: next.supportsEffort ? 'low' : null });
        }}>{providers.map((item) => <option key={item.id} value={item.id}>{t(item.label)}</option>)}</select>
      </label>
      <label className="field">{value.provider === 'azure' ? t("Model / implementatienaam") : t("Model")}
        <select value={customModel ? '__custom__' : value.model} disabled={busy} onChange={(event) => {
          const custom = event.target.value === '__custom__';
          setCustomModel(custom);
          change({ ...value, model: custom ? '' : event.target.value });
        }}>
          {provider?.models.map((model) => <option key={model} value={model}>{model}</option>)}
          <option value="__custom__">{t("Ander model-ID…")}</option>
        </select>
      </label>
      {customModel && <label className="field">{value.provider === 'azure' ? t("Azure-implementatienaam") : t("Model-ID")}
        <input value={value.model} disabled={busy} autoCapitalize="none" spellCheck={false} onChange={(event) => change({ ...value, model: event.target.value })} placeholder={value.provider === 'azure' ? t("Naam van uw modelimplementatie") : t("Volledige model-ID")} />
      </label>}
      {provider?.supportsEffort && <label className="field">{t("Redeneerinspanning")}{' '}<select value={normalized.effort ?? ''} disabled={busy} onChange={(event) => change({ ...value, effort: event.target.value ? event.target.value as Effort : null })}>
          {!gpt6 && <option value="">{t("Standaard van aanbieder")}</option>}
          {allowedEfforts(value.model).map((effort) => <option key={effort} value={effort}>{t(effortLabels[effort])}</option>)}
        </select>
      </label>}
    </div>
    {task === 'answer' && <p className="muted">{t("Test controleert de modelverbinding. Controleer de inhoud van echte antwoorden altijd aan de hand van de bronpassages.")}</p>}
    {gpt6 && provider?.supportsEffort && <p className="muted">{t("Voor GPT-6 kiest u laag of gemiddeld om kosten en wachttijd te beperken.")}</p>}
    {unsupportedAstra && <p className="notice notice-amber">{t("GPT-6 Astra vereist een aanbieder die lage of gemiddelde redeneerinspanning ondersteunt. Kies OpenAI of Azure, of kies een ander model bij deze aanbieder.")}</p>}
    {value.provider === 'azure' && <p className="muted">{provider?.baseUrl ? t("Gebruik uw Azure-implementatienaam als model en controleer de verbinding met Test.") : t("Azure: niet getest. Vul hieronder eerst de resourcenaam in.")}</p>}
    <div className="actions">
      <button type="button" disabled={busy || !dirty || !valid} onClick={() => void act(false)}>{t("Opslaan")}</button>
      <button type="button" disabled={busy || !valid || pendingProviders[value.provider]} onClick={() => void act(true)}>{testing ? t("Testen…") : dirty ? t("Opslaan en testen") : t("Test")}</button>
      {dirty && <span className="muted">{t("Niet-opgeslagen wijzigingen")}</span>}
    </div>
    {pendingProviders[value.provider] && <p className="muted">{t("Sla eerst de nieuwe sleutel en verbindingsgegevens van deze aanbieder op om te testen.")}</p>}
    <p className="save-status" role="status" aria-live="polite">{t(message)}</p>
    {error && <p className="notice notice-red" role="alert">{t(error)}</p>}
  </div>;
}

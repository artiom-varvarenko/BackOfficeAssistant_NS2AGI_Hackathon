'use client';

import { useEffect, useState } from 'react';
import type { SettingsPatch } from '@/lib/api-client';
import type { ProviderId, ProviderInfo, Settings } from '@/lib/types';
import { Badge } from './Badge';

function endpointValue(provider: ProviderInfo) {
  if (provider.id !== 'azure') return provider.baseUrl ?? '';
  try { return provider.baseUrl ? new URL(provider.baseUrl).hostname.replace(/\.openai\.azure\.com$/, '') : ''; }
  catch { return ''; }
}

export function ProviderKeyRow({ provider, busy, onSave, onDirtyChange }: {
  provider: ProviderInfo;
  busy: boolean;
  onSave: (patch: SettingsPatch) => Promise<Settings>;
  onDirtyChange: (provider: ProviderId, dirty: boolean) => void;
}) {
  const [key, setKey] = useState('');
  const [endpoint, setEndpoint] = useState(endpointValue(provider));
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const custom = provider.id === 'custom';
  const azure = provider.id === 'azure';
  const endpointChanged = (custom || azure) && endpoint.trim() !== endpointValue(provider);
  const changed = key.trim().length > 0 || endpointChanged;
  const status = provider.keySource === 'env' ? 'Ingesteld via omgeving' : provider.hasKey ? `Ingesteld (${provider.maskedKey ?? 'gemaskeerd'})` : 'Niet ingesteld';
  useEffect(() => { onDirtyChange(provider.id, changed); }, [provider.id, changed, onDirtyChange]);

  async function save(remove: boolean) {
    setMessage('');
    setError('');
    try {
      if (!remove && custom && endpointChanged && endpoint.trim()) {
        let url: URL | null = null;
        try { url = new URL(endpoint.trim()); } catch { /* Show the same actionable message for malformed URLs. */ }
        if (!url || !/^https?:\/\//i.test(endpoint.trim()) || /[\u0000-\u001f\u007f\\?#]/.test(endpoint) || url.username || url.password) {
          throw new Error('Gebruik een volledige http(s)-basis-URL zonder inloggegevens, queryparameters, fragment, backslashes of controletekens. Vul de API-sleutel in het aparte sleutelveld in.');
        }
      }
      if (!remove && azure && endpointChanged && endpoint.trim() && !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(endpoint.trim())) {
        throw new Error('Vul alleen de Azure-resourcenaam in: 1–63 letters, cijfers of koppeltekens, met een letter of cijfer aan het begin en einde. Gebruik niet de volledige URL.');
      }
      const patch: SettingsPatch = remove ? { keys: { [provider.id]: null } } : {
        ...(key.trim() ? { keys: { [provider.id]: key.trim() } } : {}),
        ...(custom && endpointChanged ? { custom: { baseUrl: endpoint.trim() || null } } : {}),
        ...(azure && endpointChanged ? { azure: { resourceName: endpoint.trim() || null } } : {}),
      };
      const updated = await onSave(patch);
      const updatedProvider = updated.providers.find((item) => item.id === provider.id);
      if (!remove && updatedProvider) setEndpoint(endpointValue(updatedProvider));
      setKey('');
      setMessage(remove ? 'Opgeslagen sleutel verwijderd. Een sleutel uit de omgeving blijft beschikbaar.' : 'Instellingen van de aanbieder opgeslagen.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Opslaan is mislukt.'); }
  }

  return <div className="settings-row">
    <div className="section-heading"><h3>{provider.label}</h3><Badge tone={provider.hasKey ? 'green' : 'neutral'}>{status}</Badge></div>
    <div className="settings-grid">
      <label className="field">Nieuwe sleutel
        <input type="password" value={key} disabled={busy} autoComplete="new-password" autoCapitalize="none" spellCheck={false} placeholder="Voer een volledige nieuwe sleutel in" aria-label={`Nieuwe sleutel voor ${provider.label}`} onChange={(event) => { setKey(event.target.value); setMessage(''); setError(''); }} />
      </label>
      {(custom || azure) && <label className="field">{custom ? 'Basis-URL' : 'Azure-resourcenaam'}
        <input type={custom ? 'url' : 'text'} value={endpoint} disabled={busy} autoCapitalize="none" spellCheck={false} placeholder={custom ? 'https://uw-server.example/v1' : 'naam-van-uw-resource'} onChange={(event) => { setEndpoint(event.target.value); setMessage(''); setError(''); }} />
      </label>}
    </div>
    {custom && <p className="muted">Een lokale OpenAI-compatibele server kan zonder sleutel werken. Laat de nieuwe sleutel leeg om de bestaande sleutel te behouden. Maak de basis-URL leeg om de instelling uit de omgeving te gebruiken.</p>}
    {azure && <p className="muted">Vul alleen de resourcenaam in. Kies de implementatienaam als model bij de taak. Maak de resourcenaam leeg om de instelling uit de omgeving te gebruiken.</p>}
    <div className="actions">
      <button type="button" disabled={busy || !changed} onClick={() => void save(false)}>Opslaan</button>
      <button type="button" className="danger-button" disabled={busy || provider.keySource !== 'db'} onClick={() => void save(true)}>Verwijderen</button>
    </div>
    <p className="save-status" role="status" aria-live="polite">{message}</p>
    {error && <p className="notice notice-red" role="alert">{error}</p>}
  </div>;
}

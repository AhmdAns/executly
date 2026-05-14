'use client';
import { useEffect, useState } from 'react';

const SECTIONS = [
  {
    title: 'AI Providers',
    fields: [
      { key: 'ANTHROPIC_API_KEY', label: 'Anthropic API Key', type: 'password', placeholder: 'sk-ant-…' },
      { key: 'GEMINI_API_KEY',    label: 'Gemini API Key',    type: 'password', placeholder: 'AIza…'   },
      { key: 'CLAUDE_MODEL',      label: 'Claude Model',      placeholder: 'claude-sonnet-4-6'          },
      { key: 'GEMINI_MODEL',      label: 'Gemini Model',      placeholder: 'gemini-1.5-flash'           },
    ],
  },
  {
    title: 'LLM Routing',
    fields: [
      { key: 'LLM_PREFER',        label: 'Preferred Provider', placeholder: 'gemini' },
      { key: 'LLM_FORCE',         label: 'Force Provider',     placeholder: 'none'   },
      { key: 'GEMINI_DAILY_LIMIT',label: 'Gemini Daily Limit', placeholder: '1400'   },
    ],
  },
  {
    title: 'Azure DevOps',
    fields: [
      { key: 'AZURE_DEVOPS_PAT', label: 'Personal Access Token', type: 'password', placeholder: 'Your PAT' },
      { key: 'AZURE_ORG_URL',    label: 'Organization URL',      placeholder: 'https://dev.azure.com/org' },
      { key: 'AZURE_PROJECT',    label: 'Project Name',          placeholder: 'MyProject' },
    ],
  },
  {
    title: 'Database',
    fields: [
      { key: 'DB_TYPE',              label: 'DB Type',              placeholder: 'postgres' },
      { key: 'DB_CONNECTION_STRING', label: 'Connection String',    type: 'password', placeholder: 'postgresql://…' },
    ],
  },
  {
    title: 'Cron Trigger',
    fields: [
      { key: 'CRON_ADAPTER',  label: 'Adapter', placeholder: 'http' },
      { key: 'CRON_HTTP_URL', label: 'HTTP URL', placeholder: 'https://scheduler.internal/trigger' },
    ],
  },
  {
    title: 'Log Checker',
    fields: [
      { key: 'LOG_TOOL',        label: 'Tool',          placeholder: 'datadog' },
      { key: 'LOG_TOOL_API_KEY',label: 'API Key',       type: 'password', placeholder: '…' },
      { key: 'LOG_TOOL_URL',    label: 'API URL',       placeholder: 'https://api.datadoghq.com' },
      { key: 'SPLUNK_URL',      label: 'Splunk URL',    placeholder: 'https://splunk.internal:8088' },
      { key: 'SPLUNK_HEC_TOKEN',label: 'Splunk HEC Token', type: 'password', placeholder: '…' },
    ],
  },
];

export default function SettingsPage() {
  const [values, setValues] = useState({});
  const [saved, setSaved]   = useState(false);
  const [error, setError]   = useState('');

  useEffect(() => {
    fetch('/api/settings').then((r) => r.json()).then(setValues).catch(() => {});
  }, []);

  function set(key) {
    return (e) => setValues((v) => ({ ...v, [key]: e.target.value }));
  }

  async function handleSave() {
    setSaved(false); setError('');
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });
      if (!res.ok) throw new Error(await res.text());
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) { setError(err.message); }
  }

  return (
    <div className="p-8 max-w-2xl">
      <h1 className="text-2xl font-bold text-white mb-1">Settings</h1>
      <p className="text-slate-400 text-sm mb-8">Configuration is saved to settings.json and applied immediately</p>

      <div className="space-y-6">
        {SECTIONS.map(({ title, fields }) => (
          <div key={title} className="card">
            <h2 className="font-semibold text-white mb-4">{title}</h2>
            <div className="space-y-3">
              {fields.map(({ key, label, type, placeholder }) => (
                <div key={key}>
                  <label className="text-sm text-slate-400 mb-1 block">{label}</label>
                  <input
                    type={type ?? 'text'}
                    className="input"
                    placeholder={placeholder}
                    value={values[key] ?? ''}
                    onChange={set(key)}
                  />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-6 flex items-center gap-4">
        <button className="btn-primary" onClick={handleSave}>Save Settings</button>
        {saved && <p className="text-emerald-400 text-sm">✓ Saved successfully</p>}
        {error && <p className="text-red-400 text-sm">{error}</p>}
      </div>
    </div>
  );
}

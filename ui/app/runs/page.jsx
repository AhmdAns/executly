'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export default function NewRun() {
  const router = useRouter();
  const [form, setForm] = useState({ planId: '', suiteId: '', suiteName: '' });
  const [preview, setPreview]   = useState(null);
  const [gaps, setGaps]         = useState(null);
  const [loading, setLoading]   = useState('');
  const [error, setError]       = useState('');

  function set(k) { return (e) => setForm((f) => ({ ...f, [k]: e.target.value })); }

  async function handlePreview() {
    setError(''); setPreview(null); setGaps(null);
    if (!form.planId || !form.suiteId) return setError('Plan ID and Suite ID are required.');
    setLoading('preview');
    try {
      const res = await fetch(`/api/azure/testcases?planId=${form.planId}&suiteId=${form.suiteId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setPreview(data.testCases);
    } catch (err) { setError(err.message); }
    finally { setLoading(''); }
  }

  async function handleGaps() {
    setError(''); setGaps(null);
    setLoading('gaps');
    try {
      const res = await fetch(`/api/azure/gaps?planId=${form.planId}&suiteId=${form.suiteId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setGaps(data);
    } catch (err) { setError(err.message); }
    finally { setLoading(''); }
  }

  async function handleStart() {
    setError('');
    setLoading('start');
    try {
      const res = await fetch('/api/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      router.push(`/runs/${data.runId}`);
    } catch (err) { setError(err.message); setLoading(''); }
  }

  const criticalGaps = gaps?.reports?.flatMap((r) => r.gaps.filter((g) => g.severity === 'critical')) ?? [];

  return (
    <div className="p-8 max-w-3xl">
      <h1 className="text-2xl font-bold text-white mb-1">New Test Run</h1>
      <p className="text-slate-400 text-sm mb-8">Fetch test cases from Azure DevOps and start execution</p>

      {/* Form */}
      <div className="card mb-6 space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-sm text-slate-400 mb-1 block">Test Plan ID *</label>
            <input className="input" placeholder="e.g. 42" value={form.planId} onChange={set('planId')} />
          </div>
          <div>
            <label className="text-sm text-slate-400 mb-1 block">Test Suite ID *</label>
            <input className="input" placeholder="e.g. 101" value={form.suiteId} onChange={set('suiteId')} />
          </div>
        </div>
        <div>
          <label className="text-sm text-slate-400 mb-1 block">Suite Name (optional)</label>
          <input className="input" placeholder="e.g. Smoke Tests" value={form.suiteName} onChange={set('suiteName')} />
        </div>
        {error && <p className="text-red-400 text-sm">{error}</p>}
        <div className="flex gap-3 pt-2">
          <button className="btn-secondary" onClick={handlePreview} disabled={!!loading}>
            {loading === 'preview' ? 'Fetching…' : 'Preview Test Cases'}
          </button>
          {preview && (
            <button className="btn-secondary" onClick={handleGaps} disabled={!!loading}>
              {loading === 'gaps' ? 'Scanning…' : 'Scan for Gaps'}
            </button>
          )}
          <button className="btn-primary ml-auto" onClick={handleStart} disabled={!!loading || !form.planId || !form.suiteId}>
            {loading === 'start' ? 'Starting…' : '▶ Start Run'}
          </button>
        </div>
      </div>

      {/* Gap Detection Results */}
      {gaps && (
        <div className="card mb-6">
          <h2 className="font-semibold text-white mb-3">Gap Detection Results</h2>
          <div className="flex gap-4 mb-4 text-sm">
            <span className="text-slate-400">Total: <strong className="text-white">{gaps.summary?.totalGaps}</strong></span>
            <span className="text-red-400">Critical: <strong>{gaps.summary?.critical}</strong></span>
            <span className="text-amber-400">Warnings: <strong>{gaps.summary?.warnings}</strong></span>
          </div>
          {criticalGaps.length > 0 && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 mb-3">
              <p className="text-red-400 text-sm font-medium mb-2">Critical gaps found — review before running:</p>
              <ul className="space-y-1">
                {criticalGaps.map((g, i) => (
                  <li key={i} className="text-red-300 text-sm">• {g.description}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="space-y-2">
            {gaps.reports?.map((r) => r.gaps.length > 0 && (
              <div key={r.testCaseId} className="text-sm">
                <span className="text-slate-400">{r.testCaseId}</span>
                <span className="text-slate-500 mx-2">—</span>
                <span className="text-slate-300">{r.title}</span>
                <span className="ml-2 text-slate-500">{r.gaps.length} gap(s)</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Test Case Preview */}
      {preview && (
        <div className="card">
          <h2 className="font-semibold text-white mb-3">
            Test Cases <span className="text-slate-500 text-sm font-normal">({preview.length})</span>
          </h2>
          <div className="space-y-3">
            {preview.map((tc) => (
              <div key={tc.testCaseId} className="border border-slate-700 rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-white">{tc.testCaseId} — {tc.title}</span>
                  <span className="text-xs text-slate-500">{tc.steps?.length ?? 0} steps</span>
                </div>
                {tc.prerequisites?.length > 0 && (
                  <p className="text-xs text-slate-500 mb-2">Prerequisites: {tc.prerequisites.join(', ')}</p>
                )}
                <div className="space-y-1">
                  {tc.steps?.slice(0, 4).map((s, i) => (
                    <div key={i} className="text-xs text-slate-400 flex gap-2">
                      <span className="text-slate-600 w-4">{i + 1}.</span>
                      <span className="font-mono text-blue-400">{s.action}</span>
                      <span className="truncate">{s.target ?? s.expected ?? ''}</span>
                    </div>
                  ))}
                  {(tc.steps?.length ?? 0) > 4 && (
                    <p className="text-xs text-slate-600 pl-6">+{tc.steps.length - 4} more steps</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

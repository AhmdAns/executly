'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';

function StepRow({ step, passed, error, stepIndex }) {
  return (
    <div className={`flex items-start gap-3 py-2 px-3 rounded-lg text-sm ${passed ? 'bg-emerald-500/5' : 'bg-red-500/5'}`}>
      <span className={`mt-0.5 text-base ${passed ? 'text-emerald-400' : 'text-red-400'}`}>{passed ? '✓' : '✗'}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-mono text-blue-400 text-xs">{step?.action}</span>
          {step?.target && <span className="text-slate-300 truncate text-xs">{step.target}</span>}
          {step?.value  && <span className="text-slate-500 text-xs">→ {step.value}</span>}
        </div>
        {error && <p className="text-red-400 text-xs mt-1">{error}</p>}
      </div>
      <span className="text-slate-600 text-xs shrink-0">#{stepIndex + 1}</span>
    </div>
  );
}

function TestCaseCard({ tc }) {
  const [open, setOpen] = useState(!tc.passed);
  const passedSteps = tc.stepResults?.filter((s) => s.passed).length ?? 0;
  const totalSteps  = tc.stepResults?.length ?? tc.totalSteps ?? 0;

  return (
    <div className={`border rounded-xl overflow-hidden ${tc.passed === false ? 'border-red-500/40' : tc.passed ? 'border-emerald-500/30' : 'border-slate-700'}`}>
      <button onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-3 p-4 text-left hover:bg-slate-700/30 transition-colors">
        <span className={`text-lg ${tc.passed === false ? 'text-red-400' : tc.passed ? 'text-emerald-400' : 'text-slate-400'}`}>
          {tc.passed === false ? '✗' : tc.passed ? '✓' : '⏳'}
        </span>
        <div className="flex-1">
          <span className="font-medium text-white text-sm">{tc.testCaseId} — {tc.title}</span>
        </div>
        {totalSteps > 0 && (
          <span className="text-xs text-slate-500">{passedSteps}/{totalSteps} steps</span>
        )}
        <span className="text-slate-600 text-xs">{open ? '▲' : '▼'}</span>
      </button>
      {open && tc.stepResults?.length > 0 && (
        <div className="px-4 pb-4 space-y-1 border-t border-slate-700/50 pt-3">
          {tc.stepResults.map((s, i) => (
            <StepRow key={i} stepIndex={i} {...s} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function RunPage() {
  const { runId } = useParams();
  const [testCases, setTestCases] = useState([]);
  const [status, setStatus]   = useState('connecting');
  const [message, setMessage] = useState('');
  const [summary, setSummary] = useState(null);
  const [reportId, setReportId] = useState(null);
  const [error, setError]     = useState('');

  useEffect(() => {
    const es = new EventSource(`/api/runs/${runId}/stream`);

    es.onmessage = (e) => {
      const event = JSON.parse(e.data);

      if (event.type === 'status') {
        setStatus(event.message);
        setMessage(event.message);
      }

      if (event.type === 'run:start') {
        setStatus('running');
        setTestCases(event.testCases.map((tc) => ({ ...tc, stepResults: [], passed: null })));
      }

      if (event.type === 'testcase:start') {
        setTestCases((prev) => prev.map((tc) =>
          tc.testCaseId === event.testCaseId ? { ...tc, totalSteps: event.totalSteps } : tc
        ));
      }

      if (event.type === 'step:result') {
        setTestCases((prev) => prev.map((tc) =>
          tc.testCaseId === event.testCaseId
            ? { ...tc, stepResults: [...(tc.stepResults ?? []), { step: event.step, passed: event.passed, error: event.error }] }
            : tc
        ));
      }

      if (event.type === 'testcase:complete') {
        setTestCases((prev) => prev.map((tc) =>
          tc.testCaseId === event.testCaseId ? { ...tc, passed: event.passed } : tc
        ));
      }

      if (event.type === 'run:complete') {
        setStatus('complete');
        setSummary(event.summary);
        setReportId(event.reportId);
        es.close();
      }

      if (event.type === 'error') {
        setStatus('error');
        setError(event.message);
        es.close();
      }
    };

    es.onerror = () => { setStatus('error'); setError('Connection lost.'); es.close(); };
    return () => es.close();
  }, [runId]);

  const passed  = testCases.filter((tc) => tc.passed === true).length;
  const failed  = testCases.filter((tc) => tc.passed === false).length;
  const pending = testCases.filter((tc) => tc.passed === null).length;
  const progress = testCases.length > 0 ? Math.round(((passed + failed) / testCases.length) * 100) : 0;

  return (
    <div className="p-8">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/runs" className="text-slate-500 hover:text-slate-300 text-sm">← Runs</Link>
        <span className="text-slate-700">/</span>
        <span className="text-slate-400 text-sm font-mono">{runId.slice(0, 8)}…</span>
      </div>

      {/* Header */}
      <div className="card mb-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-xl font-bold text-white">Live Execution</h1>
            <p className="text-sm text-slate-400 mt-0.5">{message || status}</p>
          </div>
          <div className="flex items-center gap-6 text-sm">
            <span className="text-emerald-400">✓ {passed} passed</span>
            <span className="text-red-400">✗ {failed} failed</span>
            {pending > 0 && <span className="text-slate-500">⏳ {pending} pending</span>}
          </div>
        </div>

        {/* Progress bar */}
        {testCases.length > 0 && (
          <div>
            <div className="flex items-center justify-between text-xs text-slate-500 mb-1.5">
              <span>{passed + failed} / {testCases.length} test cases</span>
              <span>{progress}%</span>
            </div>
            <div className="w-full bg-slate-700 rounded-full h-2">
              <div className="h-2 rounded-full transition-all duration-500"
                style={{
                  width: `${progress}%`,
                  background: failed > 0 ? '#ef4444' : '#22c55e',
                }} />
            </div>
          </div>
        )}

        {status === 'complete' && summary && (
          <div className="mt-4 pt-4 border-t border-slate-700 flex items-center justify-between">
            <p className="text-white font-medium">
              Run complete — {summary.passed}/{summary.total} passed ({summary.passRate})
            </p>
            {reportId && (
              <Link href={`/reports/${reportId}`} className="btn-primary text-sm">
                View Report →
              </Link>
            )}
          </div>
        )}

        {status === 'error' && (
          <div className="mt-4 pt-4 border-t border-slate-700">
            <p className="text-red-400 text-sm">Error: {error}</p>
          </div>
        )}
      </div>

      {/* Test Cases */}
      {testCases.length > 0 && (
        <div className="space-y-3">
          {testCases.map((tc) => <TestCaseCard key={tc.testCaseId} tc={tc} />)}
        </div>
      )}

      {testCases.length === 0 && status !== 'error' && (
        <div className="card text-center py-12">
          <div className="text-4xl mb-3">⏳</div>
          <p className="text-slate-400">{message || 'Initializing…'}</p>
        </div>
      )}
    </div>
  );
}

import Link from 'next/link';

async function getReport(id) {
  try {
    const res = await fetch(`http://localhost:3000/api/reports/${id}`, { cache: 'no-store' });
    return res.ok ? res.json() : null;
  } catch { return null; }
}

function StepList({ steps }) {
  if (!steps?.total) return null;
  return (
    <p className="text-xs text-slate-500 mt-1">{steps.passed}/{steps.total} steps passed</p>
  );
}

export default async function ReportDetailPage({ params }) {
  const report = await getReport(params.id);

  if (!report) {
    return (
      <div className="p-8">
        <Link href="/reports" className="text-slate-500 hover:text-slate-300 text-sm">← Reports</Link>
        <div className="card mt-6 text-center py-16">
          <p className="text-slate-500">Report not found.</p>
        </div>
      </div>
    );
  }

  const passed  = report.testCases?.filter((tc) => tc.passed).length ?? 0;
  const failed  = report.testCases?.filter((tc) => !tc.passed).length ?? 0;

  return (
    <div className="p-8">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/reports" className="text-slate-500 hover:text-slate-300 text-sm">← Reports</Link>
        <span className="text-slate-700">/</span>
        <span className="text-slate-400 text-sm">{report.suiteName}</span>
      </div>

      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">{report.suiteName}</h1>
          <p className="text-slate-400 text-sm mt-1">{new Date(report.generatedAt).toLocaleString()}</p>
        </div>
        {report.runUrl && (
          <a href={report.runUrl} target="_blank" rel="noreferrer" className="btn-secondary text-sm">
            Azure Test Run ↗
          </a>
        )}
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        {[
          { label: 'Total',    value: report.summary?.total,    color: 'text-white' },
          { label: 'Passed',   value: report.summary?.passed,   color: 'text-emerald-400' },
          { label: 'Failed',   value: report.summary?.failed,   color: 'text-red-400' },
          { label: 'Pass Rate',value: report.summary?.passRate, color: report.summary?.failed === 0 ? 'text-emerald-400' : 'text-amber-400' },
        ].map(({ label, value, color }) => (
          <div key={label} className="card">
            <p className="text-slate-400 text-sm">{label}</p>
            <p className={`text-3xl font-bold mt-1 ${color}`}>{value ?? '—'}</p>
          </div>
        ))}
      </div>

      {/* Test Cases */}
      <h2 className="font-semibold text-white mb-4">Test Cases</h2>
      <div className="space-y-4">
        {report.testCases?.map((tc) => (
          <div key={tc.testCaseId}
            className={`card border ${tc.passed ? 'border-emerald-500/20' : 'border-red-500/30'}`}>
            <div className="flex items-start gap-3">
              <span className={`text-xl mt-0.5 ${tc.passed ? 'text-emerald-400' : 'text-red-400'}`}>
                {tc.passed ? '✓' : '✗'}
              </span>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-white">{tc.testCaseId} — {tc.title}</p>
                <StepList steps={tc.steps} />
                {tc.summary && (
                  <p className="text-slate-400 text-sm mt-2">{tc.summary}</p>
                )}

                {/* Failure details */}
                {!tc.passed && (
                  <div className="mt-3 space-y-3">
                    {tc.rootCause && (
                      <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3">
                        <p className="text-xs font-medium text-red-400 mb-1">Root Cause</p>
                        <p className="text-sm text-red-300">{tc.rootCause}</p>
                      </div>
                    )}
                    {tc.screenshot && (
                      <div>
                        <p className="text-xs text-slate-500 mb-1">Screenshot</p>
                        <p className="text-xs font-mono text-slate-400 bg-slate-900 px-2 py-1 rounded">{tc.screenshot}</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

import Link from 'next/link';

async function getData() {
  try {
    const [runsRes, reportsRes, healthRes] = await Promise.all([
      fetch('http://localhost:3000/api/runs', { cache: 'no-store' }),
      fetch('http://localhost:3000/api/reports', { cache: 'no-store' }),
      fetch('http://localhost:3000/api/health', { cache: 'no-store' }),
    ]);
    const runs    = runsRes.ok    ? await runsRes.json()    : [];
    const reports = reportsRes.ok ? await reportsRes.json() : [];
    const health  = healthRes.ok  ? await healthRes.json()  : {};
    return { runs, reports, health };
  } catch {
    return { runs: [], reports: [], health: {} };
  }
}

function StatusBadge({ status }) {
  const map = {
    complete:    <span className="badge-pass">● Passed</span>,
    error:       <span className="badge-fail">● Failed</span>,
    running:     <span className="badge-running">● Running</span>,
    fetching:    <span className="badge-running">● Fetching</span>,
    beautifying: <span className="badge-running">● Beautifying</span>,
    reporting:   <span className="badge-running">● Reporting</span>,
    pending:     <span className="badge-pending">● Pending</span>,
  };
  return map[status] ?? <span className="badge-pending">● {status}</span>;
}

export default async function Dashboard() {
  const { runs, reports, health } = await getData();

  const active  = runs.filter((r) => !['complete', 'error'].includes(r.status)).length;
  const allPass = reports.filter((r) => r.summary?.failed === 0).length;
  const avgRate = reports.length
    ? Math.round(reports.reduce((s, r) => s + (r.summary?.passed ?? 0) / Math.max(r.summary?.total ?? 1, 1), 0) / reports.length * 100)
    : 0;

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-white">Dashboard</h1>
          <p className="text-slate-400 text-sm mt-1">AI-powered test execution overview</p>
        </div>
        <Link href="/runs" className="btn-primary">+ New Run</Link>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        {[
          { label: 'Total Runs',     value: runs.length },
          { label: 'Active Runs',    value: active,   highlight: active > 0 },
          { label: 'Total Reports',  value: reports.length },
          { label: 'Avg Pass Rate',  value: `${avgRate}%` },
        ].map(({ label, value, highlight }) => (
          <div key={label} className="card">
            <p className="text-slate-400 text-sm">{label}</p>
            <p className={`text-3xl font-bold mt-1 ${highlight ? 'text-blue-400' : 'text-white'}`}>{value}</p>
          </div>
        ))}
      </div>

      {/* Recent Runs */}
      <div className="card mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-white">Recent Runs</h2>
          <Link href="/runs" className="text-sm text-blue-400 hover:text-blue-300">View all →</Link>
        </div>
        {runs.length === 0 ? (
          <p className="text-slate-500 text-sm">No runs yet. <Link href="/runs" className="text-blue-400 hover:underline">Start one →</Link></p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-slate-400 text-left border-b border-slate-700">
                <th className="pb-2 font-medium">Suite</th>
                <th className="pb-2 font-medium">Status</th>
                <th className="pb-2 font-medium">Result</th>
                <th className="pb-2 font-medium">Started</th>
                <th className="pb-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700/50">
              {runs.slice(0, 8).map((run) => (
                <tr key={run.id} className="text-slate-300">
                  <td className="py-3">{run.meta?.suiteName || `Plan ${run.meta?.planId} / Suite ${run.meta?.suiteId}`}</td>
                  <td className="py-3"><StatusBadge status={run.status} /></td>
                  <td className="py-3">
                    {run.summary ? `${run.summary.passed}/${run.summary.total} (${run.summary.passRate})` : '—'}
                  </td>
                  <td className="py-3 text-slate-500">{new Date(run.startedAt).toLocaleString()}</td>
                  <td className="py-3 text-right">
                    <Link href={`/runs/${run.id}`} className="text-blue-400 hover:text-blue-300 text-xs">View →</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Gemini quota */}
      {health.geminiUsage !== undefined && (
        <div className="card">
          <h2 className="font-semibold text-white mb-3">Gemini Quota Today</h2>
          <div className="flex items-center gap-4">
            <div className="flex-1 bg-slate-700 rounded-full h-2">
              <div className="bg-blue-500 h-2 rounded-full transition-all"
                style={{ width: `${Math.min((health.geminiUsage / 1400) * 100, 100)}%` }} />
            </div>
            <span className="text-sm text-slate-400">{health.geminiUsage} / 1400</span>
          </div>
        </div>
      )}
    </div>
  );
}

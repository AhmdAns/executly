import Link from 'next/link';

async function getReports() {
  try {
    const res = await fetch('http://localhost:3000/api/reports', { cache: 'no-store' });
    return res.ok ? res.json() : [];
  } catch { return []; }
}

export default async function ReportsPage() {
  const reports = await getReports();

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold text-white mb-1">Reports</h1>
      <p className="text-slate-400 text-sm mb-8">All saved test run reports</p>

      {reports.length === 0 ? (
        <div className="card text-center py-16">
          <p className="text-slate-500">No reports yet. <Link href="/runs" className="text-blue-400 hover:underline">Start a run →</Link></p>
        </div>
      ) : (
        <div className="card">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-slate-400 text-left border-b border-slate-700">
                <th className="pb-3 font-medium">Suite</th>
                <th className="pb-3 font-medium">Date</th>
                <th className="pb-3 font-medium">Tests</th>
                <th className="pb-3 font-medium">Passed</th>
                <th className="pb-3 font-medium">Failed</th>
                <th className="pb-3 font-medium">Pass Rate</th>
                <th className="pb-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700/50">
              {reports.map((r) => (
                <tr key={r.id} className="text-slate-300 hover:bg-slate-700/20 transition-colors">
                  <td className="py-3 font-medium text-white">{r.suiteName || '—'}</td>
                  <td className="py-3 text-slate-500">{new Date(r.generatedAt).toLocaleString()}</td>
                  <td className="py-3">{r.summary?.total ?? '—'}</td>
                  <td className="py-3 text-emerald-400">{r.summary?.passed ?? '—'}</td>
                  <td className="py-3 text-red-400">{r.summary?.failed ?? '—'}</td>
                  <td className="py-3">
                    <span className={`font-medium ${(r.summary?.failed ?? 0) === 0 ? 'text-emerald-400' : 'text-amber-400'}`}>
                      {r.summary?.passRate ?? '—'}
                    </span>
                  </td>
                  <td className="py-3 text-right">
                    <Link href={`/reports/${r.id}`} className="text-blue-400 hover:text-blue-300 text-xs">View →</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

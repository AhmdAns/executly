import './globals.css';
import Link from 'next/link';

export const metadata = { title: 'Executly', description: 'Smart AI-powered test execution' };

const NAV = [
  { href: '/',          label: 'Dashboard' },
  { href: '/runs',      label: 'Runs'      },
  { href: '/reports',   label: 'Reports'   },
  { href: '/settings',  label: 'Settings'  },
];

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className="min-h-screen flex">
        {/* Sidebar */}
        <aside className="w-56 flex-shrink-0 bg-slate-900 border-r border-slate-700 flex flex-col">
          <div className="px-6 py-5 border-b border-slate-700">
            <span className="text-lg font-bold text-white tracking-tight">Executly</span>
            <p className="text-xs text-slate-500 mt-0.5">AI Test Runner</p>
          </div>
          <nav className="flex-1 px-3 py-4 space-y-1">
            {NAV.map(({ href, label }) => (
              <Link key={href} href={href}
                className="flex items-center px-3 py-2 rounded-lg text-sm text-slate-300 hover:text-white hover:bg-slate-700 transition-colors">
                {label}
              </Link>
            ))}
          </nav>
          <div className="px-6 py-4 border-t border-slate-700">
            <p className="text-xs text-slate-500">Phase 0–5 complete</p>
          </div>
        </aside>

        {/* Main */}
        <main className="flex-1 overflow-auto">
          {children}
        </main>
      </body>
    </html>
  );
}

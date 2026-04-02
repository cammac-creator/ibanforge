import Link from 'next/link';

const ACTIONS = [
  {
    href: '/dashboard/api-stats',
    label: 'Voir API Stats',
    desc: 'Breakdown détaillé par endpoint',
    icon: '📈',
  },
  {
    href: '/dashboard/monitoring',
    label: 'Monitoring',
    desc: 'Statut et santé de l\u2019API',
    icon: '🔍',
  },
  {
    href: '/playground',
    label: 'Playground',
    desc: 'Tester les endpoints en live',
    icon: '🧪',
  },
  {
    href: '/docs',
    label: 'Documentation',
    desc: 'Guides et référence API',
    icon: '📖',
  },
];

export function QuickActions() {
  return (
    <div>
      <p className="text-sm font-medium text-zinc-300 mb-3">Accès rapides</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {ACTIONS.map((a) => (
          <Link
            key={a.href}
            href={a.href}
            className="group rounded-xl border border-zinc-800 bg-zinc-900 p-4 hover:border-amber-500/30 hover:bg-zinc-900/80 transition-all"
          >
            <span className="text-2xl block mb-2">{a.icon}</span>
            <p className="text-sm font-medium text-zinc-200 group-hover:text-amber-400 transition-colors">
              {a.label}
            </p>
            <p className="text-xs text-zinc-500 mt-0.5">{a.desc}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}

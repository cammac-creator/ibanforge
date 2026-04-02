'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV_ITEMS = [
  { href: '/dashboard', label: 'Vue d\u2019ensemble', icon: '📊', exact: true },
  { href: '/dashboard/api-stats', label: 'API Stats', icon: '📈', exact: false },
  { href: '/dashboard/monitoring', label: 'Monitoring', icon: '🔍', exact: false },
];

export function SidebarNav() {
  const pathname = usePathname();

  function isActive(href: string, exact: boolean): boolean {
    if (exact) return pathname === href;
    return pathname.startsWith(href);
  }

  return (
    <div className="space-y-1">
      <p className="px-3 mb-2 text-[10px] font-semibold uppercase tracking-widest text-zinc-600">
        Navigation
      </p>
      {NAV_ITEMS.map((item) => {
        const active = isActive(item.href, item.exact);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={[
              'flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition',
              active
                ? 'bg-amber-500/10 text-amber-400 font-medium border border-amber-500/20'
                : 'text-zinc-400 hover:text-white hover:bg-zinc-800/60',
            ].join(' ')}
          >
            <span className="text-base">{item.icon}</span>
            <span>{item.label}</span>
          </Link>
        );
      })}
    </div>
  );
}

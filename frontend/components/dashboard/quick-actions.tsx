'use client';

import Link from 'next/link';
import { useTranslations, useLocale } from 'next-intl';

export function QuickActions() {
  const t = useTranslations('dashboard');
  const locale = useLocale();

  const ACTIONS = [
    {
      href: `/${locale}/dashboard/api-stats`,
      label: t('quickActions.apiStats.label'),
      desc: t('quickActions.apiStats.desc'),
      icon: '📈',
    },
    {
      href: `/${locale}/dashboard/monitoring`,
      label: t('quickActions.monitoring.label'),
      desc: t('quickActions.monitoring.desc'),
      icon: '🔍',
    },
    {
      href: `/${locale}/playground`,
      label: t('quickActions.playground.label'),
      desc: t('quickActions.playground.desc'),
      icon: '🧪',
    },
    {
      href: `/${locale}/docs`,
      label: t('quickActions.docs.label'),
      desc: t('quickActions.docs.desc'),
      icon: '📖',
    },
  ];

  return (
    <div>
      <p className="text-sm font-medium text-zinc-300 mb-3">{t('quickActions.title')}</p>
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

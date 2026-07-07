'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

export function LogoutButton() {
  const router = useRouter();
  const t = useTranslations('dashboard');

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/');
  }

  return (
    <button
      onClick={handleLogout}
      className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-[var(--fg-5)] hover:text-red-400 hover:bg-red-500/5 transition text-left"
    >
      <span className="text-base">⏻</span>
      <span>{t('logout.label')}</span>
    </button>
  );
}

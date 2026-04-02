'use client';

import { useRouter } from 'next/navigation';

export function LogoutButton() {
  const router = useRouter();

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/');
  }

  return (
    <button
      onClick={handleLogout}
      className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-zinc-600 hover:text-red-400 hover:bg-red-500/5 transition text-left"
    >
      <span className="text-base">⏻</span>
      <span>Déconnexion</span>
    </button>
  );
}

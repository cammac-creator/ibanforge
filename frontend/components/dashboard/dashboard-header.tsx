'use client';

import { useEffect, useState } from 'react';

export function DashboardHeader() {
  const [now, setNow] = useState<string>('');

  useEffect(() => {
    function update() {
      setNow(
        new Date().toLocaleDateString('fr-CH', {
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        }),
      );
    }
    update();
    const id = setInterval(update, 30_000);
    return () => clearInterval(id);
  }, []);

  return (
    <div>
      <h1 className="text-2xl font-semibold text-white">IBANforge Dashboard</h1>
      {now && (
        <p className="text-sm text-zinc-500 mt-1 capitalize">{now}</p>
      )}
    </div>
  );
}

'use client';

import { useEffect, useState } from 'react';
import { useTranslations, useLocale } from 'next-intl';

export function DashboardHeader() {
  const t = useTranslations('dashboard');
  const locale = useLocale();
  const [now, setNow] = useState<string>('');

  useEffect(() => {
    function update() {
      setNow(
        new Date().toLocaleDateString(locale, {
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
  }, [locale]);

  return (
    <div>
      <h1 className="text-2xl font-semibold text-white">{t('header.title')}</h1>
      {now && (
        <p className="text-sm text-zinc-500 mt-1 capitalize">{now}</p>
      )}
    </div>
  );
}

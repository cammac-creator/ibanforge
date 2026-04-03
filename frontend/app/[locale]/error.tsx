'use client';

import { useTranslations } from 'next-intl';

export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  const t = useTranslations('errors');

  return (
    <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4">
      <h2 className="text-2xl font-bold">{t('generic.title')}</h2>
      <p className="text-muted-foreground">{error.message || t('generic.fallback')}</p>
      <button onClick={reset} className="px-4 py-2 bg-amber-500 text-black rounded-md font-medium hover:bg-amber-400">
        {t('generic.button')}
      </button>
    </div>
  );
}

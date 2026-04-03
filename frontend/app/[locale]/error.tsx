'use client';

export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4">
      <h2 className="text-2xl font-bold">Something went wrong</h2>
      <p className="text-muted-foreground">{error.message || 'An unexpected error occurred'}</p>
      <button onClick={reset} className="px-4 py-2 bg-amber-500 text-black rounded-md font-medium hover:bg-amber-400">
        Try again
      </button>
    </div>
  );
}

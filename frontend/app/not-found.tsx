import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="text-center space-y-6">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">
            404 — Page not found
          </h1>
          <p className="text-muted-foreground">
            The page you&apos;re looking for doesn&apos;t exist.
          </p>
        </div>
        <Link
          href="/"
          className="inline-flex items-center justify-center rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Go home
        </Link>
      </div>
    </div>
  );
}

export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center min-h-screen gap-4">
      <h1 className="text-4xl font-bold tracking-tight text-primary font-mono">
        IBANforge
      </h1>
      <p className="text-muted-foreground text-sm">
        IBAN validation &amp; BIC/SWIFT lookup API
      </p>
    </main>
  );
}

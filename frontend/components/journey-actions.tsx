import Link from "next/link";
import { ArrowRight, Braces, FileCheck2 } from "lucide-react";
import { journeyCopy, journeyFor, JOURNEY_LINKS, type Journey } from "@/lib/journeys";
import { localePath } from "@/lib/locale-path";

export function JourneyActions({ locale, path }: { locale: string; path: string }) {
  const primary = journeyFor(path);
  if (!primary) return null;
  const copy = journeyCopy(locale);
  const order: Journey[] = primary === "api" ? ["api", "audit"] : ["audit", "api"];

  return (
    <section
      className="not-prose my-10 rounded-2xl border border-[var(--ink-4)] bg-[var(--ink-1)] p-5 sm:p-7"
      aria-labelledby="journey-heading"
      data-journey-source={path}
    >
      <h2 id="journey-heading" className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
        {copy.heading}
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{copy.intro}</p>
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        {order.map((journey, index) => {
          const item = copy[journey];
          const Icon = journey === "api" ? Braces : FileCheck2;
          return (
            <article key={journey} className="flex min-w-0 flex-col rounded-xl border border-[var(--ink-4)] bg-[var(--ink-2)] p-5">
              <Icon className="mb-3 size-5 text-amber-500" aria-hidden="true" />
              <h3 className="text-base font-semibold leading-snug text-foreground">{item.title}</h3>
              <p className="mt-3 flex-1 text-sm leading-relaxed text-muted-foreground">{item.body}</p>
              <Link
                href={localePath(locale, JOURNEY_LINKS[journey].path)}
                data-evt={JOURNEY_LINKS[journey].event}
                className={`mt-5 inline-flex min-h-11 items-center justify-between gap-3 rounded-lg border px-4 py-3 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-amber-500 ${index === 0 ? "border-amber-500 bg-amber-500 text-zinc-950 hover:bg-amber-400" : "border-[var(--ink-4)] text-foreground hover:border-amber-500/60"}`}
              >
                {item.action}<ArrowRight className="size-4 shrink-0" aria-hidden="true" />
              </Link>
            </article>
          );
        })}
      </div>
      <p className="mt-4 text-xs leading-relaxed text-muted-foreground">{copy.note}</p>
    </section>
  );
}

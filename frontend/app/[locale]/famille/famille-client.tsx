"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

const IBAN_DEMO = "CH93 0076 2011 6238 5295 7";

/* ─────────────────────────────────────────────────────────────
   Orchestrator
   ───────────────────────────────────────────────────────────── */
export function FamilleClient() {
  return (
    <>
      <style>{PAGE_CSS}</style>
      <main className="fam">
        <BackgroundDecor />
        <TopBar />

        <Hero />
        <IntroNote />

        <FaqSection
          number="01"
          kicker="Comprendre"
          title={<>C&rsquo;est quoi, <em>au juste</em>&nbsp;?</>}
          items={SECTION_COMPRENDRE}
          extra={<IbanAnatomy />}
        />

        <FaqSection
          number="02"
          kicker="Pas d'inquiétude"
          title={<>Les questions <em>qui fâchent</em>.</>}
          items={SECTION_RASSURER}
        />

        <FaqSection
          number="03"
          kicker="Ce qui m'enthousiasme"
          title={<>Le <em>pari</em> que je fais.</>}
          items={SECTION_PARI}
        />

        <StatsBand />
        <Outro />
      </main>
    </>
  );
}

/* ─────────────────────────────────────────────────────────────
   Reveal-on-scroll hook
   ───────────────────────────────────────────────────────────── */
function useReveal<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const reduce = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (reduce) {
      setShown(true);
      return;
    }

    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setShown(true);
            obs.disconnect();
          }
        }
      },
      { threshold: 0.18, rootMargin: "0px 0px -8% 0px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  return { ref, shown };
}

/* ─────────────────────────────────────────────────────────────
   Background — soft warm light, two faint glows + grain
   ───────────────────────────────────────────────────────────── */
function BackgroundDecor() {
  return (
    <div className="fam-decor" aria-hidden>
      <div className="fam-glow fam-glow-1" />
      <div className="fam-glow fam-glow-2" />
      <div className="fam-grain" />
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   Minimal top bar — discreet brand + back link
   ───────────────────────────────────────────────────────────── */
function TopBar() {
  return (
    <div className="fam-topbar">
      <Link href="/fr" className="fam-topbrand">
        <span className="fam-topbrand-mark" aria-hidden>
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none">
            <path
              d="M5 12.5 L10 17.5 L19 6.5"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
        IBANforge
      </Link>
      <span className="fam-topnote">une page rien que pour toi</span>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   1 — Hero
   ───────────────────────────────────────────────────────────── */
function Hero() {
  return (
    <header className="fam-hero">
      <div className="fam-eyebrow">
        <span className="fam-eyebrow-dot" />
        Pour ma famille &middot; sans jargon
      </div>

      <h1 className="fam-h1">
        Tu m&rsquo;as demandé ce que je
        <br />
        <em>fabrique</em> le soir.
      </h1>

      <p className="fam-lede">
        Voici les questions que tu me poses le plus — avec des réponses
        claires, sans charabia. Bienvenue dans IBANforge.
      </p>

      <AnimatedIban />

      <a href="#faq01" className="fam-scroll" aria-label="Commencer à lire">
        <span>Les questions</span>
        <svg width="13" height="20" viewBox="0 0 14 22" fill="none">
          <path
            d="M7 1 V19 M2 14 L7 19 L12 14"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </a>
    </header>
  );
}

function AnimatedIban() {
  const [phase, setPhase] = useState<"typing" | "pause" | "verified">("typing");
  const [typed, setTyped] = useState("");

  useEffect(() => {
    const reduce = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (reduce) {
      setTyped(IBAN_DEMO);
      setPhase("verified");
      return;
    }

    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];

    const run = () => {
      if (cancelled) return;
      timers.length = 0;
      setTyped("");
      setPhase("typing");

      const chars = IBAN_DEMO.split("");
      chars.forEach((c, i) => {
        const t = setTimeout(() => {
          if (!cancelled) setTyped((s) => s + c);
        }, 65 * i + 250);
        timers.push(t);
      });

      const total = 65 * chars.length + 250;
      timers.push(setTimeout(() => !cancelled && setPhase("pause"), total + 220));
      timers.push(
        setTimeout(() => !cancelled && setPhase("verified"), total + 760),
      );
      timers.push(setTimeout(run, total + 6000));
    };

    run();
    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
  }, []);

  return (
    <div className={`fam-card phase-${phase}`}>
      <div className="fam-card-label">
        <span className="fam-card-label-dot" />
        Vérification en direct
      </div>

      <div className="fam-card-screen">
        <span className="fam-card-prompt">›</span>
        <span className="fam-card-text">
          {typed}
          {phase === "typing" && <span className="fam-card-cursor">|</span>}
        </span>
      </div>

      <div className="fam-card-result">
        <div className={`fam-card-check ${phase === "verified" ? "show" : ""}`}>
          <svg viewBox="0 0 36 36" width="34" height="34" aria-hidden>
            <circle
              cx="18"
              cy="18"
              r="16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              className="fam-check-circle"
            />
            <path
              d="M11 18.5 L16 23.5 L25 13.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="fam-check-mark"
            />
          </svg>
          <div className="fam-card-result-text">
            <strong>IBAN valide</strong>
            <span>UBS Suisse · vérifié en moins de 50&nbsp;ms</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   2 — Intro note (handwritten lead-in)
   ───────────────────────────────────────────────────────────── */
function IntroNote() {
  const { ref, shown } = useReveal<HTMLElement>();
  return (
    <section className="fam-section fam-intro" ref={ref}>
      <div className={`fam-reveal ${shown ? "in" : ""}`}>
        <p className="fam-intro-script">Tu m&rsquo;as souvent demandé…</p>
        <p className="fam-intro-text">
          «&nbsp;Mais concrètement, tu fais <em>quoi</em>, le soir, sur ton
          ordinateur&nbsp;?&nbsp;» Alors j&rsquo;ai rassemblé ici, tranquillement,
          les réponses — comme si on en parlait à table.
        </p>
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────────────────────────
   FAQ section + accordions
   ───────────────────────────────────────────────────────────── */
type QA = {
  q: string;
  a: React.ReactNode;
  illo?: React.ReactNode;
};

function FaqSection({
  number,
  kicker,
  title,
  items,
  extra,
}: {
  number: string;
  kicker: string;
  title: React.ReactNode;
  items: QA[];
  extra?: React.ReactNode;
}) {
  const { ref, shown } = useReveal<HTMLDivElement>();
  return (
    <section className="fam-section" id={`faq${number}`}>
      <div className="fam-sechead" ref={ref}>
        <div className={`fam-reveal ${shown ? "in" : ""}`}>
          <div className="fam-eyebrow">
            <span className="fam-secnum">{number}</span>
            {kicker}
          </div>
          <h2 className="fam-h2">{title}</h2>
        </div>
      </div>

      <div className="fam-acc">
        {items.map((item, i) => (
          <Accordion
            key={item.q}
            id={`${number}-${i}`}
            qa={item}
            defaultOpen={number === "01" && i === 0}
          />
        ))}
      </div>

      {extra}
    </section>
  );
}

function Accordion({
  id,
  qa,
  defaultOpen = false,
}: {
  id: string;
  qa: QA;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = `fam-panel-${id}`;
  const btnId = `fam-q-${id}`;

  return (
    <div className="fam-acc-item" data-open={open}>
      <h3 className="fam-acc-h">
        <button
          id={btnId}
          className="fam-acc-q"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((o) => !o)}
        >
          <span>{qa.q}</span>
          <span className="fam-acc-icon" aria-hidden>
            <svg viewBox="0 0 20 20" width="20" height="20" fill="none">
              <path
                d="M10 4 V16 M4 10 H16"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </svg>
          </span>
        </button>
      </h3>
      <div id={panelId} className="fam-acc-panel">
        <div className="fam-acc-panel-inner">
          <div className="fam-acc-a">{qa.a}</div>
          {qa.illo && <div className="fam-acc-illo">{qa.illo}</div>}
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   3 — Stats band with animated counters
   ───────────────────────────────────────────────────────────── */
function StatsBand() {
  const { ref, shown } = useReveal<HTMLElement>();
  return (
    <section className="fam-section fam-stats-section" ref={ref}>
      <div className={`fam-reveal ${shown ? "in" : ""}`}>
        <div className="fam-eyebrow fam-eyebrow-center">
          <span className="fam-eyebrow-dot" />
          Là où j&rsquo;en suis
        </div>
        <h2 className="fam-h2 fam-h2-center">
          Ce qui tourne, <em>pendant que je dors.</em>
        </h2>
      </div>

      <div className="fam-stats">
        <Stat run={shown} target={89} label="pays couverts dans le monde" />
        <Stat
          run={shown}
          target={121399}
          label="banques et agences (codes BIC)"
        />
        <Stat
          run={shown}
          target={1190}
          label="institutions suisses (source SIX)"
        />
        <Stat
          run={shown}
          target={50}
          prefix="< "
          suffix=" ms"
          label="par vérification"
        />
      </div>

      <p className="fam-stats-foot">
        Payable <strong>à la pièce</strong>&nbsp;: 0,005&nbsp;$ par vérification.
        Pas d&rsquo;abonnement, pas d&rsquo;engagement.
      </p>
    </section>
  );
}

function Stat({
  run,
  target,
  label,
  prefix = "",
  suffix = "",
}: {
  run: boolean;
  target: number;
  label: string;
  prefix?: string;
  suffix?: string;
}) {
  const [val, setVal] = useState(0);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!run) return;

    const reduce = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (reduce) {
      setVal(target);
      setDone(true);
      return;
    }

    let raf = 0;
    const duration = 1400;
    let start: number | null = null;

    const tick = (ts: number) => {
      if (start === null) start = ts;
      const p = Math.min((ts - start) / duration, 1);
      // easeOutCubic
      const eased = 1 - Math.pow(1 - p, 3);
      setVal(Math.round(target * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
      else setDone(true);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [run, target]);

  const formatted = new Intl.NumberFormat("fr-FR").format(val);

  return (
    <div className="fam-stat">
      <div className="fam-stat-value">
        {done ? prefix : ""}
        {formatted}
        {suffix}
      </div>
      <div className="fam-stat-label">{label}</div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   4 — Outro
   ───────────────────────────────────────────────────────────── */
function Outro() {
  const { ref, shown } = useReveal<HTMLElement>();
  return (
    <footer className="fam-section fam-outro" ref={ref}>
      <div className={`fam-reveal ${shown ? "in" : ""}`}>
        <h2 className="fam-outro-title">Merci d&rsquo;être arrivé jusqu&rsquo;ici.</h2>
        <p className="fam-outro-text">
          Maintenant tu sais ce que je fabrique le soir. Si tu veux le voir en
          vrai, c&rsquo;est juste là&nbsp;:
        </p>

        <div className="fam-cta-row">
          <Link href="/fr" className="fam-cta">
            Voir le site
            <span aria-hidden>→</span>
          </Link>
          <Link href="/fr/playground" className="fam-cta-ghost">
            Tester un IBAN toi-même
          </Link>
        </div>

        <p className="fam-sign">— Claude-Alain</p>
      </div>
    </footer>
  );
}

/* ═════════════════════════════════════════════════════════════
   Illustrations (line art)
   ═════════════════════════════════════════════════════════════ */

/* IBAN card → check */
function IlloVerify() {
  return (
    <svg className="fam-illo-svg" viewBox="0 0 220 120" fill="none" aria-hidden>
      <rect
        x="14"
        y="26"
        width="150"
        height="68"
        rx="12"
        className="fam-illo-stroke"
      />
      <line x1="32" y1="48" x2="116" y2="48" className="fam-illo-stroke-soft" />
      <line x1="32" y1="64" x2="146" y2="64" className="fam-illo-stroke-soft" />
      <line x1="32" y1="80" x2="96" y2="80" className="fam-illo-stroke-soft" />
      <circle cx="178" cy="60" r="26" className="fam-illo-badge" />
      <path
        d="M167 60 L175 68 L190 51"
        className="fam-illo-tick"
        strokeWidth="3.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

/* Typo → money flies off */
function IlloTypo() {
  return (
    <svg className="fam-illo-svg" viewBox="0 0 220 120" fill="none" aria-hidden>
      <text x="16" y="52" className="fam-illo-iban">
        CH93 0076 20
        <tspan className="fam-illo-iban-bad">X</tspan>1 6238…
      </text>
      <path
        d="M24 74 Q 90 96, 150 70 T 206 50"
        className="fam-illo-flow"
        strokeWidth="1.6"
        strokeDasharray="3 6"
        fill="none"
      />
      <path
        d="M198 46 L208 50 L199 57"
        className="fam-illo-stroke"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <circle cx="60" cy="84" r="7" className="fam-illo-coin" />
      <text x="60" y="88" className="fam-illo-coin-t" textAnchor="middle">
        $
      </text>
      <circle cx="118" cy="80" r="6" className="fam-illo-coin" />
      <text x="118" y="84" className="fam-illo-coin-t" textAnchor="middle">
        $
      </text>
    </svg>
  );
}

/* Four audiences */
function IlloPublics() {
  return (
    <svg className="fam-illo-svg" viewBox="0 0 240 120" fill="none" aria-hidden>
      {/* bank */}
      <g className="fam-illo-stroke">
        <path d="M22 56 L40 44 L58 56" fill="none" />
        <path d="M26 56 V76 M34 56 V76 M46 56 V76 M54 56 V76" />
        <path d="M20 80 H60" />
      </g>
      {/* code */}
      <g className="fam-illo-stroke" strokeLinecap="round" strokeLinejoin="round">
        <path d="M96 50 L86 60 L96 70" fill="none" />
        <path d="M114 50 L124 60 L114 70" fill="none" />
        <path d="M108 46 L102 74" />
      </g>
      {/* shield */}
      <g className="fam-illo-stroke" strokeLinecap="round" strokeLinejoin="round">
        <path d="M160 44 L176 50 V62 C176 71 168 77 160 79 C152 77 144 71 144 62 V50 Z" fill="none" />
        <path d="M152 60 L158 66 L168 54" fill="none" />
      </g>
      {/* robot */}
      <g className="fam-illo-stroke-amber" strokeLinecap="round" strokeLinejoin="round">
        <rect x="200" y="52" width="30" height="24" rx="5" fill="none" />
        <circle cx="209" cy="64" r="2.2" className="fam-illo-fill-amber" />
        <circle cx="221" cy="64" r="2.2" className="fam-illo-fill-amber" />
        <path d="M215 44 V52 M209 44 H221" fill="none" />
      </g>
    </svg>
  );
}

/* Toll for robots (light, animated) */
function IlloToll() {
  return (
    <svg className="fam-illo-svg fam-illo-toll" viewBox="0 0 260 130" fill="none" aria-hidden>
      <line x1="0" y1="98" x2="260" y2="98" className="fam-illo-stroke-soft" />
      <g className="fam-illo-stroke-soft">
        {Array.from({ length: 9 }).map((_, i) => (
          <line key={i} x1={12 + i * 28} y1="110" x2={26 + i * 28} y2="110" />
        ))}
      </g>
      {/* gantry */}
      <g className="fam-illo-stroke">
        <rect x="118" y="30" width="6" height="68" rx="2" />
        <rect x="146" y="30" width="6" height="68" rx="2" />
        <rect x="118" y="30" width="34" height="6" rx="2" />
      </g>
      <text x="135" y="26" className="fam-illo-toll-label" textAnchor="middle">
        péage
      </text>
      <line x1="135" y1="40" x2="135" y2="96" className="fam-illo-beam" />
      {/* robot car */}
      <g className="fam-illo-toll-car">
        <rect
          x="0"
          y="74"
          width="46"
          height="24"
          rx="7"
          className="fam-illo-stroke-amber fam-illo-fill-amber-soft"
        />
        <circle cx="12" cy="100" r="5" className="fam-illo-stroke" fill="none" />
        <circle cx="34" cy="100" r="5" className="fam-illo-stroke" fill="none" />
        <circle cx="14" cy="84" r="2" className="fam-illo-fill-amber" />
        <circle cx="24" cy="84" r="2" className="fam-illo-fill-amber" />
      </g>
      {/* coin */}
      <g className="fam-illo-toll-coin">
        <circle r="8" className="fam-illo-fill-amber" />
        <text className="fam-illo-toll-coin-t" textAnchor="middle" y="3">
          $
        </text>
      </g>
      <text x="130" y="126" className="fam-illo-toll-cap" textAnchor="middle">
        passe · paie · repart — en une demi-seconde
      </text>
    </svg>
  );
}

/* IBAN anatomy blocks */
function IbanAnatomy() {
  const { ref, shown } = useReveal<HTMLDivElement>();
  const groups = [
    { label: "Pays", value: "CH", tone: "coral" },
    { label: "Contrôle", value: "93", tone: "amber" },
    { label: "Banque", value: "00762", tone: "sage" },
    { label: "Compte", value: "0116238 52957", tone: "sky" },
  ];

  return (
    <div className="fam-anatomy" ref={ref}>
      <div className={`fam-reveal ${shown ? "in" : ""}`}>
        <div className="fam-anatomy-label">L&rsquo;anatomie d&rsquo;un IBAN suisse</div>
        <div className="fam-anatomy-row">
          {groups.map((g) => (
            <div key={g.label} className={`fam-anatomy-block tone-${g.tone}`}>
              <div className="fam-anatomy-tag">{g.label}</div>
              <div className="fam-anatomy-value">{g.value}</div>
            </div>
          ))}
        </div>
        <p className="fam-anatomy-cap">
          Quatre informations dans une seule suite de caractères. IBANforge sait
          lire et vérifier chacune d&rsquo;elles.
        </p>
      </div>
    </div>
  );
}

/* ═════════════════════════════════════════════════════════════
   Content
   ═════════════════════════════════════════════════════════════ */

const SECTION_COMPRENDRE: QA[] = [
  {
    q: "Bon… c'est quoi IBANforge, en deux mots ?",
    a: (
      <>
        <p>
          Un <strong>vérificateur de numéros de compte bancaire</strong>. Tu lui
          donnes un IBAN — le long numéro qu&rsquo;on tape pour faire un virement
          — et il te répond aussitôt&nbsp;: ce numéro est-il correct&nbsp;? À
          quelle <em>banque</em> appartient-il&nbsp;? Dans quel <em>pays</em>&nbsp;?
        </p>
      </>
    ),
    illo: <IlloVerify />,
  },
  {
    q: "Et pourquoi c'est utile ?",
    a: (
      <>
        <p>
          Parce qu&rsquo;une seule faute de frappe dans ce long numéro — un 7 à la
          place d&rsquo;un 1 — et l&rsquo;argent part chez un{" "}
          <strong>parfait inconnu</strong>. La banque ne peut presque jamais le
          récupérer&nbsp;: elle peut seulement <em>demander gentiment</em> qu&rsquo;on
          le rende. IBANforge vérifie <strong>avant</strong> que le virement parte.
        </p>
      </>
    ),
    illo: <IlloTypo />,
  },
  {
    q: "C'est quoi ce nom bizarre, « IBANforge » ?",
    a: (
      <p>
        <em>IBAN</em>, c&rsquo;est le numéro de compte international. <em>Forge</em>,
        c&rsquo;est l&rsquo;atelier du forgeron. Mets les deux ensemble&nbsp;:
        l&rsquo;atelier où l&rsquo;on vérifie et où l&rsquo;on façonne les IBAN.
      </p>
    ),
  },
  {
    q: "Ça sert à qui ?",
    a: (
      <>
        <p>
          À des <strong>banques et applis</strong> que tu connais peut-être
          (Revolut, Wise…), à des <strong>développeurs</strong>, à des{" "}
          <strong>équipes anti-fraude</strong>. Et, de plus en plus, à des{" "}
          <strong>assistants intelligents</strong> — des «&nbsp;robots&nbsp;» — qui
          doivent payer des factures et vérifier des comptes tout seuls.
        </p>
      </>
    ),
    illo: <IlloPublics />,
  },
];

const SECTION_RASSURER: QA[] = [
  {
    q: "C'est de la crypto ? C'est risqué ?",
    a: (
      <p>
        Le service en lui-même n&rsquo;a <strong>rien d&rsquo;une crypto</strong>.
        Pour le paiement, certains robots utilisent un «&nbsp;dollar
        numérique&nbsp;» stable, l&rsquo;USDC&nbsp;: un jeton vaut{" "}
        <strong>toujours exactement un dollar</strong>. Pas de montagnes russes,
        pas de Bitcoin qui s&rsquo;envole ou s&rsquo;effondre. Rien de spéculatif.
      </p>
    ),
  },
  {
    q: "C'est légal, c'est sérieux ?",
    a: (
      <p>
        Oui. Je m&rsquo;appuie sur des <strong>données publiques officielles</strong>{" "}
        (les registres des banques), sur une formule mathématique vieille de
        trente ans, et sur des paiements parfaitement déclarés. Rien de caché,
        rien de gris.
      </p>
    ),
  },
  {
    q: "Tu gagnes de l'argent avec ?",
    a: (
      <p>
        Un peu&nbsp;: <strong>une fraction de centime</strong> à chaque
        vérification — 0,005&nbsp;$, soit un demi-centime. C&rsquo;est encore
        très modeste, et c&rsquo;est surtout un <em>pari sur l&rsquo;avenir</em>.
        Si beaucoup de robots l&rsquo;utilisent souvent, ça pourra devenir une
        vraie petite activité. On verra bien.
      </p>
    ),
  },
  {
    q: "Tu vas quitter ton travail pour ça ?",
    a: (
      <p>
        Non, rassure-toi. C&rsquo;est un <strong>projet du soir</strong>, à côté.
        Quelque chose à moi, que je construis tranquillement — sans tout miser
        dessus.
      </p>
    ),
  },
];

const SECTION_PARI: QA[] = [
  {
    q: "C'est quoi, ces robots qui paient tout seuls ?",
    a: (
      <>
        <p>
          Imagine un <strong>télépéage d&rsquo;autoroute</strong>. Le véhicule
          passe, le badge est lu, le péage est payé, tout le monde repart — sans
          s&rsquo;arrêter. Là, c&rsquo;est pareil&nbsp;: un robot interroge
          IBANforge, paie une <strong>fraction de centime</strong>, et reçoit sa
          réponse. Sans inscription, sans carte bancaire. C&rsquo;est tout nouveau,
          et c&rsquo;est ce qui m&rsquo;enthousiasme le plus.
        </p>
      </>
    ),
    illo: <IlloToll />,
  },
  {
    q: "Mais pourquoi tu passes tes soirées là-dessus ?",
    a: (
      <p>
        Parce que je <em>connais</em> le sujet — sept ans dans le commerce de
        pièces techniques, à voir des virements partir, arriver, parfois
        disparaître. Parce que c&rsquo;est <strong>concret</strong>&nbsp;: j&rsquo;écris
        du code, je le mets en ligne, et le soir même je vois des requêtes arriver
        d&rsquo;un robot quelque part dans le monde. Et parce que je voulais bâtir{" "}
        <strong>quelque chose à moi</strong>.
      </p>
    ),
  },
];

/* ═════════════════════════════════════════════════════════════
   Page-scoped CSS — warm light, editorial, restrained motion
   ═════════════════════════════════════════════════════════════ */
const PAGE_CSS = `
/* Force a light scheme for this page only (site is dark-mode forced).
   The <style> tag is mounted only while /famille is rendered, so this
   does not leak to the rest of the site. Repaints the root element so the
   overscroll/bounce zone and the scrollbar gutter stay light, not dark. */
html { background: #FBF8F1; color-scheme: light; }
body { background: #FBF8F1; }

.fam {
  --bg: #FBF8F1;
  --bg-2: #F3ECDF;
  --surface: #FFFFFF;
  --ink-1: #211C16;
  --ink-2: #564E42;
  --ink-3: #6E6457;
  --ink-4: #B6AB98;
  --line: rgba(33, 28, 22, 0.10);
  --line-2: rgba(33, 28, 22, 0.16);
  --amber: #B45309;
  --amber-bright: #F59E0B;
  --amber-soft: rgba(245, 158, 11, 0.10);
  --coral: #C2410C;
  --sage: #4D7C0F;
  --sky: #0E7490;
  --green: #15803D;
  --red: #DC2626;

  position: relative;
  min-height: 100vh;
  background: var(--bg);
  color: var(--ink-1);
  overflow: hidden;
  font-family: var(--font-fraunces, "Fraunces", Georgia, serif);
  font-optical-sizing: auto;
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}

/* ── Background decor ── */
.fam-decor { position: absolute; inset: 0; z-index: 0; pointer-events: none; overflow: hidden; }
.fam-glow { position: absolute; border-radius: 50%; filter: blur(130px); }
.fam-glow-1 {
  width: 620px; height: 620px; top: -240px; left: -160px;
  background: radial-gradient(circle, rgba(245,158,11,0.20), transparent 70%);
}
.fam-glow-2 {
  width: 560px; height: 560px; top: 46%; right: -220px;
  background: radial-gradient(circle, rgba(217,119,6,0.12), transparent 70%);
}
.fam-grain {
  position: absolute; inset: 0; opacity: 0.5; mix-blend-mode: multiply;
  background-image: radial-gradient(rgba(120,100,70,0.05) 0.5px, transparent 0.5px);
  background-size: 4px 4px;
}

/* ── Top bar ── */
.fam-topbar {
  position: relative; z-index: 2;
  max-width: 760px; margin: 0 auto;
  padding: 1.5rem 1.5rem 0;
  display: flex; align-items: center; justify-content: space-between;
}
.fam-topbrand {
  display: inline-flex; align-items: center; gap: 0.55rem;
  font-family: var(--font-jetbrains-mono, monospace);
  font-size: 0.82rem; font-weight: 600; letter-spacing: 0.02em;
  color: var(--ink-1); text-decoration: none;
}
.fam-topbrand-mark {
  display: inline-flex; align-items: center; justify-content: center;
  width: 26px; height: 26px; border-radius: 8px;
  background: var(--ink-1); color: var(--bg);
}
.fam-topnote {
  font-family: var(--font-jetbrains-mono, monospace);
  font-size: 0.66rem; letter-spacing: 0.12em; text-transform: uppercase;
  color: var(--ink-3);
}
@media (max-width: 540px) { .fam-topnote { display: none; } }

/* ── Sections ── */
.fam-section {
  position: relative; z-index: 1;
  max-width: 760px; margin: 0 auto;
  padding: 5.5rem 1.5rem;
}
@media (min-width: 768px) { .fam-section { padding: 7rem 2rem; } }

/* ── Eyebrow ── */
.fam-eyebrow {
  display: inline-flex; align-items: center; gap: 0.6rem;
  font-family: var(--font-jetbrains-mono, monospace);
  font-size: 0.7rem; letter-spacing: 0.16em; text-transform: uppercase;
  color: var(--ink-3); margin-bottom: 1.4rem;
}
.fam-eyebrow-center { justify-content: center; }
.fam-eyebrow-dot {
  width: 6px; height: 6px; border-radius: 50%;
  background: var(--amber-bright);
  box-shadow: 0 0 0 4px var(--amber-soft);
  animation: fam-pulse 2.6s ease-in-out infinite;
}
@keyframes fam-pulse {
  0%, 100% { box-shadow: 0 0 0 4px var(--amber-soft); }
  50% { box-shadow: 0 0 0 8px rgba(245,158,11,0); }
}
.fam-secnum {
  font-weight: 700; color: var(--amber);
  letter-spacing: 0.08em;
}

/* ── Headings ── */
.fam-h1 {
  font-weight: 500;
  font-size: clamp(2.6rem, 7vw, 5rem);
  line-height: 0.98; letter-spacing: -0.035em;
  margin: 0 0 1.4rem; color: var(--ink-1);
}
.fam-h1 em { font-style: italic; color: var(--amber); font-variation-settings: "SOFT" 60, "WONK" 1; }

.fam-h2 {
  font-weight: 500;
  font-size: clamp(1.9rem, 4.4vw, 3rem);
  line-height: 1.05; letter-spacing: -0.02em;
  margin: 0; color: var(--ink-1);
}
.fam-h2 em { font-style: italic; color: var(--amber); }
.fam-h2-center { text-align: center; }

/* ── Hero ── */
.fam-hero {
  position: relative; z-index: 1;
  max-width: 760px; margin: 0 auto;
  padding: 4rem 1.5rem 5rem;
  text-align: center;
  min-height: 88vh;
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
}
.fam-hero .fam-eyebrow { justify-content: center; }
.fam-lede {
  font-size: clamp(1.05rem, 2vw, 1.35rem);
  line-height: 1.55; color: var(--ink-2);
  font-style: italic; max-width: 40ch; margin: 0 auto 2.8rem;
}
.fam-scroll {
  position: absolute; bottom: 1.8rem; left: 50%; transform: translateX(-50%);
  display: flex; flex-direction: column; align-items: center; gap: 0.6rem;
  text-decoration: none; color: var(--ink-3);
  font-family: var(--font-jetbrains-mono, monospace);
  font-size: 0.66rem; letter-spacing: 0.16em; text-transform: uppercase;
  animation: fam-bob 2.6s ease-in-out infinite; transition: color 0.2s;
}
.fam-scroll:hover { color: var(--amber); }
@keyframes fam-bob {
  0%, 100% { transform: translate(-50%, 0); }
  50% { transform: translate(-50%, 7px); }
}

/* ── Hero verify card ── */
.fam-card {
  width: 100%; max-width: 480px; margin: 0 auto;
  padding: 1.4rem; text-align: left;
  background: var(--surface);
  border: 1px solid var(--line-2);
  border-radius: 18px;
  box-shadow: 0 22px 50px -28px rgba(80,60,20,0.4);
  transition: box-shadow 0.45s, transform 0.45s;
}
.fam-card.phase-verified {
  box-shadow:
    0 22px 50px -28px rgba(80,60,20,0.4),
    0 0 0 1px rgba(21,128,61,0.30),
    0 0 44px -14px rgba(21,128,61,0.35);
}
.fam-card-label {
  display: inline-flex; align-items: center; gap: 0.5rem;
  font-family: var(--font-jetbrains-mono, monospace);
  font-size: 0.62rem; letter-spacing: 0.16em; text-transform: uppercase;
  color: var(--ink-3); margin-bottom: 0.9rem;
}
.fam-card-label-dot {
  width: 6px; height: 6px; border-radius: 50%;
  background: var(--green); box-shadow: 0 0 0 3px rgba(21,128,61,0.15);
  animation: fam-pulse-g 1.9s infinite;
}
@keyframes fam-pulse-g {
  0%, 100% { box-shadow: 0 0 0 3px rgba(21,128,61,0.15); }
  50% { box-shadow: 0 0 0 7px rgba(21,128,61,0); }
}
.fam-card-screen {
  font-family: var(--font-jetbrains-mono, monospace);
  font-size: clamp(0.85rem, 2.4vw, 1.18rem);
  padding: 1rem 1.1rem; border-radius: 11px;
  background: #FAF6EC; border: 1px solid var(--line);
  display: flex; align-items: center; gap: 0.55rem;
  min-height: 3.2rem; color: var(--ink-1);
}
.fam-card-prompt { color: var(--amber); font-weight: 700; }
.fam-card-text { white-space: nowrap; letter-spacing: 0.01em; }
.fam-card-cursor {
  display: inline-block; margin-left: 1px; color: var(--amber);
  animation: fam-blink 1s step-end infinite;
}
@keyframes fam-blink { 0%, 49% { opacity: 1; } 50%, 100% { opacity: 0; } }
.fam-card-result { margin-top: 0.9rem; min-height: 50px; display: flex; align-items: center; }
.fam-card-check {
  display: flex; align-items: center; gap: 0.8rem; color: var(--green);
  opacity: 0; transform: translateY(5px); transition: opacity 0.4s, transform 0.4s;
}
.fam-card-check.show { opacity: 1; transform: translateY(0); }
.fam-check-circle { stroke-dasharray: 100; stroke-dashoffset: 100; }
.fam-card-check.show .fam-check-circle { animation: fam-draw 0.6s ease-out forwards; }
.fam-check-mark { stroke-dasharray: 36; stroke-dashoffset: 36; }
.fam-card-check.show .fam-check-mark { animation: fam-draw 0.4s 0.42s ease-out forwards; }
@keyframes fam-draw { to { stroke-dashoffset: 0; } }
.fam-card-result-text { display: flex; flex-direction: column; font-family: var(--font-jetbrains-mono, monospace); }
.fam-card-result-text strong { color: var(--green); font-weight: 700; font-size: 0.92rem; letter-spacing: 0.02em; }
.fam-card-result-text span { color: var(--ink-3); font-size: 0.68rem; letter-spacing: 0.05em; }

/* ── Intro note ── */
.fam-intro { padding-top: 2rem; padding-bottom: 2rem; }
.fam-intro-script {
  font-family: var(--font-caveat, cursive);
  font-size: clamp(1.7rem, 4vw, 2.4rem); font-weight: 600;
  color: var(--amber); margin: 0 0 0.6rem;
}
.fam-intro-text {
  font-size: clamp(1.2rem, 2.4vw, 1.55rem); line-height: 1.5;
  color: var(--ink-1); max-width: 30ch; margin: 0;
}
.fam-intro-text em { font-style: italic; color: var(--amber); }

/* ── Reveal ── */
.fam-reveal { opacity: 0; transform: translateY(18px); transition: opacity 0.7s ease, transform 0.7s cubic-bezier(0.22,1,0.36,1); }
.fam-reveal.in { opacity: 1; transform: none; }

/* ── Section head ── */
.fam-sechead { margin-bottom: 2.2rem; }

/* ── Accordion ── */
.fam-acc { border-top: 1px solid var(--line); }
.fam-acc-item { border-bottom: 1px solid var(--line); }
.fam-acc-h { margin: 0; }
.fam-acc-q {
  width: 100%; display: flex; align-items: center; justify-content: space-between;
  gap: 1.2rem; padding: 1.4rem 0.2rem; background: none; border: none; cursor: pointer;
  text-align: left; color: var(--ink-1);
  font-family: var(--font-fraunces, serif);
  font-size: clamp(1.12rem, 2.4vw, 1.4rem); font-weight: 500; line-height: 1.3;
  letter-spacing: -0.01em; transition: color 0.2s;
}
.fam-acc-q:hover { color: var(--amber); }
.fam-acc-q:focus-visible { outline: 2px solid var(--amber); outline-offset: 4px; border-radius: 6px; }
.fam-acc-icon {
  flex-shrink: 0; width: 34px; height: 34px; border-radius: 50%;
  display: inline-flex; align-items: center; justify-content: center;
  border: 1px solid var(--line-2); color: var(--ink-2);
  transition: transform 0.35s cubic-bezier(0.22,1,0.36,1), background 0.25s, color 0.25s, border-color 0.25s;
}
.fam-acc-q:hover .fam-acc-icon { border-color: var(--amber); color: var(--amber); }
.fam-acc-item[data-open="true"] .fam-acc-icon {
  transform: rotate(135deg); background: var(--amber); color: #fff; border-color: var(--amber);
}
.fam-acc-panel {
  display: grid; grid-template-rows: 0fr; visibility: hidden;
  transition: grid-template-rows 0.42s cubic-bezier(0.22,1,0.36,1), visibility 0s linear 0.42s;
}
.fam-acc-item[data-open="true"] .fam-acc-panel {
  grid-template-rows: 1fr; visibility: visible;
  transition: grid-template-rows 0.42s cubic-bezier(0.22,1,0.36,1), visibility 0s;
}
.fam-acc-panel-inner { overflow: hidden; min-height: 0; }
.fam-acc-a {
  font-size: clamp(1.02rem, 2vw, 1.18rem); line-height: 1.62; color: var(--ink-2);
  padding: 0 0 0.4rem; max-width: 62ch;
}
.fam-acc-a p { margin: 0 0 1rem; }
.fam-acc-a p:last-child { margin-bottom: 0; }
.fam-acc-a strong {
  color: var(--ink-1); font-weight: 600;
  background: linear-gradient(180deg, transparent 64%, rgba(245,158,11,0.22) 64%);
  padding: 0 1px;
}
.fam-acc-a em { color: var(--amber); font-style: italic; }
.fam-acc-illo {
  margin: 1rem 0 1.6rem; padding: 1.1rem;
  background: var(--bg-2); border: 1px solid var(--line); border-radius: 13px;
  display: flex; justify-content: center;
}

/* ── Illustrations ── */
.fam-illo-svg { width: 100%; max-width: 280px; height: auto; }
.fam-illo-stroke { stroke: var(--ink-2); stroke-width: 1.6; fill: none; }
.fam-illo-stroke-soft { stroke: var(--ink-4); stroke-width: 1.4; fill: none; }
.fam-illo-stroke-amber { stroke: var(--amber); stroke-width: 1.6; }
.fam-illo-fill-amber { fill: var(--amber); stroke: none; }
.fam-illo-fill-amber-soft { fill: var(--amber-soft); }
.fam-illo-badge { fill: rgba(21,128,61,0.10); stroke: var(--green); stroke-width: 1.6; }
.fam-illo-tick { stroke: var(--green); }
.fam-illo-iban { font-family: var(--font-jetbrains-mono, monospace); font-size: 14px; fill: var(--ink-2); letter-spacing: 0.04em; }
.fam-illo-iban-bad { fill: var(--red); font-weight: 700; }
.fam-illo-flow { stroke: var(--amber); }
.fam-illo-coin { fill: var(--amber-soft); stroke: var(--amber); stroke-width: 1.2; }
.fam-illo-coin-t { font-family: var(--font-jetbrains-mono, monospace); font-size: 8px; fill: var(--amber); font-weight: 700; }
.fam-illo-toll-label { font-family: var(--font-jetbrains-mono, monospace); font-size: 10px; font-weight: 700; letter-spacing: 0.12em; fill: var(--amber); }
.fam-illo-toll-cap { font-family: var(--font-fraunces, serif); font-style: italic; font-size: 11px; fill: var(--ink-3); }
.fam-illo-toll-coin-t { font-family: var(--font-jetbrains-mono, monospace); font-size: 9px; font-weight: 800; fill: #fff; }
.fam-illo-beam { stroke: var(--amber-bright); stroke-width: 2; stroke-dasharray: 3 3; opacity: 0; }
.fam-illo-toll .fam-illo-toll-car { animation: fam-car 4.6s ease-in-out infinite; }
@keyframes fam-car {
  0% { transform: translateX(-50px); }
  38% { transform: translateX(105px); }
  48% { transform: translateX(105px); }
  72% { transform: translateX(220px); }
  100% { transform: translateX(260px); }
}
.fam-illo-toll .fam-illo-toll-coin { transform: translate(135px, 120px); animation: fam-coin 4.6s ease-in-out infinite; opacity: 0; }
@keyframes fam-coin {
  0%, 40% { transform: translate(135px, 110px); opacity: 0; }
  44% { transform: translate(135px, 100px); opacity: 1; }
  58% { transform: translate(135px, 40px); opacity: 1; }
  64%, 100% { transform: translate(135px, 34px); opacity: 0; }
}
.fam-illo-toll .fam-illo-beam { animation: fam-beam 4.6s ease-in-out infinite; }
@keyframes fam-beam {
  0%, 42% { opacity: 0; }
  45%, 55% { opacity: 0.9; }
  58%, 100% { opacity: 0; }
}

/* ── IBAN anatomy ── */
.fam-anatomy {
  margin-top: 2.6rem; padding: 1.8rem 1.4rem;
  background: var(--surface); border: 1px solid var(--line); border-radius: 16px;
}
.fam-anatomy-label {
  font-family: var(--font-jetbrains-mono, monospace);
  font-size: 0.66rem; letter-spacing: 0.16em; text-transform: uppercase;
  color: var(--ink-3); text-align: center; margin-bottom: 1.3rem;
}
.fam-anatomy-row { display: flex; flex-wrap: wrap; gap: 0.5rem; justify-content: center; }
.fam-anatomy-block {
  flex: 1 1 auto; min-width: 78px; padding: 0.9rem; text-align: center;
  border: 1px dashed var(--line-2); border-radius: 10px;
}
.fam-anatomy-block.tone-coral { border-color: rgba(194,65,12,0.5); }
.fam-anatomy-block.tone-amber { border-color: rgba(245,158,11,0.6); }
.fam-anatomy-block.tone-sage { border-color: rgba(77,124,15,0.5); }
.fam-anatomy-block.tone-sky { border-color: rgba(14,116,144,0.5); }
.fam-anatomy-tag {
  font-family: var(--font-jetbrains-mono, monospace);
  font-size: 0.58rem; letter-spacing: 0.14em; text-transform: uppercase;
  font-weight: 600; margin-bottom: 0.5rem;
}
.tone-coral .fam-anatomy-tag { color: var(--coral); }
.tone-amber .fam-anatomy-tag { color: var(--amber); }
.tone-sage .fam-anatomy-tag { color: var(--sage); }
.tone-sky .fam-anatomy-tag { color: var(--sky); }
.fam-anatomy-value {
  font-family: var(--font-jetbrains-mono, monospace);
  font-size: clamp(0.95rem, 2vw, 1.2rem); color: var(--ink-1); font-weight: 500;
}
.fam-anatomy-cap {
  margin: 1.3rem 0 0; text-align: center; font-style: italic;
  color: var(--ink-3); font-size: 0.95rem;
}

/* ── Stats ── */
.fam-stats-section { text-align: center; }
.fam-stats {
  display: grid; grid-template-columns: repeat(2, 1fr); gap: 1rem;
  margin-top: 2.8rem;
}
@media (min-width: 720px) { .fam-stats { grid-template-columns: repeat(4, 1fr); } }
.fam-stat {
  padding: 1.8rem 1rem; background: var(--surface);
  border: 1px solid var(--line); border-radius: 14px;
}
.fam-stat-value {
  font-family: var(--font-jetbrains-mono, monospace);
  font-size: clamp(1.6rem, 4vw, 2.2rem); font-weight: 700;
  color: var(--amber); line-height: 1; letter-spacing: -0.02em;
  margin-bottom: 0.6rem;
}
.fam-stat-label { font-size: 0.92rem; color: var(--ink-3); line-height: 1.4; font-style: italic; }
.fam-stats-foot {
  margin: 2.4rem auto 0; max-width: 42ch; text-align: center;
  font-size: 1.02rem; font-style: italic; color: var(--ink-2);
}
.fam-stats-foot strong { color: var(--ink-1); font-weight: 600; font-style: normal; }

/* ── Outro ── */
.fam-outro {
  text-align: center; border-top: 1px solid var(--line);
  padding-top: 5rem; padding-bottom: 7rem;
}
.fam-outro-title {
  font-family: var(--font-caveat, cursive);
  font-size: clamp(2.4rem, 6vw, 3.6rem); font-weight: 600;
  color: var(--ink-1); margin: 0 0 1.2rem; line-height: 1;
}
.fam-outro-text {
  font-size: 1.15rem; font-style: italic; color: var(--ink-2);
  max-width: 34ch; margin: 0 auto 2.4rem; line-height: 1.55;
}
.fam-cta-row {
  display: flex; flex-direction: column; gap: 0.75rem;
  align-items: center; margin-bottom: 2.6rem;
}
@media (min-width: 520px) { .fam-cta-row { flex-direction: row; justify-content: center; } }
.fam-cta {
  display: inline-flex; align-items: center; gap: 0.65rem;
  padding: 0.95rem 1.6rem; border-radius: 999px;
  background: var(--ink-1); color: var(--bg);
  font-weight: 600; font-size: 1.05rem; text-decoration: none;
  transition: transform 0.2s, box-shadow 0.2s, background 0.2s;
  box-shadow: 0 10px 26px -12px rgba(33,28,22,0.6);
}
.fam-cta:hover { background: var(--amber); transform: translateY(-1px); box-shadow: 0 14px 30px -12px rgba(180,83,9,0.6); }
.fam-cta-ghost {
  display: inline-flex; align-items: center; padding: 0.95rem 1.6rem;
  border-radius: 999px; border: 1px solid var(--line-2); color: var(--ink-2);
  font-size: 1.05rem; text-decoration: none;
  transition: border-color 0.2s, color 0.2s, background 0.2s;
}
.fam-cta-ghost:hover { border-color: var(--amber); color: var(--amber); background: var(--amber-soft); }

/* Consistent, visible focus ring on every interactive link */
.fam-topbrand:focus-visible, .fam-scroll:focus-visible,
.fam-cta:focus-visible, .fam-cta-ghost:focus-visible {
  outline: 2px solid var(--amber); outline-offset: 3px;
}

.fam-sign {
  font-family: var(--font-caveat, cursive);
  font-size: 2.3rem; color: var(--amber); margin: 2.6rem 0 0; font-weight: 600;
}

@media (max-width: 540px) {
  .fam-section { padding: 4.5rem 1.25rem; }
  .fam-card-screen { font-size: 0.78rem; }
}
@media (max-width: 380px) {
  .fam-card-screen { font-size: 0.68rem; padding: 0.8rem 0.85rem; }
}

@media (prefers-reduced-motion: reduce) {
  .fam-reveal { opacity: 1; transform: none; transition: none; }
  .fam-eyebrow-dot, .fam-card-label-dot, .fam-card-cursor,
  .fam-scroll, .fam-illo-toll-car, .fam-illo-toll-coin, .fam-illo-beam {
    animation: none !important;
  }
  .fam-check-circle, .fam-check-mark { animation: none !important; stroke-dashoffset: 0; }
  .fam-acc-panel, .fam-card-check, .fam-acc-icon, .fam-card { transition: none; }
  .fam-illo-beam { opacity: 0; }
}
`;

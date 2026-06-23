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
          extra={
            <>
              <IbanAnatomy />
              <TwentySeconds />
            </>
          }
        />

        <ForWhom />

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
          extra={<Journey />}
        />

        <StatsBand />
        <Outro />
      </main>
    </>
  );
}

/* ─────────────────────────────────────────────────────────────
   Reveal-on-scroll hook (adds an optional 3D-tilt variant `dir`)
   ───────────────────────────────────────────────────────────── */
function useReveal<T extends HTMLElement>(threshold = 0.18) {
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
      { threshold, rootMargin: "0px 0px -8% 0px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [threshold]);

  return { ref, shown };
}

/* ─────────────────────────────────────────────────────────────
   Pointer-tilt hook — drives CSS vars --rx/--ry/--mx/--my on an element.
   Pure transform/opacity, rAF-throttled, reduced-motion safe.
   ───────────────────────────────────────────────────────────── */
function useTilt<T extends HTMLElement>(maxDeg = 9) {
  const ref = useRef<T>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const reduce = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const fine = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
    if (reduce || !fine) return;

    let raf = 0;
    let tx = 0;
    let ty = 0;

    const apply = () => {
      raf = 0;
      el.style.setProperty("--ry", `${tx * maxDeg}deg`);
      el.style.setProperty("--rx", `${-ty * maxDeg}deg`);
      el.style.setProperty("--mx", `${50 + tx * 50}%`);
      el.style.setProperty("--my", `${50 + ty * 50}%`);
    };

    const onMove = (ev: PointerEvent) => {
      const r = el.getBoundingClientRect();
      tx = ((ev.clientX - r.left) / r.width - 0.5) * 2;
      ty = ((ev.clientY - r.top) / r.height - 0.5) * 2;
      if (!raf) raf = requestAnimationFrame(apply);
    };

    const onLeave = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      el.style.setProperty("--ry", "0deg");
      el.style.setProperty("--rx", "0deg");
      el.style.setProperty("--mx", "50%");
      el.style.setProperty("--my", "50%");
    };

    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerleave", onLeave);
    return () => {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerleave", onLeave);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [maxDeg]);

  return ref;
}

/* ─────────────────────────────────────────────────────────────
   Scroll-parallax hook — sets a CSS var --p (-1..1) as the element
   crosses the viewport. Used for subtle multi-layer depth.
   ───────────────────────────────────────────────────────────── */
function useParallax<T extends HTMLElement>() {
  const ref = useRef<T>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const reduce = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (reduce) return;

    let raf = 0;
    const update = () => {
      raf = 0;
      const r = el.getBoundingClientRect();
      const vh = window.innerHeight || 1;
      const center = r.top + r.height / 2;
      const p = Math.max(-1, Math.min(1, (center - vh / 2) / (vh / 2 + r.height / 2)));
      el.style.setProperty("--p", p.toFixed(4));
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };

    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return ref;
}

/* ─────────────────────────────────────────────────────────────
   Background — animated warm gradient mesh + glows + grain
   ───────────────────────────────────────────────────────────── */
function BackgroundDecor() {
  return (
    <div className="fam-decor" aria-hidden>
      <div className="fam-mesh" />
      <div className="fam-glow fam-glow-1" />
      <div className="fam-glow fam-glow-2" />
      <div className="fam-glow fam-glow-3" />
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
   1 — Hero (dimensional swiss-cross centrepiece + tilt parallax)
   ───────────────────────────────────────────────────────────── */
function Hero() {
  const stage = useTilt<HTMLDivElement>(7);
  const parallax = useParallax<HTMLElement>();

  return (
    <header className="fam-hero" ref={parallax}>
      <div className="fam-hero-stage" ref={stage}>
        <div className="fam-hero-depth" aria-hidden>
          <DimensionalCross />
        </div>

        <div className="fam-hero-content">
          <div className="fam-eyebrow fam-stagger" style={{ "--d": "0ms" } as React.CSSProperties}>
            <span className="fam-eyebrow-dot" />
            Pour ma famille &middot; sans jargon
          </div>

          <h1 className="fam-h1 fam-stagger" style={{ "--d": "90ms" } as React.CSSProperties}>
            Tu m&rsquo;as demandé ce que je
            <br />
            <em>fabrique</em> le soir.
          </h1>

          <p className="fam-lede fam-stagger" style={{ "--d": "200ms" } as React.CSSProperties}>
            Voici les questions que tu me poses le plus — avec des réponses
            claires, sans charabia. Bienvenue dans IBANforge.
          </p>

          <div className="fam-stagger" style={{ "--d": "320ms" } as React.CSSProperties}>
            <AnimatedIban />
          </div>
        </div>
      </div>

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

/* Layered, dimensional Swiss cross — the hero's depth centrepiece.
   Five stacked planes on translateZ, a soft floor shadow, a slow float. */
function DimensionalCross() {
  return (
    <div className="fam-cross3d">
      <div className="fam-cross-shadow" />
      <div className="fam-cross-plane fam-cross-p4" />
      <div className="fam-cross-plane fam-cross-p3" />
      <div className="fam-cross-plane fam-cross-p2" />
      <div className="fam-cross-plane fam-cross-p1">
        <svg viewBox="0 0 100 100" width="100%" height="100%" aria-hidden>
          <rect x="40" y="20" width="20" height="60" rx="4" fill="currentColor" />
          <rect x="20" y="40" width="60" height="20" rx="4" fill="currentColor" />
        </svg>
      </div>
      <div className="fam-cross-ring" />
      <div className="fam-cross-ring fam-cross-ring-2" />
    </div>
  );
}

function AnimatedIban() {
  const [phase, setPhase] = useState<"typing" | "pause" | "verified">("typing");
  const [typed, setTyped] = useState("");
  const card = useTilt<HTMLDivElement>(10);

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
    <div className={`fam-card fam-tilt phase-${phase}`} ref={card}>
      <div className="fam-card-sheen" aria-hidden />
      <div className="fam-card-inner">
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
            index={i}
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
  index,
  defaultOpen = false,
}: {
  id: string;
  qa: QA;
  index: number;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const { ref, shown } = useReveal<HTMLDivElement>(0.4);
  const panelId = `fam-panel-${id}`;
  const btnId = `fam-q-${id}`;

  return (
    <div
      className={`fam-acc-item fam-acc-reveal ${shown ? "in" : ""}`}
      data-open={open}
      ref={ref}
      style={{ "--ai": index } as React.CSSProperties}
    >
      <h3 className="fam-acc-h">
        <button
          id={btnId}
          className="fam-acc-q"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((o) => !o)}
        >
          <span className="fam-acc-q-num" aria-hidden>
            {String(index + 1).padStart(2, "0")}
          </span>
          <span className="fam-acc-q-text">{qa.q}</span>
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
   "En 20 secondes" — visual mini-story of the payment flow
   ───────────────────────────────────────────────────────────── */
function TwentySeconds() {
  const { ref, shown } = useReveal<HTMLDivElement>(0.28);
  const card = useTilt<HTMLDivElement>(5);
  const steps = [
    {
      k: "Étape 1",
      t: "Un robot veut payer",
      d: "Avant d'envoyer l'argent, il s'arrête et demande : « ce numéro est-il bon ? »",
    },
    {
      k: "Étape 2",
      t: "IBANforge contrôle",
      d: "Numéro correct ? Quelle banque ? Le destinataire est-il sur une liste à éviter ?",
    },
    {
      k: "Étape 3",
      t: "Verdict : on y va, ou pas",
      d: "Réponse en moins d'une demi-seconde. Le robot décide : envoyer, ou stopper.",
    },
  ];

  return (
    <div className="fam-twenty" ref={ref}>
      <div className={`fam-reveal ${shown ? "in" : ""}`}>
        <div className="fam-eyebrow fam-eyebrow-center">
          <span className="fam-eyebrow-dot" />
          En 20 secondes
        </div>
        <h3 className="fam-twenty-title">
          Ce qui se passe, <em>juste avant un paiement.</em>
        </h3>
      </div>

      <div className={`fam-flow fam-tilt fam-reveal ${shown ? "in" : ""}`} ref={card}>
        <div className="fam-card-sheen fam-flow-sheen" aria-hidden />
        <FlowDiagram />
      </div>

      <div className="fam-twenty-steps">
        {steps.map((s, i) => (
          <div
            key={s.k}
            className={`fam-twenty-step fam-reveal ${shown ? "in" : ""}`}
            style={{ transitionDelay: `${120 + i * 110}ms` }}
          >
            <span className="fam-twenty-step-k">{s.k}</span>
            <strong>{s.t}</strong>
            <p>{s.d}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

/* Animated SVG: agent → IBANforge gate → GO / STOP verdict */
function FlowDiagram() {
  return (
    <svg
      className="fam-flow-svg"
      viewBox="0 0 520 200"
      fill="none"
      role="img"
      aria-label="Un agent envoie un IBAN à IBANforge, qui répond GO ou STOP."
    >
      {/* connecting track */}
      <path
        d="M96 100 H214"
        className="fam-flow-track"
        strokeLinecap="round"
      />
      <path
        d="M306 100 H392"
        className="fam-flow-track"
        strokeLinecap="round"
      />
      {/* travelling packets */}
      <circle className="fam-flow-packet fam-flow-packet-1" r="4.5" cx="0" cy="100" />
      <circle className="fam-flow-packet fam-flow-packet-2" r="4.5" cx="0" cy="100" />

      {/* agent node */}
      <g className="fam-flow-node">
        <rect x="28" y="72" width="68" height="56" rx="13" className="fam-flow-box" />
        <rect x="44" y="88" width="36" height="20" rx="5" className="fam-flow-amber-stroke" fill="none" />
        <circle cx="54" cy="98" r="2.4" className="fam-flow-amber-fill" />
        <circle cx="70" cy="98" r="2.4" className="fam-flow-amber-fill" />
        <path d="M62 78 V88 M54 78 H70" className="fam-flow-amber-stroke" strokeLinecap="round" />
        <text x="62" y="148" className="fam-flow-cap" textAnchor="middle">
          le robot
        </text>
      </g>

      {/* IBANforge gate (depth-layered shield) */}
      <g className="fam-flow-gate">
        <path
          d="M260 56 L300 70 V104 C300 130 282 144 260 152 C238 144 220 130 220 104 V70 Z"
          className="fam-flow-shield-back"
        />
        <path
          d="M260 62 L294 74 V104 C294 126 279 138 260 145 C241 138 226 126 226 104 V74 Z"
          className="fam-flow-shield"
        />
        <path
          d="M247 104 L257 114 L274 92"
          className="fam-flow-shield-tick"
          strokeWidth="3.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
        <text x="260" y="176" className="fam-flow-cap fam-flow-cap-strong" textAnchor="middle">
          IBANforge
        </text>
      </g>

      {/* verdict node */}
      <g className="fam-flow-verdict">
        <rect x="404" y="62" width="88" height="34" rx="9" className="fam-flow-go" />
        <text x="448" y="84" className="fam-flow-verdict-t fam-flow-verdict-go" textAnchor="middle">
          GO ✓
        </text>
        <rect x="404" y="106" width="88" height="34" rx="9" className="fam-flow-stop" />
        <text x="448" y="128" className="fam-flow-verdict-t fam-flow-verdict-stop" textAnchor="middle">
          STOP ✕
        </text>
      </g>
    </svg>
  );
}

/* ─────────────────────────────────────────────────────────────
   "Pour qui c'est" — the audiences, as dimensional cards
   ───────────────────────────────────────────────────────────── */
function ForWhom() {
  const { ref, shown } = useReveal<HTMLDivElement>(0.2);
  const cards = [
    {
      icon: <IconRobot />,
      tone: "amber",
      t: "Les assistants intelligents",
      d: "Ces « robots » qui paient des factures tout seuls. Ils ont besoin d'un garde-fou avant d'envoyer l'argent — c'est le cœur du pari.",
    },
    {
      icon: <IconDev />,
      tone: "sky",
      t: "Les développeurs",
      d: "Celles et ceux qui construisent des applis de paiement et veulent vérifier un IBAN en une ligne de code, sans réinventer la roue.",
    },
    {
      icon: <IconShield />,
      tone: "sage",
      t: "Les équipes anti-fraude",
      d: "Pour repérer un compte douteux ou une personne sur une liste à éviter, avant qu'un virement ne parte.",
    },
  ];

  return (
    <section className="fam-section fam-forwhom" ref={ref} id="pour-qui">
      <div className={`fam-reveal ${shown ? "in" : ""}`}>
        <div className="fam-eyebrow fam-eyebrow-center">
          <span className="fam-eyebrow-dot" />
          Pour qui c&rsquo;est
        </div>
        <h2 className="fam-h2 fam-h2-center">
          Trois personnes qui <em>ne dorment jamais.</em>
        </h2>
        <p className="fam-forwhom-lede">
          IBANforge ne s&rsquo;adresse pas à toi directement — mais à celles et
          ceux qui font circuler l&rsquo;argent, jour et nuit, sans jamais
          se tromper de destinataire.
        </p>
      </div>

      <div className="fam-forwhom-grid">
        {cards.map((c, i) => (
          <ForWhomCard key={c.t} card={c} shown={shown} delay={120 + i * 110} />
        ))}
      </div>
    </section>
  );
}

function ForWhomCard({
  card,
  shown,
  delay,
}: {
  card: { icon: React.ReactNode; tone: string; t: string; d: string };
  shown: boolean;
  delay: number;
}) {
  const ref = useTilt<HTMLDivElement>(8);
  return (
    <div
      className={`fam-fw-card fam-tilt tone-${card.tone} fam-reveal ${shown ? "in" : ""}`}
      ref={ref}
      style={{ transitionDelay: `${delay}ms` }}
    >
      <div className="fam-card-sheen" aria-hidden />
      <div className="fam-fw-card-inner">
        <span className="fam-fw-icon" aria-hidden>
          {card.icon}
        </span>
        <strong className="fam-fw-t">{card.t}</strong>
        <p className="fam-fw-d">{card.d}</p>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   Journey — a small timeline of how this came to be
   ───────────────────────────────────────────────────────────── */
function Journey() {
  const { ref, shown } = useReveal<HTMLDivElement>(0.2);
  const steps = [
    {
      t: "Sept ans dans les pièces techniques",
      d: "À voir passer des virements — partir, arriver, parfois disparaître.",
    },
    {
      t: "Une idée, le soir",
      d: "Et si on vérifiait le numéro avant que l'argent ne parte, plutôt qu'après ?",
    },
    {
      t: "Du code, mis en ligne",
      d: "Une petite API que n'importe quelle machine peut interroger, partout dans le monde.",
    },
    {
      t: "Les premières requêtes",
      d: "Le soir même, je vois un robot quelque part poser sa question. C'est vivant.",
    },
  ];

  return (
    <div className="fam-journey" ref={ref}>
      <div className={`fam-reveal ${shown ? "in" : ""}`}>
        <div className="fam-eyebrow fam-eyebrow-center">
          <span className="fam-eyebrow-dot" />
          Le chemin
        </div>
        <h3 className="fam-twenty-title">
          Comment c&rsquo;est <em>arrivé jusqu&rsquo;ici.</em>
        </h3>
      </div>

      <ol className="fam-timeline">
        {steps.map((s, i) => (
          <li
            key={s.t}
            className={`fam-tl-item fam-reveal ${shown ? "in" : ""}`}
            style={{ transitionDelay: `${120 + i * 120}ms` }}
          >
            <span className="fam-tl-dot" aria-hidden />
            <div className="fam-tl-body">
              <strong>{s.t}</strong>
              <p>{s.d}</p>
            </div>
          </li>
        ))}
      </ol>
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
        <Stat run={shown} target={89} label="pays couverts dans le monde" index={0} />
        <Stat
          run={shown}
          target={121399}
          label="banques et agences (codes BIC)"
          index={1}
        />
        <Stat
          run={shown}
          target={1190}
          label="institutions suisses (source SIX)"
          index={2}
        />
        <Stat
          run={shown}
          target={50}
          prefix="< "
          suffix=" ms"
          label="par vérification"
          index={3}
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
  index = 0,
}: {
  run: boolean;
  target: number;
  label: string;
  prefix?: string;
  suffix?: string;
  index?: number;
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
    <div
      className={`fam-stat fam-reveal ${run ? "in" : ""}`}
      style={{ transitionDelay: `${index * 90}ms` }}
    >
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
        <span className="fam-outro-mark" aria-hidden>
          <svg viewBox="0 0 100 100" width="56" height="56">
            <rect x="40" y="20" width="20" height="60" rx="4" fill="currentColor" />
            <rect x="20" y="40" width="60" height="20" rx="4" fill="currentColor" />
          </svg>
        </span>
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

/* Small inline icons for the "pour qui" cards */
function IconRobot() {
  return (
    <svg viewBox="0 0 40 40" width="34" height="34" fill="none" aria-hidden>
      <rect x="8" y="14" width="24" height="18" rx="6" className="fam-i-stroke" />
      <circle cx="16" cy="23" r="2.4" className="fam-i-fill" />
      <circle cx="24" cy="23" r="2.4" className="fam-i-fill" />
      <path d="M20 6 V14 M14 6 H26" className="fam-i-stroke" strokeLinecap="round" />
      <path d="M8 22 H4 M32 22 H36" className="fam-i-stroke" strokeLinecap="round" />
    </svg>
  );
}
function IconDev() {
  return (
    <svg viewBox="0 0 40 40" width="34" height="34" fill="none" aria-hidden>
      <path d="M15 13 L7 20 L15 27" className="fam-i-stroke" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M25 13 L33 20 L25 27" className="fam-i-stroke" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M22 9 L18 31" className="fam-i-stroke" strokeLinecap="round" />
    </svg>
  );
}
function IconShield() {
  return (
    <svg viewBox="0 0 40 40" width="34" height="34" fill="none" aria-hidden>
      <path
        d="M20 6 L32 11 V20 C32 28 26 33 20 35 C14 33 8 28 8 20 V11 Z"
        className="fam-i-stroke"
        strokeLinejoin="round"
      />
      <path d="M14 20 L18 24 L27 14" className="fam-i-stroke" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* IBAN anatomy blocks */
function IbanAnatomy() {
  const { ref, shown } = useReveal<HTMLDivElement>();
  const tilt = useTilt<HTMLDivElement>(5);
  const groups = [
    { label: "Pays", value: "CH", tone: "coral" },
    { label: "Contrôle", value: "93", tone: "amber" },
    { label: "Banque", value: "00762", tone: "sage" },
    { label: "Compte", value: "0116238 52957", tone: "sky" },
  ];

  return (
    <div className="fam-anatomy-wrap" ref={ref}>
      <div className={`fam-anatomy fam-tilt fam-reveal ${shown ? "in" : ""}`} ref={tilt}>
        <div className="fam-card-sheen" aria-hidden />
        <div className="fam-anatomy-inner">
          <div className="fam-anatomy-label">L&rsquo;anatomie d&rsquo;un IBAN suisse</div>
          <div className="fam-anatomy-row">
            {groups.map((g, i) => (
              <div
                key={g.label}
                className={`fam-anatomy-block tone-${g.tone}`}
                style={{ "--ab": i } as React.CSSProperties}
              >
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
    </div>
  );
}

/* ═════════════════════════════════════════════════════════════
   Content — PRESERVED VERBATIM (Claude-Alain's answers to his family)
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
   Page-scoped CSS — warm light, editorial, dimensional depth
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
  --paper: #FFFDF8;
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
  --swiss: #DC1F2D;
  --swiss-deep: #B71826;

  position: relative;
  min-height: 100vh;
  background: var(--bg);
  color: var(--ink-1);
  overflow: clip;
  font-family: var(--font-hanken, "Hanken Grotesk", ui-sans-serif, system-ui, sans-serif);
  font-optical-sizing: auto;
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}

/* ── Background decor: animated mesh + glows + grain ── */
.fam-decor { position: absolute; inset: 0; z-index: 0; pointer-events: none; overflow: hidden; }
.fam-mesh {
  position: absolute; inset: -20%;
  background:
    radial-gradient(38% 42% at 18% 22%, rgba(245,158,11,0.16), transparent 60%),
    radial-gradient(34% 40% at 82% 30%, rgba(220,31,45,0.07), transparent 62%),
    radial-gradient(46% 50% at 50% 88%, rgba(217,119,6,0.12), transparent 60%),
    radial-gradient(30% 36% at 70% 64%, rgba(245,158,11,0.10), transparent 60%);
  filter: blur(8px);
  animation: fam-mesh 26s ease-in-out infinite alternate;
}
@keyframes fam-mesh {
  0%   { transform: translate3d(0,0,0) scale(1); }
  50%  { transform: translate3d(-2%, 1.5%, 0) scale(1.06); }
  100% { transform: translate3d(2%, -1.5%, 0) scale(1.04); }
}
.fam-glow { position: absolute; border-radius: 50%; filter: blur(130px); }
.fam-glow-1 {
  width: 620px; height: 620px; top: -240px; left: -160px;
  background: radial-gradient(circle, rgba(245,158,11,0.22), transparent 70%);
}
.fam-glow-2 {
  width: 560px; height: 560px; top: 46%; right: -220px;
  background: radial-gradient(circle, rgba(217,119,6,0.13), transparent 70%);
}
.fam-glow-3 {
  width: 480px; height: 480px; bottom: -180px; left: 30%;
  background: radial-gradient(circle, rgba(220,31,45,0.06), transparent 70%);
}
.fam-grain {
  position: absolute; inset: 0; opacity: 0.5; mix-blend-mode: multiply;
  background-image: radial-gradient(rgba(120,100,70,0.05) 0.5px, transparent 0.5px);
  background-size: 4px 4px;
}

/* ── Top bar ── */
.fam-topbar {
  position: relative; z-index: 2;
  max-width: 880px; margin: 0 auto;
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
  font-family: var(--font-fraunces, "Fraunces", Georgia, serif);
  font-weight: 500;
  font-size: clamp(2.6rem, 7vw, 5.2rem);
  line-height: 0.98; letter-spacing: -0.035em;
  margin: 0 0 1.4rem; color: var(--ink-1);
}
.fam-h1 em { font-style: italic; color: var(--amber); font-variation-settings: "SOFT" 60, "WONK" 1; }

.fam-h2 {
  font-family: var(--font-fraunces, "Fraunces", Georgia, serif);
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
  max-width: 860px; margin: 0 auto;
  padding: 3rem 1.5rem 5rem;
  text-align: center;
  min-height: 92vh;
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  perspective: 1400px;
}
.fam-hero-stage {
  position: relative; width: 100%;
  transform-style: preserve-3d;
  transform: rotateX(var(--rx, 0deg)) rotateY(var(--ry, 0deg));
  transition: transform 0.5s cubic-bezier(0.22,1,0.36,1);
  will-change: transform;
}
.fam-hero-content {
  position: relative; z-index: 2; transform-style: preserve-3d;
  /* foreground drifts opposite to the back plane → multi-layer parallax */
  transform: translateY(calc(var(--p, 0) * 14px));
  transition: transform 0.1s linear;
}
.fam-hero-depth {
  position: absolute; left: 0; right: 0; top: -30%;
  display: flex; justify-content: center;
  z-index: 0; pointer-events: none; opacity: 0.92;
  /* scroll-driven parallax: --p (-1..1) lifts the back plane as you scroll past */
  transform: translateZ(-140px) translateY(calc(var(--p, 0) * -52px)) scale(1.15);
  transition: transform 0.1s linear;
}
.fam-hero .fam-eyebrow { justify-content: center; }
.fam-lede {
  font-size: clamp(1.05rem, 2vw, 1.35rem);
  line-height: 1.55; color: var(--ink-2);
  font-style: italic; max-width: 42ch; margin: 0 auto 2.8rem;
}

/* Page-load staggered reveal */
.fam-stagger { opacity: 0; transform: translateY(22px); animation: fam-rise 0.85s cubic-bezier(0.22,1,0.36,1) forwards; animation-delay: var(--d, 0ms); }
@keyframes fam-rise { to { opacity: 1; transform: none; } }

.fam-scroll {
  position: absolute; bottom: 1.4rem; left: 50%; transform: translateX(-50%);
  display: flex; flex-direction: column; align-items: center; gap: 0.6rem;
  text-decoration: none; color: var(--ink-3);
  font-family: var(--font-jetbrains-mono, monospace);
  font-size: 0.66rem; letter-spacing: 0.16em; text-transform: uppercase;
  animation: fam-bob 2.6s ease-in-out infinite; transition: color 0.2s;
  z-index: 3;
}
.fam-scroll:hover { color: var(--amber); }
@keyframes fam-bob {
  0%, 100% { transform: translate(-50%, 0); }
  50% { transform: translate(-50%, 7px); }
}

/* ── Dimensional Swiss cross centrepiece ── */
.fam-cross3d {
  position: relative;
  width: clamp(128px, 19vw, 190px);
  height: clamp(128px, 19vw, 190px);
  transform-style: preserve-3d;
  animation: fam-float 9s ease-in-out infinite;
}
@keyframes fam-float {
  0%, 100% { transform: translateZ(0) rotateZ(-3deg); }
  50% { transform: translateZ(30px) rotateZ(3deg); }
}
.fam-cross-plane {
  position: absolute; inset: 14%;
  border-radius: 22%;
}
.fam-cross-p1 { color: var(--swiss); z-index: 5; transform: translateZ(60px); filter: drop-shadow(0 18px 26px rgba(183,24,38,0.34)); }
.fam-cross-p1 svg { display: block; }
.fam-cross-p2 { background: var(--swiss-deep); opacity: 0.5; transform: translateZ(38px) scale(0.98); border-radius: 26%; }
.fam-cross-p3 { background: var(--amber-bright); opacity: 0.22; transform: translateZ(16px) scale(1.04); border-radius: 30%; }
.fam-cross-p4 { background: var(--amber); opacity: 0.12; transform: translateZ(-8px) scale(1.12); border-radius: 34%; }
.fam-cross-shadow {
  position: absolute; left: 18%; right: 18%; bottom: 2%; height: 28%;
  background: radial-gradient(50% 60% at 50% 50%, rgba(120,40,20,0.30), transparent 72%);
  transform: translateZ(-60px); filter: blur(10px);
}
.fam-cross-ring {
  position: absolute; inset: -2%;
  border: 1.5px solid rgba(245,158,11,0.30);
  border-radius: 50%;
  transform: translateZ(-20px) rotateX(74deg);
  animation: fam-spin 18s linear infinite;
}
.fam-cross-ring-2 {
  inset: 8%;
  border-color: rgba(220,31,45,0.22);
  transform: translateZ(-20px) rotateX(74deg) rotateZ(40deg);
  animation: fam-spin 24s linear infinite reverse;
}
@keyframes fam-spin {
  to { transform: translateZ(-20px) rotateX(74deg) rotateZ(360deg); }
}

/* ── Shared tilt / sheen card primitives ── */
.fam-tilt {
  transform-style: preserve-3d;
  transform: perspective(1100px) rotateX(var(--rx, 0deg)) rotateY(var(--ry, 0deg));
  transition: transform 0.4s cubic-bezier(0.22,1,0.36,1), box-shadow 0.45s;
  will-change: transform;
}
.fam-card-sheen {
  position: absolute; inset: 0; border-radius: inherit; pointer-events: none;
  background: radial-gradient(420px circle at var(--mx, 50%) var(--my, 50%), rgba(255,255,255,0.55), transparent 45%);
  opacity: 0; transition: opacity 0.35s; mix-blend-mode: soft-light; z-index: 3;
}
.fam-tilt:hover .fam-card-sheen { opacity: 1; }

/* ── Hero verify card ── */
.fam-card {
  position: relative;
  width: 100%; max-width: 480px; margin: 2.4rem auto 0;
  background: var(--paper);
  border: 1px solid var(--line-2);
  border-radius: 18px;
  box-shadow: 0 30px 60px -30px rgba(80,60,20,0.45), 0 2px 0 0 rgba(255,255,255,0.6) inset;
}
.fam-card-inner { position: relative; z-index: 2; padding: 1.4rem; text-align: left; }
.fam-card.phase-verified {
  box-shadow:
    0 30px 60px -30px rgba(80,60,20,0.45),
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
  transform: translateZ(20px);
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
  font-family: var(--font-fraunces, "Fraunces", Georgia, serif);
  font-size: clamp(1.3rem, 2.8vw, 1.7rem); line-height: 1.45;
  color: var(--ink-1); max-width: 30ch; margin: 0;
  font-weight: 400;
}
.fam-intro-text em { font-style: italic; color: var(--amber); }

/* ── Reveal ── */
.fam-reveal { opacity: 0; transform: translateY(18px); transition: opacity 0.7s ease, transform 0.7s cubic-bezier(0.22,1,0.36,1); }
.fam-reveal.in { opacity: 1; transform: none; }

/* 3D reveal for accordion items */
.fam-acc-reveal {
  opacity: 0; transform: perspective(900px) rotateX(8deg) translateY(20px);
  transform-origin: top center;
  transition: opacity 0.7s ease, transform 0.7s cubic-bezier(0.22,1,0.36,1);
  transition-delay: calc(var(--ai, 0) * 70ms);
}
.fam-acc-reveal.in { opacity: 1; transform: none; }

/* ── Section head ── */
.fam-sechead { margin-bottom: 2.2rem; }

/* ── Accordion ── */
.fam-acc { border-top: 1px solid var(--line); }
.fam-acc-item { border-bottom: 1px solid var(--line); }
.fam-acc-h { margin: 0; }
.fam-acc-q {
  width: 100%; display: flex; align-items: center; gap: 1rem;
  padding: 1.5rem 0.2rem; background: none; border: none; cursor: pointer;
  text-align: left; color: var(--ink-1);
  font-family: var(--font-fraunces, serif);
  font-size: clamp(1.12rem, 2.4vw, 1.4rem); font-weight: 500; line-height: 1.3;
  letter-spacing: -0.01em; transition: color 0.2s;
}
.fam-acc-q-num {
  flex-shrink: 0;
  font-family: var(--font-jetbrains-mono, monospace);
  font-size: 0.74rem; font-weight: 600; color: var(--ink-4);
  letter-spacing: 0.06em; padding-top: 0.32em;
  transition: color 0.2s;
}
.fam-acc-q-text { flex: 1; }
.fam-acc-q:hover { color: var(--amber); }
.fam-acc-q:hover .fam-acc-q-num { color: var(--amber-bright); }
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
.fam-acc-panel-inner { overflow: hidden; min-height: 0; padding-left: calc(0.74rem + 1rem); }
@media (max-width: 540px) { .fam-acc-panel-inner { padding-left: 0; } }
.fam-acc-a {
  font-size: clamp(1.04rem, 2vw, 1.2rem); line-height: 1.64; color: var(--ink-2);
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

/* ── "En 20 secondes" flow ── */
.fam-twenty { margin-top: 3.6rem; text-align: center; }
.fam-twenty-title {
  font-family: var(--font-fraunces, "Fraunces", Georgia, serif);
  font-weight: 500; font-size: clamp(1.5rem, 3.4vw, 2.1rem);
  line-height: 1.1; letter-spacing: -0.02em; margin: 0 0 0.4rem; color: var(--ink-1);
}
.fam-twenty-title em { font-style: italic; color: var(--amber); }
.fam-flow {
  position: relative;
  margin: 2rem auto 0; max-width: 560px; padding: 1.4rem;
  background: var(--paper); border: 1px solid var(--line-2); border-radius: 18px;
  box-shadow: 0 26px 56px -32px rgba(80,60,20,0.4), 0 2px 0 0 rgba(255,255,255,0.6) inset;
}
.fam-flow-svg { position: relative; z-index: 2; width: 100%; height: auto; display: block; }
.fam-flow-track { stroke: var(--line-2); stroke-width: 2; stroke-dasharray: 4 6; }
.fam-flow-box { fill: rgba(245,158,11,0.06); stroke: var(--amber); stroke-width: 1.6; }
.fam-flow-amber-stroke { stroke: var(--amber); stroke-width: 1.6; }
.fam-flow-amber-fill { fill: var(--amber); }
.fam-flow-cap { font-family: var(--font-jetbrains-mono, monospace); font-size: 11px; letter-spacing: 0.06em; fill: var(--ink-3); text-transform: uppercase; }
.fam-flow-cap-strong { fill: var(--ink-1); font-weight: 700; }
.fam-flow-shield-back { fill: rgba(220,31,45,0.10); stroke: none; }
.fam-flow-shield { fill: rgba(255,255,255,0.6); stroke: var(--swiss); stroke-width: 1.8; }
.fam-flow-shield-tick { stroke: var(--swiss); }
.fam-flow-go { fill: rgba(21,128,61,0.10); stroke: var(--green); stroke-width: 1.4; }
.fam-flow-stop { fill: rgba(220,38,38,0.07); stroke: var(--red); stroke-width: 1.4; }
.fam-flow-verdict-t { font-family: var(--font-jetbrains-mono, monospace); font-size: 13px; font-weight: 700; letter-spacing: 0.04em; }
.fam-flow-verdict-go { fill: var(--green); }
.fam-flow-verdict-stop { fill: var(--red); }
.fam-flow-packet { fill: var(--amber-bright); filter: drop-shadow(0 0 5px rgba(245,158,11,0.7)); opacity: 0; }
.fam-flow-packet-1 { animation: fam-packet-a 4.4s ease-in-out infinite; }
.fam-flow-packet-2 { animation: fam-packet-b 4.4s ease-in-out infinite; animation-delay: 2.2s; }
@keyframes fam-packet-a {
  0% { transform: translateX(96px); opacity: 0; }
  6% { opacity: 1; }
  26% { transform: translateX(214px); opacity: 1; }
  30%, 100% { opacity: 0; }
}
@keyframes fam-packet-b {
  0% { transform: translateX(306px); opacity: 0; }
  6% { opacity: 1; }
  26% { transform: translateX(392px); opacity: 1; }
  30%, 100% { opacity: 0; }
}
.fam-flow-shield, .fam-flow-shield-back { animation: fam-shield-pulse 4.4s ease-in-out infinite; transform-origin: 260px 104px; }
@keyframes fam-shield-pulse {
  0%, 30% { transform: scale(1); }
  40% { transform: scale(1.06); }
  55%, 100% { transform: scale(1); }
}
.fam-flow-go { animation: fam-verdict-go 4.4s ease-in-out infinite; transform-origin: 448px 79px; }
@keyframes fam-verdict-go {
  0%, 52% { opacity: 0.45; transform: scale(1); }
  60% { opacity: 1; transform: scale(1.05); }
  80%, 100% { opacity: 0.7; transform: scale(1); }
}

.fam-twenty-steps {
  display: grid; gap: 1rem; margin-top: 1.6rem; text-align: left;
}
@media (min-width: 680px) { .fam-twenty-steps { grid-template-columns: repeat(3, 1fr); } }
.fam-twenty-step {
  padding: 1.2rem 1.3rem; background: var(--surface);
  border: 1px solid var(--line); border-radius: 14px;
}
.fam-twenty-step-k {
  font-family: var(--font-jetbrains-mono, monospace);
  font-size: 0.62rem; letter-spacing: 0.14em; text-transform: uppercase;
  color: var(--amber); font-weight: 600;
}
.fam-twenty-step strong {
  display: block; margin: 0.45rem 0 0.4rem;
  font-family: var(--font-fraunces, serif); font-size: 1.1rem; font-weight: 500; color: var(--ink-1);
}
.fam-twenty-step p { margin: 0; font-size: 0.96rem; line-height: 1.55; color: var(--ink-2); }

/* ── "Pour qui" ── */
.fam-forwhom { text-align: center; }
.fam-forwhom-lede {
  max-width: 46ch; margin: 1.4rem auto 0;
  font-size: clamp(1.02rem, 2vw, 1.18rem); line-height: 1.6;
  font-style: italic; color: var(--ink-2);
}
.fam-forwhom-grid {
  display: grid; gap: 1rem; margin-top: 2.8rem;
  perspective: 1200px;
}
@media (min-width: 720px) { .fam-forwhom-grid { grid-template-columns: repeat(3, 1fr); } }
.fam-fw-card {
  position: relative; text-align: left;
  background: var(--paper); border: 1px solid var(--line-2);
  border-radius: 18px;
  box-shadow: 0 22px 48px -30px rgba(80,60,20,0.4), 0 1px 0 0 rgba(255,255,255,0.6) inset;
}
.fam-fw-card-inner { position: relative; z-index: 2; padding: 1.6rem 1.4rem; }
.fam-fw-icon {
  display: inline-flex; align-items: center; justify-content: center;
  width: 56px; height: 56px; border-radius: 14px; margin-bottom: 1rem;
  transform: translateZ(28px);
}
.fam-fw-card.tone-amber .fam-fw-icon { background: rgba(245,158,11,0.10); }
.fam-fw-card.tone-sky .fam-fw-icon { background: rgba(14,116,144,0.09); }
.fam-fw-card.tone-sage .fam-fw-icon { background: rgba(77,124,15,0.10); }
.fam-fw-card.tone-amber .fam-i-stroke { stroke: var(--amber); }
.fam-fw-card.tone-amber .fam-i-fill { fill: var(--amber); }
.fam-fw-card.tone-sky .fam-i-stroke { stroke: var(--sky); }
.fam-fw-card.tone-sky .fam-i-fill { fill: var(--sky); }
.fam-fw-card.tone-sage .fam-i-stroke { stroke: var(--sage); }
.fam-fw-card.tone-sage .fam-i-fill { fill: var(--sage); }
.fam-i-stroke { stroke-width: 1.8; fill: none; }
.fam-fw-t {
  display: block; font-family: var(--font-fraunces, serif);
  font-size: 1.22rem; font-weight: 500; color: var(--ink-1);
  margin-bottom: 0.55rem; letter-spacing: -0.01em;
  transform: translateZ(14px);
}
.fam-fw-d { margin: 0; font-size: 0.98rem; line-height: 1.6; color: var(--ink-2); }

/* ── Journey timeline ── */
.fam-journey { margin-top: 3.6rem; text-align: center; }
.fam-timeline {
  list-style: none; margin: 2.2rem auto 0; padding: 0 0 0 1.6rem;
  max-width: 540px; text-align: left;
  border-left: 2px solid var(--line-2);
}
.fam-tl-item { position: relative; padding: 0 0 1.8rem 1rem; }
.fam-tl-item:last-child { padding-bottom: 0; }
.fam-tl-dot {
  position: absolute; left: calc(-1.6rem - 7px); top: 4px;
  width: 14px; height: 14px; border-radius: 50%;
  background: var(--amber-bright); border: 3px solid var(--bg);
  box-shadow: 0 0 0 1px var(--line-2);
}
.fam-tl-body strong {
  display: block; font-family: var(--font-fraunces, serif);
  font-size: 1.12rem; font-weight: 500; color: var(--ink-1); margin-bottom: 0.3rem;
}
.fam-tl-body p { margin: 0; font-size: 0.98rem; line-height: 1.55; color: var(--ink-2); }

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
.fam-anatomy-wrap { margin-top: 2.6rem; perspective: 1100px; }
.fam-anatomy {
  position: relative;
  padding: 0; background: var(--paper); border: 1px solid var(--line); border-radius: 18px;
  box-shadow: 0 22px 48px -30px rgba(80,60,20,0.4), 0 1px 0 0 rgba(255,255,255,0.6) inset;
}
.fam-anatomy-inner { position: relative; z-index: 2; padding: 1.8rem 1.4rem; }
.fam-anatomy-label {
  font-family: var(--font-jetbrains-mono, monospace);
  font-size: 0.66rem; letter-spacing: 0.16em; text-transform: uppercase;
  color: var(--ink-3); text-align: center; margin-bottom: 1.3rem;
}
.fam-anatomy-row { display: flex; flex-wrap: wrap; gap: 0.5rem; justify-content: center; }
.fam-anatomy-block {
  flex: 1 1 auto; min-width: 78px; padding: 0.9rem; text-align: center;
  border: 1px dashed var(--line-2); border-radius: 10px;
  background: rgba(255,255,255,0.5);
  transform: translateZ(calc((var(--ab, 0) + 1) * 6px));
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
  margin-top: 2.8rem; perspective: 1000px;
}
@media (min-width: 720px) { .fam-stats { grid-template-columns: repeat(4, 1fr); } }
.fam-stat {
  padding: 1.8rem 1rem; background: var(--paper);
  border: 1px solid var(--line); border-radius: 16px;
  box-shadow: 0 18px 40px -28px rgba(80,60,20,0.35), 0 1px 0 0 rgba(255,255,255,0.6) inset;
}
.fam-stat.fam-reveal { transform: perspective(900px) rotateX(12deg) translateY(20px); transform-origin: bottom; }
.fam-stat.fam-reveal.in { transform: none; }
.fam-stat-value {
  font-family: var(--font-jetbrains-mono, monospace);
  font-size: clamp(1.6rem, 4vw, 2.2rem); font-weight: 700;
  color: var(--amber); line-height: 1; letter-spacing: -0.02em;
  margin-bottom: 0.6rem; font-variant-numeric: tabular-nums;
}
.fam-stat-label { font-size: 0.92rem; color: var(--ink-3); line-height: 1.4; font-style: italic; }
.fam-stats-foot {
  margin: 2.4rem auto 0; max-width: 42ch; text-align: center;
  font-size: 1.04rem; font-style: italic; color: var(--ink-2);
}
.fam-stats-foot strong { color: var(--ink-1); font-weight: 600; font-style: normal; }

/* ── Outro ── */
.fam-outro {
  text-align: center; border-top: 1px solid var(--line);
  padding-top: 5rem; padding-bottom: 7rem;
}
.fam-outro-mark {
  display: inline-flex; color: var(--swiss); margin-bottom: 1.2rem;
  filter: drop-shadow(0 10px 18px rgba(183,24,38,0.28));
  animation: fam-float 9s ease-in-out infinite;
}
.fam-outro-title {
  font-family: var(--font-caveat, cursive);
  font-size: clamp(2.4rem, 6vw, 3.6rem); font-weight: 600;
  color: var(--ink-1); margin: 0 0 1.2rem; line-height: 1;
}
.fam-outro-text {
  font-size: 1.18rem; font-style: italic; color: var(--ink-2);
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
  .fam-hero-depth { transform: translateZ(-110px) scale(0.8); opacity: 0.7; top: -27%; }
}
@media (max-width: 380px) {
  .fam-card-screen { font-size: 0.68rem; padding: 0.8rem 0.85rem; }
}

@media (prefers-reduced-motion: reduce) {
  .fam-reveal, .fam-acc-reveal, .fam-stagger { opacity: 1; transform: none; transition: none; animation: none; }
  .fam-mesh, .fam-cross3d, .fam-cross-ring, .fam-cross-ring-2, .fam-outro-mark,
  .fam-eyebrow-dot, .fam-card-label-dot, .fam-card-cursor,
  .fam-scroll, .fam-illo-toll-car, .fam-illo-toll-coin, .fam-illo-beam,
  .fam-flow-packet, .fam-flow-packet-1, .fam-flow-packet-2,
  .fam-flow-shield, .fam-flow-shield-back, .fam-flow-go {
    animation: none !important;
  }
  .fam-hero-stage, .fam-tilt, .fam-hero-content { transform: none !important; transition: none; }
  .fam-hero-depth { transform: translateZ(-140px) scale(1.15) !important; transition: none; }
  .fam-cross-p1, .fam-cross-p2, .fam-cross-p3, .fam-cross-p4,
  .fam-card-screen, .fam-fw-icon, .fam-fw-t, .fam-anatomy-block { transform: none !important; }
  .fam-check-circle, .fam-check-mark { animation: none !important; stroke-dashoffset: 0; }
  .fam-acc-panel, .fam-card-check, .fam-acc-icon, .fam-card { transition: none; }
  .fam-illo-beam { opacity: 0; }
  .fam-flow-go { opacity: 0.9; }
}
`;

"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

const IBAN_DEMO = "CH93 0076 2011 6238 5295 7";
const IBAN_TYPO = "CH93 0076 2011 6X38 5295 7";

export function FamilleClient() {
  return (
    <>
      <style>{PAGE_CSS}</style>
      <div className="famille-root">
        <BackgroundDecor />

        <Hero />
        <SectionProbleme />
        <SectionSolution />
        <SectionMecanique />
        <SectionPublics />
        <SectionAgents />
        <SectionPeage />
        <SectionConcurrence />
        <SectionMaintenant />
        <SectionChiffres />
        <SectionPourquoi />
        <SectionMerci />
      </div>
    </>
  );
}

/* ─────────────────────────────────────────────────────────────
   Background — soft warm radial gradients + grain
   ───────────────────────────────────────────────────────────── */
function BackgroundDecor() {
  return (
    <div className="famille-decor" aria-hidden>
      <div className="famille-grain" />
      <div className="famille-glow famille-glow-1" />
      <div className="famille-glow famille-glow-2" />
      <div className="famille-glow famille-glow-3" />
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   1 — Hero
   ───────────────────────────────────────────────────────────── */
function Hero() {
  return (
    <section className="famille-section famille-hero">
      <div className="famille-eyebrow">
        <span className="famille-eyebrow-dot" />
        Une lettre — pour ma famille
      </div>

      <h1 className="famille-h1">
        Voilà ce que je <em>construis</em>
        <br />
        chaque soir.
      </h1>

      <p className="famille-lede">
        Sans jargon. Sans acronymes nus.
        <br />
        L&rsquo;histoire d&rsquo;IBANforge, racontée par celui qui la code.
      </p>

      <AnimatedIban />

      <p className="famille-signature">— Alain</p>

      <a href="#probleme" className="famille-scroll-cue" aria-label="Lire la suite">
        <span>Lire la suite</span>
        <svg width="14" height="22" viewBox="0 0 14 22" fill="none">
          <path
            d="M7 1 V19 M2 14 L7 19 L12 14"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </a>
    </section>
  );
}

function AnimatedIban() {
  const [phase, setPhase] = useState<"typing" | "pause" | "verified">("typing");
  const [typed, setTyped] = useState("");

  useEffect(() => {
    let cancelled = false;
    let timers: ReturnType<typeof setTimeout>[] = [];

    const run = () => {
      if (cancelled) return;
      setTyped("");
      setPhase("typing");

      const chars = IBAN_DEMO.split("");
      chars.forEach((c, i) => {
        const t = setTimeout(() => {
          if (!cancelled) setTyped((s) => s + c);
        }, 70 * i + 200);
        timers.push(t);
      });

      const totalType = 70 * chars.length + 200;
      timers.push(
        setTimeout(() => !cancelled && setPhase("pause"), totalType + 250),
      );
      timers.push(
        setTimeout(() => !cancelled && setPhase("verified"), totalType + 800),
      );
      timers.push(setTimeout(run, totalType + 5500));
    };

    run();

    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
  }, []);

  return (
    <div className={`famille-iban-card phase-${phase}`}>
      <div className="famille-iban-label">
        <span className="famille-iban-label-dot" />
        Vérification en direct
      </div>

      <div className="famille-iban-screen">
        <span className="famille-iban-prompt">$</span>
        <span className="famille-iban-text">
          {typed}
          {phase === "typing" && <span className="famille-iban-cursor">|</span>}
        </span>
      </div>

      <div className="famille-iban-result">
        <div className={`famille-iban-check ${phase === "verified" ? "show" : ""}`}>
          <svg viewBox="0 0 36 36" width="36" height="36" aria-hidden>
            <circle
              cx="18"
              cy="18"
              r="16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              className="famille-check-circle"
            />
            <path
              d="M11 18.5 L16 23.5 L25 13.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="famille-check-mark"
            />
          </svg>
          <div className="famille-iban-result-text">
            <strong>IBAN valide</strong>
            <span>UBS Suisse · Vérifié en 50&nbsp;ms</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   2 — Le problème
   ───────────────────────────────────────────────────────────── */
function SectionProbleme() {
  return (
    <section className="famille-section" id="probleme">
      <div className="famille-eyebrow">Chapitre 1 · Le problème</div>
      <h2 className="famille-h2">
        Une lettre fausse,<br />
        et l&rsquo;argent disparaît.
      </h2>

      <div className="famille-prose">
        <p>
          Quand on fait un virement, on tape un long numéro de compte international.
          <strong> Vingt et un caractères pour la Suisse</strong>. Une seule erreur — un
          7 à la place d&rsquo;un 1, un O à la place d&rsquo;un 0 — et l&rsquo;argent
          part sur le compte de quelqu&rsquo;un d&rsquo;autre.
        </p>
        <p>
          La banque ne peut pas l&rsquo;annuler. Elle peut seulement <em>demander
          gentiment</em> à l&rsquo;inconnu de bien vouloir rembourser. Souvent, ça ne
          revient pas.
        </p>
      </div>

      <IbanTypoDemo />

      <p className="famille-aside">
        <span className="famille-aside-marker">≈</span>
        Les estimations européennes parlent de <strong>plusieurs centaines de millions
        d&rsquo;euros</strong> qui s&rsquo;évaporent ainsi chaque année. Un IBAN tapé,
        même de bonne foi, n&rsquo;a aucun filet de sécurité.
      </p>
    </section>
  );
}

function IbanTypoDemo() {
  return (
    <div className="famille-typo-demo">
      <div className="famille-typo-iban">
        <span>C</span>
        <span>H</span>
        <span>9</span>
        <span>3</span>
        <span className="famille-typo-sep">·</span>
        <span>0</span>
        <span>0</span>
        <span>7</span>
        <span>6</span>
        <span className="famille-typo-sep">·</span>
        <span>2</span>
        <span>0</span>
        <span>1</span>
        <span>1</span>
        <span className="famille-typo-sep">·</span>
        <span>6</span>
        <span className="famille-typo-wrong">X</span>
        <span>3</span>
        <span>8</span>
        <span className="famille-typo-sep">·</span>
        <span>5</span>
        <span>2</span>
        <span>9</span>
        <span>5</span>
        <span className="famille-typo-sep">·</span>
        <span>7</span>
      </div>
      <div className="famille-typo-caption">
        Une lettre de trop. La banque accepte. L&rsquo;argent part.
      </div>
      <svg
        className="famille-typo-arrow"
        viewBox="0 0 280 80"
        fill="none"
        aria-hidden
      >
        <path
          d="M10 40 Q 80 -10, 150 40 T 270 40"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeDasharray="4 6"
          fill="none"
        />
        <path
          d="M260 32 L270 40 L260 48"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      </svg>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   3 — La solution
   ───────────────────────────────────────────────────────────── */
function SectionSolution() {
  return (
    <section className="famille-section">
      <div className="famille-eyebrow">Chapitre 2 · Ma proposition</div>
      <h2 className="famille-h2">
        Un <em>vérificateur</em> de numéros de compte.
      </h2>

      <div className="famille-prose">
        <p>
          C&rsquo;est ça, IBANforge. Vous lui donnez un IBAN, il vous répond en{" "}
          <strong>1/20<sup>e</sup> de seconde</strong> :
        </p>
        <ul className="famille-list">
          <li>
            <span className="famille-list-tick">✓</span>
            <span>Le numéro est-il <strong>mathématiquement correct</strong> ?</span>
          </li>
          <li>
            <span className="famille-list-tick">✓</span>
            <span>Chez <strong>quelle banque</strong> l&rsquo;argent va-t-il atterrir ?</span>
          </li>
          <li>
            <span className="famille-list-tick">✓</span>
            <span>Dans <strong>quel pays</strong>, dans <strong>quelle ville</strong> ?</span>
          </li>
          <li>
            <span className="famille-list-tick">✓</span>
            <span>Y a-t-il un <strong>signal de risque</strong> connu ?</span>
          </li>
        </ul>
        <p>
          Rien de magique. Juste <em>de l&rsquo;arithmétique vieille de 30 ans</em> +
          une base de données de plus de cent vingt mille banques. Mais c&rsquo;est
          utile partout où on bouge de l&rsquo;argent.
        </p>
      </div>

      <IbanAnatomy />
    </section>
  );
}

function IbanAnatomy() {
  const groups = [
    { label: "Pays", value: "CH", color: "var(--fa-coral)" },
    { label: "Contrôle", value: "93", color: "var(--fa-amber)" },
    { label: "Banque", value: "00762", color: "var(--fa-sage)" },
    { label: "Compte", value: "0116238 52957", color: "var(--fa-sky)" },
  ];

  return (
    <div className="famille-anatomy">
      <div className="famille-anatomy-label">Anatomie d&rsquo;un IBAN suisse</div>
      <div className="famille-anatomy-row">
        {groups.map((g) => (
          <div
            key={g.label}
            className="famille-anatomy-block"
            style={{ ["--block-color" as string]: g.color }}
          >
            <div className="famille-anatomy-tag">{g.label}</div>
            <div className="famille-anatomy-value">{g.value}</div>
          </div>
        ))}
      </div>
      <p className="famille-anatomy-caption">
        Quatre informations dans une seule chaîne. IBANforge sait lire et vérifier
        chacune.
      </p>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   4 — Comment ça marche (la conversation)
   ───────────────────────────────────────────────────────────── */
function SectionMecanique() {
  return (
    <section className="famille-section">
      <div className="famille-eyebrow">Chapitre 3 · La conversation</div>
      <h2 className="famille-h2">
        Une question.<br />
        Une réponse.<br />
        Un demi-millième de seconde.
      </h2>

      <MoneyJourney />

      <div className="famille-prose famille-prose-narrow">
        <p>
          Un site web, une banque ou un robot pose la question. IBANforge consulte sa
          base de données, vérifie le numéro avec une vieille formule mathématique
          (mod 97 — vous n&rsquo;avez pas besoin de retenir le nom), et renvoie la
          réponse.
        </p>
        <p>
          Le serveur tient sans broncher <strong>environ deux mille questions par
          seconde</strong>. C&rsquo;est ça, ce qui tourne sur Internet pendant que je
          dors.
        </p>
      </div>
    </section>
  );
}

function MoneyJourney() {
  return (
    <div className="famille-journey" aria-hidden>
      <svg viewBox="0 0 800 220" preserveAspectRatio="xMidYMid meet">
        {/* Sender */}
        <g className="famille-journey-actor">
          <rect x="20" y="60" width="140" height="100" rx="14" />
          <text x="90" y="100" textAnchor="middle" className="famille-journey-title">
            Site / banque
          </text>
          <text x="90" y="125" textAnchor="middle" className="famille-journey-sub">
            ex&nbsp;: Revolut
          </text>
        </g>

        {/* Forge */}
        <g className="famille-journey-forge">
          <rect x="320" y="40" width="160" height="140" rx="18" />
          <text x="400" y="90" textAnchor="middle" className="famille-journey-brand">
            IBANforge
          </text>
          <text x="400" y="115" textAnchor="middle" className="famille-journey-sub">
            121 197 banques
          </text>
          <text x="400" y="135" textAnchor="middle" className="famille-journey-sub">
            75 + pays
          </text>
        </g>

        {/* Receiver */}
        <g className="famille-journey-actor">
          <rect x="640" y="60" width="140" height="100" rx="14" />
          <text x="710" y="100" textAnchor="middle" className="famille-journey-title">
            Réponse
          </text>
          <text x="710" y="125" textAnchor="middle" className="famille-journey-sub">
            ✓ valide / ✗ erroné
          </text>
        </g>

        {/* Path 1 → forge */}
        <path
          d="M165 110 L 315 110"
          stroke="currentColor"
          strokeWidth="1"
          strokeDasharray="4 4"
          fill="none"
          opacity="0.4"
        />
        <path
          d="M485 110 L 635 110"
          stroke="currentColor"
          strokeWidth="1"
          strokeDasharray="4 4"
          fill="none"
          opacity="0.4"
        />

        {/* Animated coins/bubbles */}
        <circle cx="0" cy="110" r="6" className="famille-journey-coin coin-1">
          <animateMotion
            dur="3.6s"
            repeatCount="indefinite"
            path="M165 0 L 315 0"
          />
        </circle>
        <circle cx="0" cy="110" r="5" className="famille-journey-coin coin-2">
          <animateMotion
            dur="3.6s"
            repeatCount="indefinite"
            begin="1.2s"
            path="M165 0 L 315 0"
          />
        </circle>
        <circle cx="0" cy="110" r="6" className="famille-journey-coin coin-3">
          <animateMotion
            dur="3.6s"
            repeatCount="indefinite"
            begin="0.6s"
            path="M485 0 L 635 0"
          />
        </circle>
        <circle cx="0" cy="110" r="5" className="famille-journey-coin coin-4">
          <animateMotion
            dur="3.6s"
            repeatCount="indefinite"
            begin="1.8s"
            path="M485 0 L 635 0"
          />
        </circle>

        {/* Latency badge */}
        <g className="famille-journey-badge">
          <rect x="345" y="186" width="110" height="22" rx="11" />
          <text x="400" y="201" textAnchor="middle">~50 ms</text>
        </g>
      </svg>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   5 — À qui ça sert
   ───────────────────────────────────────────────────────────── */
function SectionPublics() {
  return (
    <section className="famille-section">
      <div className="famille-eyebrow">Chapitre 4 · Les clients</div>
      <h2 className="famille-h2">
        Trois publics — et un quatrième
        <br />
        qui change tout.
      </h2>

      <div className="famille-publics">
        <PublicCard
          number="01"
          icon={<IconBank />}
          title="Les banques et fintechs"
          body="Revolut, Wise, des plateformes de paie, des sites de e-commerce. Tous ceux qui font transiter de l'argent et veulent éviter les erreurs avant le virement."
        />
        <PublicCard
          number="02"
          icon={<IconCode />}
          title="Les développeurs"
          body="Quelqu'un qui construit son projet et a besoin de tester rapidement, sans signer un abonnement à 500 € par mois pour vérifier dix IBAN."
        />
        <PublicCard
          number="03"
          icon={<IconCompliance />}
          title="Les équipes conformité"
          body="Cellules anti-fraude, services KYC, anti-blanchiment. Pour eux, vérifier qu'un IBAN n'est pas un compte écran chez un fournisseur étranger inconnu, c'est le métier."
        />
        <PublicCard
          number="04"
          highlight
          icon={<IconRobot />}
          title="Les agents intelligents"
          body="C'est nouveau. Et c'est ce qui m'intéresse le plus. Les robots qui parlent comme ChatGPT — et qui doivent désormais payer des factures, vérifier des IBAN, tout faire seuls."
        />
      </div>
    </section>
  );
}

function PublicCard({
  number,
  icon,
  title,
  body,
  highlight,
}: {
  number: string;
  icon: React.ReactNode;
  title: string;
  body: string;
  highlight?: boolean;
}) {
  return (
    <div className={`famille-public ${highlight ? "highlight" : ""}`}>
      <div className="famille-public-head">
        <span className="famille-public-num">{number}</span>
        <span className="famille-public-icon">{icon}</span>
      </div>
      <h3>{title}</h3>
      <p>{body}</p>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   6 — Pourquoi les agents IA
   ───────────────────────────────────────────────────────────── */
function SectionAgents() {
  return (
    <section className="famille-section">
      <div className="famille-eyebrow">Chapitre 5 · Le pari</div>
      <h2 className="famille-h2">
        Quand un <em>robot</em> doit
        <br />
        payer un péage.
      </h2>

      <div className="famille-prose famille-prose-narrow">
        <p>
          Imaginez un assistant qui aide votre comptable. Il reçoit une facture, doit
          vérifier l&rsquo;IBAN avant de payer. Mais ce n&rsquo;est pas un humain.
          Il ne peut pas s&rsquo;inscrire à un service avec carte bleue, mot de
          passe et adresse postale.
        </p>
        <p>
          Pendant des décennies, on a payé les services Internet par abonnement
          mensuel. Ça marchait pour les humains. Pour un robot qui interroge un
          service trois fois par mois, c&rsquo;est absurde.
        </p>
        <p>
          Il fallait un autre système. Un système où le robot{" "}
          <strong>paie ce qu&rsquo;il consomme</strong>, à la pièce, à la seconde,
          sans s&rsquo;inscrire nulle part.
        </p>
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────────────────────────
   7 — Le péage automatique (x402)
   ───────────────────────────────────────────────────────────── */
function SectionPeage() {
  return (
    <section className="famille-section famille-section-peage">
      <div className="famille-eyebrow">Chapitre 6 · Le péage automatique</div>
      <h2 className="famille-h2">
        Le robot passe.
        <br />
        Le badge est lu.
        <br />
        <em>Tout le monde repart.</em>
      </h2>

      <TollScene />

      <div className="famille-prose famille-prose-narrow">
        <p>
          C&rsquo;est exactement comme un péage d&rsquo;autoroute en télépéage.
          Le robot envoie sa requête, le serveur répond «&nbsp;tu me dois 0,5 centime,
          paie d&rsquo;abord&nbsp;», le robot paie automatiquement, le serveur livre
          la réponse. Tout dure une demi-seconde.
        </p>
        <p>
          Le mécanisme s&rsquo;appelle officiellement <em>x402</em> (le code 402 est
          un statut HTTP réservé pour ça depuis 1997, jamais vraiment utilisé jusque
          récemment). Le robot paie en <strong>monnaie numérique stable</strong>{" "}
          — concrètement de l&rsquo;USDC, un jeton garanti 1 pour 1 avec le dollar.
          Pas de spéculation, pas de variation : 1 jeton = 1 dollar.
        </p>
        <p className="famille-aside-inline">
          Et chaque centime payé arrive directement sur mon portefeuille en quelques
          secondes. Pas de Stripe, pas de Visa, pas d&rsquo;intermédiaire.
        </p>
      </div>
    </section>
  );
}

function TollScene() {
  return (
    <div className="famille-toll" aria-hidden>
      <svg viewBox="0 0 720 300" preserveAspectRatio="xMidYMid meet">
        {/* Road */}
        <line
          x1="0"
          y1="220"
          x2="720"
          y2="220"
          stroke="currentColor"
          strokeWidth="1"
          opacity="0.3"
        />
        <g className="famille-toll-dashes">
          {Array.from({ length: 18 }).map((_, i) => (
            <line
              key={i}
              x1={20 + i * 40}
              y1="240"
              x2={50 + i * 40}
              y2="240"
              stroke="currentColor"
              strokeWidth="1"
              opacity="0.18"
            />
          ))}
        </g>

        {/* Toll pillars */}
        <g className="famille-toll-pillar">
          <rect x="320" y="40" width="14" height="180" rx="3" />
          <rect x="386" y="40" width="14" height="180" rx="3" />
          <rect x="320" y="40" width="80" height="14" rx="3" />
          <text x="360" y="73" textAnchor="middle" className="famille-toll-label">
            x402
          </text>
        </g>

        {/* Scanner beam */}
        <line
          x1="360"
          y1="55"
          x2="360"
          y2="220"
          stroke="var(--fa-amber)"
          strokeWidth="2"
          strokeDasharray="3 3"
          className="famille-toll-beam"
        />

        {/* Robot car */}
        <g className="famille-toll-car">
          <rect x="0" y="170" width="80" height="50" rx="10" fill="currentColor" opacity="0.12" />
          <rect x="0" y="170" width="80" height="50" rx="10" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <circle cx="18" cy="225" r="9" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <circle cx="62" cy="225" r="9" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <text x="40" y="200" textAnchor="middle" className="famille-toll-car-label">
            🤖
          </text>
        </g>

        {/* Coin */}
        <g className="famille-toll-coin">
          <circle r="11" fill="var(--fa-amber)" opacity="0.95" />
          <text textAnchor="middle" y="4" className="famille-toll-coin-label">$</text>
        </g>

        {/* Caption */}
        <text x="360" y="285" textAnchor="middle" className="famille-toll-caption">
          0,005 $ payés. Réponse livrée. Total&nbsp;: ~ 500 ms.
        </text>
      </svg>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   8 — La concurrence
   ───────────────────────────────────────────────────────────── */
function SectionConcurrence() {
  return (
    <section className="famille-section">
      <div className="famille-eyebrow">Chapitre 7 · La concurrence</div>
      <h2 className="famille-h2">
        Plusieurs centaines d&rsquo;euros par mois.
        <br />
        Ou quelques centimes.
      </h2>

      <div className="famille-prose famille-prose-narrow">
        <p>
          Les outils existants — IBAN.com, Sanction.io, et quelques autres — facturent
          au mois, par abonnement. <strong>Plusieurs centaines d&rsquo;euros</strong>,
          parfois plus. C&rsquo;est rentable pour une grosse banque qui fait des
          millions de virements. Pas pour un petit développeur. Pas pour un robot. Pas
          pour quelqu&rsquo;un qui veut juste tester.
        </p>
        <p>
          IBANforge facture <strong>à la pièce</strong>. Pas d&rsquo;engagement, pas
          d&rsquo;abonnement, pas de minimum.
        </p>
      </div>

      <PriceComparison />
    </section>
  );
}

function PriceComparison() {
  const rows = [
    {
      label: "Outil classique (abonnement mensuel)",
      hundred: "≈ 500 € fixes",
      thousand: "≈ 500 € fixes",
      tone: "muted" as const,
      bar: 1,
    },
    {
      label: "IBANforge (à la pièce)",
      hundred: "0,50 €",
      thousand: "5,00 €",
      tone: "amber" as const,
      bar: 0.01,
    },
  ];

  return (
    <div className="famille-pricing">
      <div className="famille-pricing-row famille-pricing-head">
        <div>Pour un client qui fait…</div>
        <div>100 vérifications / mois</div>
        <div>1 000 vérifications / mois</div>
      </div>
      {rows.map((r) => (
        <div key={r.label} className={`famille-pricing-row tone-${r.tone}`}>
          <div className="famille-pricing-cell">
            <div className="famille-pricing-bar">
              <span style={{ width: `${r.bar * 100}%` }} />
            </div>
            <div>{r.label}</div>
          </div>
          <div className="famille-pricing-cell-num">{r.hundred}</div>
          <div className="famille-pricing-cell-num">{r.thousand}</div>
        </div>
      ))}
      <div className="famille-pricing-foot">
        Pour 100 vérifications par mois&nbsp;: ~ 1 000 fois moins cher.
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   9 — Pourquoi maintenant
   ───────────────────────────────────────────────────────────── */
function SectionMaintenant() {
  return (
    <section className="famille-section">
      <div className="famille-eyebrow">Chapitre 8 · Pourquoi maintenant</div>
      <h2 className="famille-h2">
        Les robots arrivent.
        <br />
        Ils ont besoin d&rsquo;outils.
      </h2>

      <div className="famille-prose famille-prose-narrow">
        <p>
          En 2026, des millions d&rsquo;agents intelligents tournent déjà — pour des
          comptables, des banques, des particuliers, des PME. Ils ne savent pas tout
          faire seuls. Il leur faut des <strong>petits services spécialisés</strong>{" "}
          qui acceptent les micropaiements, qui répondent vite, et qu&rsquo;ils
          peuvent appeler sans inscription.
        </p>
        <p>
          IBANforge est l&rsquo;un des premiers à exister précisément pour ça, sur la
          vérification d&rsquo;IBAN. Si seulement quelques centaines de robots
          l&rsquo;utilisent un million de fois par mois,{" "}
          <strong>c&rsquo;est déjà une vraie activité</strong>.
        </p>
        <p>
          C&rsquo;est ça, le pari. Pas un coup de génie : juste être là, au bon
          moment, avec un service propre et bien fait, sur un sujet que je connais.
        </p>
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────────────────────────
   10 — Les chiffres
   ───────────────────────────────────────────────────────────── */
function SectionChiffres() {
  const stats = [
    { value: "121 197", label: "banques répertoriées (source GLEIF)" },
    { value: "75+", label: "pays couverts dans le monde" },
    { value: "1 190", label: "institutions suisses (source SIX)" },
    { value: "~50 ms", label: "par vérification" },
    { value: "5", label: "endpoints publics" },
    { value: "0,005 $", label: "par appel — payable à la pièce" },
  ];

  return (
    <section className="famille-section">
      <div className="famille-eyebrow">Chapitre 9 · Là où j&rsquo;en suis</div>
      <h2 className="famille-h2">Ce qui tourne, pendant que je dors.</h2>

      <div className="famille-stats">
        {stats.map((s) => (
          <div key={s.label} className="famille-stat">
            <div className="famille-stat-value">{s.value}</div>
            <div className="famille-stat-label">{s.label}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────────────────────────
   11 — Pourquoi je le fais
   ───────────────────────────────────────────────────────────── */
function SectionPourquoi() {
  return (
    <section className="famille-section">
      <div className="famille-eyebrow">Chapitre 10 · Le pourquoi</div>
      <h2 className="famille-h2 famille-h2-script">
        Pourquoi je passe
        <br />
        mes soirées dessus.
      </h2>

      <div className="famille-prose famille-prose-narrow">
        <p>
          Parce que c&rsquo;est un sujet que <em>je connais</em> — j&rsquo;ai passé
          sept ans dans le commerce de pièces techniques, à voir des virements partir,
          arriver, parfois disparaître.
        </p>
        <p>
          Parce que c&rsquo;est <em>petit, concret, mesurable</em>. J&rsquo;écris du
          code, je le mets en ligne, le soir même je vois les requêtes arriver depuis
          un robot quelque part dans le monde. Personne entre moi et le résultat.
        </p>
        <p>
          Parce que c&rsquo;est un <em>pari</em> sur un futur que je crois proche, et
          qu&rsquo;il vaut mieux y être tôt que tard.
        </p>
        <p>
          Et parce que je voulais construire <em>quelque chose à moi</em>, qui dure,
          qu&rsquo;on peut montrer du doigt et dire&nbsp;: ça, c&rsquo;est moi qui
          l&rsquo;ai fait.
        </p>
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────────────────────────
   12 — Merci
   ───────────────────────────────────────────────────────────── */
function SectionMerci() {
  return (
    <section className="famille-section famille-section-merci">
      <h2 className="famille-h2 famille-h2-script">Merci d&rsquo;avoir lu jusqu&rsquo;ici.</h2>

      <p className="famille-merci-lede">
        Maintenant tu sais ce que je construis chaque soir. Si tu veux le voir en
        vrai, c&rsquo;est ici&nbsp;:
      </p>

      <div className="famille-merci-buttons">
        <Link href="/fr" className="famille-cta">
          Voir IBANforge en vrai
          <span aria-hidden>→</span>
        </Link>
        <Link href="/fr/playground" className="famille-cta-ghost">
          Tester un IBAN soi-même
        </Link>
      </div>

      <p className="famille-signature famille-signature-merci">— Alain</p>
    </section>
  );
}

/* ─────────────────────────────────────────────────────────────
   Inline icons
   ───────────────────────────────────────────────────────────── */
function IconBank() {
  return (
    <svg viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <path d="M4 13 L16 5 L28 13" />
      <path d="M6 13 V25 M11 13 V25 M16 13 V25 M21 13 V25 M26 13 V25" />
      <path d="M3 27 H29" />
    </svg>
  );
}
function IconCode() {
  return (
    <svg viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 9 L4 16 L11 23" />
      <path d="M21 9 L28 16 L21 23" />
      <path d="M18 6 L14 26" />
    </svg>
  );
}
function IconCompliance() {
  return (
    <svg viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 4 L26 8 V17 C26 22 21 27 16 28 C11 27 6 22 6 17 V8 Z" />
      <path d="M11 16 L15 20 L22 12" />
    </svg>
  );
}
function IconRobot() {
  return (
    <svg viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="6" y="10" width="20" height="16" rx="3" />
      <circle cx="12" cy="18" r="1.6" fill="currentColor" />
      <circle cx="20" cy="18" r="1.6" fill="currentColor" />
      <path d="M16 4 V10 M12 4 H20" />
      <path d="M2 16 V20 M30 16 V20" />
    </svg>
  );
}

/* ─────────────────────────────────────────────────────────────
   Page-scoped CSS
   ───────────────────────────────────────────────────────────── */
const PAGE_CSS = `
.famille-root {
  --fa-bg: #0a0908;
  --fa-bg-2: #14110d;
  --fa-fg: #f4ede4;
  --fa-fg-2: #d4ccc1;
  --fa-fg-3: #8b8378;
  --fa-fg-4: #5a5448;
  --fa-amber: #f6b53e;
  --fa-amber-deep: #d97706;
  --fa-coral: #ff7e5f;
  --fa-sage: #b6d36b;
  --fa-sky: #82b8e8;
  --fa-line: rgba(244, 237, 228, 0.08);
  --fa-line-strong: rgba(244, 237, 228, 0.16);

  position: relative;
  background: var(--fa-bg);
  color: var(--fa-fg);
  min-height: 100vh;
  overflow: hidden;
  font-family: var(--font-fraunces, "Fraunces", Georgia, serif);
  font-feature-settings: "ss01", "ss02";
  -webkit-font-smoothing: antialiased;
}

.famille-decor {
  position: absolute; inset: 0;
  pointer-events: none; z-index: 0;
  overflow: hidden;
}

.famille-grain {
  position: absolute; inset: -50%;
  opacity: 0.07; mix-blend-mode: overlay;
  background-image:
    radial-gradient(rgba(255,255,255,.65) 1px, transparent 1px),
    radial-gradient(rgba(255,255,255,.4) 1px, transparent 1px);
  background-size: 3px 3px, 5px 5px;
  background-position: 0 0, 1px 2px;
}

.famille-glow {
  position: absolute;
  border-radius: 50%;
  filter: blur(120px);
  opacity: 0.35;
}
.famille-glow-1 {
  width: 600px; height: 600px;
  top: -200px; left: -150px;
  background: radial-gradient(circle, var(--fa-amber-deep), transparent 70%);
}
.famille-glow-2 {
  width: 700px; height: 700px;
  top: 40%; right: -200px;
  background: radial-gradient(circle, #6c2d1a, transparent 70%);
  opacity: 0.45;
}
.famille-glow-3 {
  width: 500px; height: 500px;
  bottom: -100px; left: 30%;
  background: radial-gradient(circle, #44321a, transparent 70%);
  opacity: 0.5;
}

.famille-section {
  position: relative;
  z-index: 1;
  max-width: 920px;
  margin: 0 auto;
  padding: 7rem 1.5rem;
}
@media (min-width: 768px) {
  .famille-section { padding: 9rem 2rem; }
}

.famille-hero {
  padding-top: 5rem;
  padding-bottom: 5rem;
  text-align: center;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}
@media (min-width: 768px) {
  .famille-hero { padding-top: 7rem; }
}

.famille-eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  font-family: var(--font-jetbrains-mono, "JetBrains Mono", monospace);
  font-size: 0.7rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--fa-fg-3);
  margin-bottom: 1.75rem;
}
.famille-eyebrow-dot {
  display: inline-block;
  width: 6px; height: 6px;
  border-radius: 50%;
  background: var(--fa-amber);
  box-shadow: 0 0 0 4px rgba(246, 181, 62, 0.18);
  animation: famille-pulse 2.4s ease-in-out infinite;
}
@keyframes famille-pulse {
  0%, 100% { opacity: 1; box-shadow: 0 0 0 4px rgba(246, 181, 62, 0.18); }
  50% { opacity: 0.5; box-shadow: 0 0 0 8px rgba(246, 181, 62, 0); }
}

.famille-h1 {
  font-family: var(--font-fraunces, "Fraunces", Georgia, serif);
  font-weight: 500;
  font-size: clamp(3rem, 8vw, 6.5rem);
  line-height: 0.95;
  letter-spacing: -0.035em;
  margin: 0 0 1.5rem;
  color: var(--fa-fg);
}
.famille-h1 em {
  font-style: italic;
  color: var(--fa-amber);
  font-variation-settings: "SOFT" 100, "WONK" 1;
}

.famille-h2 {
  font-family: var(--font-fraunces, "Fraunces", Georgia, serif);
  font-weight: 500;
  font-size: clamp(2rem, 4.5vw, 3.5rem);
  line-height: 1.05;
  letter-spacing: -0.02em;
  margin: 0 0 2.5rem;
  color: var(--fa-fg);
}
.famille-h2 em {
  font-style: italic;
  color: var(--fa-amber);
}
.famille-h2-script {
  font-family: var(--font-caveat, "Caveat", cursive);
  font-weight: 600;
  font-size: clamp(2.6rem, 6vw, 4.5rem);
  letter-spacing: 0;
  line-height: 1;
}

.famille-lede {
  font-family: var(--font-fraunces, "Fraunces", Georgia, serif);
  font-size: clamp(1.05rem, 2vw, 1.4rem);
  line-height: 1.55;
  color: var(--fa-fg-2);
  font-style: italic;
  max-width: 36ch;
  margin: 0 auto 3rem;
}

.famille-signature {
  font-family: var(--font-caveat, "Caveat", cursive);
  font-size: 2rem;
  color: var(--fa-amber);
  margin-top: 2.5rem;
  font-weight: 500;
}

.famille-scroll-cue {
  position: absolute;
  bottom: 2.5rem;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.75rem;
  text-decoration: none;
  color: var(--fa-fg-3);
  font-family: var(--font-jetbrains-mono, "JetBrains Mono", monospace);
  font-size: 0.7rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  animation: famille-bob 2.6s ease-in-out infinite;
  transition: color 0.2s;
}
.famille-scroll-cue:hover { color: var(--fa-amber); }
@keyframes famille-bob {
  0%, 100% { transform: translate(-50%, 0); }
  50% { transform: translate(-50%, 8px); }
}

/* ─── IBAN Hero animation ─── */
.famille-iban-card {
  margin: 2rem auto 0;
  max-width: 540px;
  padding: 1.5rem;
  border: 1px solid var(--fa-line-strong);
  border-radius: 18px;
  background: linear-gradient(180deg, rgba(255,255,255,0.025), rgba(255,255,255,0));
  backdrop-filter: blur(8px);
  text-align: left;
  box-shadow: 0 24px 60px -20px rgba(0,0,0,0.7);
  transition: box-shadow 0.4s, border-color 0.4s;
}
.famille-iban-card.phase-verified {
  box-shadow:
    0 24px 60px -20px rgba(0,0,0,0.7),
    0 0 0 1px rgba(132, 204, 22, 0.35),
    0 0 60px -10px rgba(132, 204, 22, 0.4);
}

.famille-iban-label {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  font-family: var(--font-jetbrains-mono, monospace);
  font-size: 0.65rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--fa-fg-3);
  margin-bottom: 1rem;
}
.famille-iban-label-dot {
  width: 6px; height: 6px; border-radius: 50%;
  background: #22c55e;
  box-shadow: 0 0 0 3px rgba(34,197,94,0.18);
  animation: famille-pulse-green 1.8s infinite;
}
@keyframes famille-pulse-green {
  0%, 100% { box-shadow: 0 0 0 3px rgba(34,197,94,0.18); }
  50% { box-shadow: 0 0 0 8px rgba(34,197,94,0); }
}

.famille-iban-screen {
  font-family: var(--font-jetbrains-mono, monospace);
  font-size: clamp(0.95rem, 2.6vw, 1.35rem);
  letter-spacing: 0.02em;
  padding: 1.1rem 1.2rem;
  border-radius: 10px;
  background: rgba(0,0,0,0.45);
  border: 1px solid var(--fa-line);
  display: flex;
  align-items: center;
  gap: 0.6rem;
  min-height: 3.4rem;
}
.famille-iban-prompt {
  color: var(--fa-amber);
  font-weight: 600;
}
.famille-iban-text { color: var(--fa-fg); white-space: nowrap; }
.famille-iban-cursor {
  display: inline-block;
  margin-left: 2px;
  color: var(--fa-amber);
  animation: famille-blink 1s step-end infinite;
}
@keyframes famille-blink {
  0%, 49% { opacity: 1; }
  50%, 100% { opacity: 0; }
}

.famille-iban-result {
  margin-top: 1rem;
  min-height: 56px;
  display: flex; align-items: center; justify-content: flex-start;
}
.famille-iban-check {
  display: flex; align-items: center; gap: 0.85rem;
  color: #84cc16;
  opacity: 0;
  transform: translateY(6px);
  transition: opacity 0.4s, transform 0.4s;
}
.famille-iban-check.show {
  opacity: 1;
  transform: translateY(0);
}
.famille-check-circle {
  stroke-dasharray: 100;
  stroke-dashoffset: 100;
  animation: famille-draw 0.6s ease-out forwards;
}
.famille-iban-check.show .famille-check-circle {
  stroke-dashoffset: 0;
}
.famille-check-mark {
  stroke-dasharray: 36;
  stroke-dashoffset: 36;
  animation: famille-draw 0.4s 0.4s ease-out forwards;
}
.famille-iban-check.show .famille-check-mark {
  stroke-dashoffset: 0;
}
@keyframes famille-draw {
  to { stroke-dashoffset: 0; }
}
.famille-iban-result-text {
  display: flex; flex-direction: column;
  font-family: var(--font-jetbrains-mono, monospace);
  font-size: 0.8rem;
}
.famille-iban-result-text strong {
  color: #84cc16;
  font-weight: 700;
  letter-spacing: 0.04em;
}
.famille-iban-result-text span {
  color: var(--fa-fg-3);
  font-size: 0.72rem;
  letter-spacing: 0.06em;
}

/* ─── Prose ─── */
.famille-prose {
  max-width: 64ch;
  font-family: var(--font-fraunces, Georgia, serif);
  font-size: 1.18rem;
  line-height: 1.65;
  color: var(--fa-fg-2);
}
.famille-prose-narrow {
  max-width: 56ch;
  margin-left: auto; margin-right: auto;
}
.famille-prose p {
  margin: 0 0 1.4rem;
}
.famille-prose strong {
  color: var(--fa-fg);
  font-weight: 600;
  background: linear-gradient(180deg, transparent 65%, rgba(246, 181, 62, 0.18) 65%);
  padding: 0 2px;
}
.famille-prose em {
  color: var(--fa-amber);
  font-style: italic;
}

.famille-list {
  list-style: none;
  padding: 0;
  margin: 1.5rem 0 2rem;
}
.famille-list li {
  display: flex;
  gap: 0.85rem;
  padding: 0.7rem 0;
  border-bottom: 1px solid var(--fa-line);
  align-items: flex-start;
}
.famille-list-tick {
  flex-shrink: 0;
  width: 22px; height: 22px;
  border-radius: 50%;
  background: rgba(132, 204, 22, 0.15);
  color: #84cc16;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 0.7rem;
  font-weight: 700;
  margin-top: 0.2rem;
}

.famille-aside {
  margin: 3rem 0 0;
  padding: 1.5rem 1.75rem;
  border-left: 2px solid var(--fa-amber);
  background: rgba(246, 181, 62, 0.04);
  font-family: var(--font-fraunces, serif);
  font-style: italic;
  color: var(--fa-fg-2);
  font-size: 1.05rem;
  line-height: 1.6;
  display: flex; gap: 1rem; align-items: flex-start;
  border-radius: 0 8px 8px 0;
}
.famille-aside-marker {
  color: var(--fa-amber);
  font-style: normal;
  font-size: 1.3rem;
  font-weight: 600;
  line-height: 1;
}
.famille-aside-inline {
  font-style: italic;
  color: var(--fa-fg-3);
  font-size: 1rem;
  border-left: 2px solid var(--fa-amber);
  padding-left: 1rem;
  margin-top: 1.5rem;
}

/* ─── Typo demo ─── */
.famille-typo-demo {
  margin: 3rem 0 2rem;
  position: relative;
  padding: 2.5rem 1.5rem 3.5rem;
  border: 1px solid var(--fa-line);
  border-radius: 16px;
  background: rgba(0,0,0,0.25);
  text-align: center;
  overflow: hidden;
}
.famille-typo-iban {
  display: inline-flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 4px;
  font-family: var(--font-jetbrains-mono, monospace);
  font-size: clamp(1.1rem, 3vw, 1.6rem);
  letter-spacing: 0.04em;
  margin-bottom: 1.2rem;
}
.famille-typo-iban span {
  color: var(--fa-fg);
  display: inline-block;
}
.famille-typo-sep {
  color: var(--fa-fg-4) !important;
  margin: 0 4px;
}
.famille-typo-wrong {
  color: #ef4444 !important;
  font-weight: 700;
  position: relative;
  animation: famille-shake 1.6s ease-in-out infinite;
}
.famille-typo-wrong::after {
  content: '';
  position: absolute;
  inset: -4px -2px;
  border: 1.5px solid rgba(239, 68, 68, 0.55);
  border-radius: 4px;
  animation: famille-pulse-red 1.6s ease-in-out infinite;
}
@keyframes famille-shake {
  0%, 100% { transform: translateX(0); }
  20% { transform: translateX(-2px); }
  40% { transform: translateX(2px); }
  60% { transform: translateX(-1px); }
  80% { transform: translateX(1px); }
}
@keyframes famille-pulse-red {
  0%, 100% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.5); opacity: 1; }
  50% { box-shadow: 0 0 0 8px rgba(239, 68, 68, 0); opacity: 0.65; }
}
.famille-typo-caption {
  color: var(--fa-fg-3);
  font-style: italic;
  font-size: 0.95rem;
  font-family: var(--font-fraunces, serif);
}
.famille-typo-arrow {
  position: absolute;
  bottom: 8px;
  left: 50%;
  transform: translateX(-50%);
  width: 240px;
  color: var(--fa-fg-4);
  opacity: 0.4;
}

/* ─── IBAN anatomy ─── */
.famille-anatomy {
  margin-top: 3rem;
  padding: 2rem 1.5rem;
  border: 1px solid var(--fa-line);
  border-radius: 16px;
  background: rgba(0,0,0,0.25);
}
.famille-anatomy-label {
  font-family: var(--font-jetbrains-mono, monospace);
  font-size: 0.7rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--fa-fg-3);
  margin-bottom: 1.5rem;
  text-align: center;
}
.famille-anatomy-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  justify-content: center;
}
.famille-anatomy-block {
  flex: 1 1 auto;
  min-width: 80px;
  padding: 1rem;
  border: 1px dashed var(--block-color, var(--fa-line-strong));
  border-radius: 10px;
  text-align: center;
}
.famille-anatomy-tag {
  font-family: var(--font-jetbrains-mono, monospace);
  font-size: 0.6rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--block-color, var(--fa-fg-3));
  margin-bottom: 0.6rem;
  font-weight: 600;
  opacity: 0.85;
}
.famille-anatomy-value {
  font-family: var(--font-jetbrains-mono, monospace);
  font-size: clamp(1rem, 2vw, 1.25rem);
  color: var(--fa-fg);
  font-weight: 500;
  letter-spacing: 0.02em;
}
.famille-anatomy-caption {
  margin: 1.5rem 0 0;
  text-align: center;
  font-style: italic;
  color: var(--fa-fg-3);
  font-size: 0.95rem;
}

/* ─── Money journey ─── */
.famille-journey {
  margin: 3rem auto;
  max-width: 800px;
  color: var(--fa-fg-2);
}
.famille-journey svg { width: 100%; height: auto; }
.famille-journey-actor rect {
  fill: rgba(255,255,255,0.025);
  stroke: var(--fa-line-strong);
  stroke-width: 1;
}
.famille-journey-forge rect {
  fill: rgba(246, 181, 62, 0.06);
  stroke: var(--fa-amber);
  stroke-width: 1.5;
}
.famille-journey-title {
  fill: var(--fa-fg);
  font-family: var(--font-fraunces, serif);
  font-size: 16px;
  font-weight: 500;
}
.famille-journey-brand {
  fill: var(--fa-amber);
  font-family: var(--font-jetbrains-mono, monospace);
  font-size: 18px;
  font-weight: 700;
  letter-spacing: 0.02em;
}
.famille-journey-sub {
  fill: var(--fa-fg-3);
  font-family: var(--font-jetbrains-mono, monospace);
  font-size: 11px;
  letter-spacing: 0.06em;
}
.famille-journey-coin {
  fill: var(--fa-amber);
  filter: drop-shadow(0 0 6px rgba(246,181,62,0.6));
}
.famille-journey-badge rect {
  fill: rgba(246, 181, 62, 0.15);
  stroke: var(--fa-amber);
  stroke-width: 1;
}
.famille-journey-badge text {
  fill: var(--fa-amber);
  font-family: var(--font-jetbrains-mono, monospace);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.05em;
}

/* ─── Publics ─── */
.famille-publics {
  display: grid;
  grid-template-columns: 1fr;
  gap: 1rem;
  margin-top: 2rem;
}
@media (min-width: 700px) {
  .famille-publics { grid-template-columns: repeat(2, 1fr); }
}

.famille-public {
  padding: 1.75rem;
  border: 1px solid var(--fa-line);
  border-radius: 14px;
  background: rgba(255,255,255,0.018);
  transition: transform 0.25s, border-color 0.25s, background 0.25s;
}
.famille-public:hover {
  transform: translateY(-3px);
  border-color: var(--fa-line-strong);
  background: rgba(255,255,255,0.035);
}
.famille-public.highlight {
  border-color: rgba(246, 181, 62, 0.4);
  background: linear-gradient(180deg, rgba(246, 181, 62, 0.08), rgba(246, 181, 62, 0.02));
  position: relative;
}
.famille-public.highlight::before {
  content: 'Le pari';
  position: absolute;
  top: -10px;
  right: 16px;
  padding: 4px 10px;
  background: var(--fa-amber);
  color: #14110d;
  font-family: var(--font-jetbrains-mono, monospace);
  font-size: 0.6rem;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  border-radius: 999px;
}
.famille-public-head {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 1rem;
}
.famille-public-num {
  font-family: var(--font-jetbrains-mono, monospace);
  font-size: 0.7rem;
  letter-spacing: 0.18em;
  color: var(--fa-fg-4);
}
.famille-public-icon {
  width: 36px; height: 36px;
  display: inline-flex; align-items: center; justify-content: center;
  color: var(--fa-amber);
  border: 1px solid rgba(246, 181, 62, 0.25);
  border-radius: 10px;
  background: rgba(246, 181, 62, 0.06);
}
.famille-public-icon svg { width: 20px; height: 20px; }
.famille-public h3 {
  font-family: var(--font-fraunces, serif);
  font-size: 1.4rem;
  font-weight: 500;
  letter-spacing: -0.01em;
  margin: 0 0 0.5rem;
  color: var(--fa-fg);
}
.famille-public p {
  margin: 0;
  font-family: var(--font-fraunces, serif);
  font-size: 1.02rem;
  line-height: 1.55;
  color: var(--fa-fg-2);
}

/* ─── Toll scene ─── */
.famille-toll {
  margin: 3rem auto;
  max-width: 720px;
  color: var(--fa-fg-2);
}
.famille-toll svg { width: 100%; height: auto; }
.famille-toll-pillar rect {
  fill: rgba(255,255,255,0.04);
  stroke: var(--fa-line-strong);
  stroke-width: 1;
}
.famille-toll-label {
  fill: var(--fa-amber);
  font-family: var(--font-jetbrains-mono, monospace);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.16em;
}
.famille-toll-car {
  animation: famille-car-cross 4.4s ease-in-out infinite;
}
@keyframes famille-car-cross {
  0% { transform: translateX(-80px); }
  35% { transform: translateX(280px); }
  45% { transform: translateX(280px); }
  70% { transform: translateX(640px); }
  100% { transform: translateX(720px); }
}
.famille-toll-car-label {
  fill: var(--fa-fg);
  font-family: serif;
  font-size: 22px;
}
.famille-toll-coin {
  animation: famille-coin-fly 4.4s ease-in-out infinite;
  transform: translate(0, 200px);
}
@keyframes famille-coin-fly {
  0%, 35% { transform: translate(360px, 200px); opacity: 0; }
  40% { transform: translate(360px, 195px); opacity: 1; }
  55% { transform: translate(360px, 70px); opacity: 1; }
  62% { transform: translate(360px, 60px); opacity: 0; }
  100% { transform: translate(360px, 60px); opacity: 0; }
}
.famille-toll-coin-label {
  fill: #14110d;
  font-family: var(--font-jetbrains-mono, monospace);
  font-size: 11px;
  font-weight: 800;
}
.famille-toll-beam {
  animation: famille-beam-flash 4.4s ease-in-out infinite;
  opacity: 0;
}
@keyframes famille-beam-flash {
  0%, 40% { opacity: 0; }
  43%, 53% { opacity: 1; }
  56%, 100% { opacity: 0; }
}
.famille-toll-caption {
  fill: var(--fa-fg-3);
  font-family: var(--font-fraunces, serif);
  font-style: italic;
  font-size: 14px;
}

/* ─── Pricing comparison ─── */
.famille-pricing {
  margin: 3rem 0 0;
  border: 1px solid var(--fa-line-strong);
  border-radius: 14px;
  overflow: hidden;
  background: rgba(0,0,0,0.25);
}
.famille-pricing-row {
  display: grid;
  grid-template-columns: 2fr 1fr 1fr;
  gap: 1rem;
  align-items: center;
  padding: 1.1rem 1.25rem;
  border-bottom: 1px solid var(--fa-line);
  font-family: var(--font-fraunces, serif);
}
.famille-pricing-row:last-child { border-bottom: none; }
.famille-pricing-head {
  background: rgba(255,255,255,0.02);
  font-family: var(--font-jetbrains-mono, monospace);
  font-size: 0.7rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--fa-fg-3);
}
.famille-pricing-cell {
  display: flex; flex-direction: column; gap: 0.6rem;
  font-size: 1rem;
}
.famille-pricing-bar {
  height: 6px;
  width: 100%;
  background: rgba(255,255,255,0.05);
  border-radius: 3px;
  overflow: hidden;
}
.famille-pricing-bar span {
  display: block;
  height: 100%;
  background: var(--fa-fg-4);
  border-radius: 3px;
  transition: width 0.6s ease-out;
}
.famille-pricing-row.tone-amber .famille-pricing-bar span {
  background: linear-gradient(90deg, var(--fa-amber), var(--fa-amber-deep));
  box-shadow: 0 0 10px rgba(246, 181, 62, 0.4);
}
.famille-pricing-row.tone-muted {
  color: var(--fa-fg-3);
}
.famille-pricing-row.tone-amber {
  color: var(--fa-fg);
  background: rgba(246, 181, 62, 0.04);
}
.famille-pricing-cell-num {
  font-family: var(--font-jetbrains-mono, monospace);
  font-size: 1.05rem;
  font-weight: 600;
  text-align: right;
}
.famille-pricing-row.tone-amber .famille-pricing-cell-num {
  color: var(--fa-amber);
}
.famille-pricing-foot {
  padding: 1rem 1.25rem;
  font-style: italic;
  color: var(--fa-fg-2);
  font-family: var(--font-fraunces, serif);
  border-top: 1px solid var(--fa-line);
  background: rgba(0,0,0,0.3);
  text-align: center;
  font-size: 0.95rem;
}

/* ─── Stats grid ─── */
.famille-stats {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 1rem;
  margin-top: 3rem;
}
@media (min-width: 700px) {
  .famille-stats { grid-template-columns: repeat(3, 1fr); }
}
.famille-stat {
  padding: 2rem 1.5rem;
  border: 1px solid var(--fa-line);
  border-radius: 12px;
  background: rgba(255,255,255,0.018);
}
.famille-stat-value {
  font-family: var(--font-fraunces, serif);
  font-size: clamp(2rem, 5vw, 2.6rem);
  font-weight: 600;
  letter-spacing: -0.02em;
  color: var(--fa-amber);
  line-height: 1;
  margin-bottom: 0.6rem;
}
.famille-stat-label {
  font-family: var(--font-fraunces, serif);
  font-size: 0.95rem;
  color: var(--fa-fg-3);
  line-height: 1.45;
  font-style: italic;
}

/* ─── Section peage layout ─── */
.famille-section-peage {
  background: linear-gradient(180deg, transparent, rgba(246, 181, 62, 0.03), transparent);
}

/* ─── Merci ─── */
.famille-section-merci {
  text-align: center;
  padding-top: 6rem;
  padding-bottom: 8rem;
  border-top: 1px solid var(--fa-line);
}
.famille-merci-lede {
  font-family: var(--font-fraunces, serif);
  font-size: 1.2rem;
  font-style: italic;
  color: var(--fa-fg-2);
  max-width: 36ch;
  margin: 0 auto 2.5rem;
  line-height: 1.55;
}
.famille-merci-buttons {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  align-items: center;
  margin-bottom: 2.5rem;
}
@media (min-width: 540px) {
  .famille-merci-buttons { flex-direction: row; justify-content: center; }
}

.famille-cta {
  display: inline-flex;
  align-items: center;
  gap: 0.7rem;
  padding: 1rem 1.6rem;
  background: var(--fa-amber);
  color: #14110d;
  border-radius: 999px;
  font-family: var(--font-fraunces, serif);
  font-weight: 600;
  font-size: 1.05rem;
  text-decoration: none;
  transition: transform 0.2s, box-shadow 0.2s, background 0.2s;
  box-shadow: 0 8px 24px -8px rgba(246, 181, 62, 0.5);
}
.famille-cta:hover {
  background: #ffc758;
  transform: translateY(-1px);
  box-shadow: 0 12px 30px -8px rgba(246, 181, 62, 0.7);
}
.famille-cta-ghost {
  display: inline-flex;
  align-items: center;
  padding: 1rem 1.6rem;
  border: 1px solid var(--fa-line-strong);
  border-radius: 999px;
  color: var(--fa-fg-2);
  font-family: var(--font-fraunces, serif);
  font-size: 1.05rem;
  text-decoration: none;
  transition: border-color 0.2s, color 0.2s, background 0.2s;
}
.famille-cta-ghost:hover {
  border-color: var(--fa-amber);
  color: var(--fa-fg);
  background: rgba(246, 181, 62, 0.06);
}

.famille-signature-merci {
  margin-top: 3rem;
  font-size: 2.4rem;
}

@media (max-width: 540px) {
  .famille-section { padding: 5rem 1.25rem; }
  .famille-hero { padding-top: 4rem; padding-bottom: 4rem; }
  .famille-iban-screen { font-size: 0.8rem; padding: 0.85rem 0.9rem; }
}

@media (prefers-reduced-motion: reduce) {
  .famille-iban-cursor,
  .famille-eyebrow-dot,
  .famille-iban-label-dot,
  .famille-typo-wrong,
  .famille-typo-wrong::after,
  .famille-toll-car,
  .famille-toll-coin,
  .famille-toll-beam,
  .famille-scroll-cue,
  .famille-journey-coin {
    animation: none !important;
  }
}
`;

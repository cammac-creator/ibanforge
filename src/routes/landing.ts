// src/routes/landing.ts
import { Hono } from 'hono';
import { html, raw } from 'hono/html';

const landing = new Hono();

landing.get('/', (c) => {
  c.header('Cache-Control', 'public, max-age=3600');

  const playgroundKey = process.env.PLAYGROUND_API_KEY || '';

  const jsonLdWebAPI = JSON.stringify({
    "@context":"https://schema.org",
    "@type":"WebAPI",
    "name":"IBANforge",
    "description":"IBAN validation, BIC/SWIFT lookup, Swiss BC-Nummer clearing, SEPA and VoP compliance, and composite risk scoring API for developers and AI agents.",
    "url":"https://api.ibanforge.com",
    "documentation":"https://api.ibanforge.com/openapi.json",
    "termsOfService":"https://ibanforge.com/terms",
    "provider":{"@type":"Organization","name":"IBANforge","url":"https://ibanforge.com","logo":"https://api.ibanforge.com/og-image.png"},
    "offers":[
      {"@type":"Offer","price":"0","priceCurrency":"USD","description":"Free tier: 200 requests/month with API key"},
      {"@type":"Offer","price":"0.003","priceCurrency":"USD","description":"Pay per call via x402 USDC on Base L2 — no account required"}
    ]
  });

  const jsonLdAPIRef = JSON.stringify({
    "@context":"https://schema.org",
    "@type":"APIReference",
    "name":"IBANforge REST + MCP API",
    "url":"https://api.ibanforge.com/openapi.json",
    "assemblyVersion":"1.1.0",
    "programmingModel":["REST","MCP","x402"],
    "targetPlatform":["HTTP","stdio"],
    "about":{
      "@type":"SoftwareApplication",
      "name":"IBANforge",
      "applicationCategory":"FinancialApplication",
      "operatingSystem":"Any",
      "offers":{"@type":"AggregateOffer","lowPrice":"0.002","highPrice":"0.020","priceCurrency":"USD"}
    }
  });

  const jsonLdFAQ = JSON.stringify({
    "@context":"https://schema.org",
    "@type":"FAQPage",
    "mainEntity":[
      {"@type":"Question","name":"What is IBANforge?","acceptedAnswer":{"@type":"Answer","text":"IBANforge is a REST API for IBAN validation, BIC/SWIFT lookup, Swiss BC-Nummer clearing, SEPA reachability, VoP coverage, and compliance risk scoring. It covers 84 countries with 121K BIC entries sourced from GLEIF and 1,190 Swiss clearing entries from SIX BankMaster."}},
      {"@type":"Question","name":"How much does IBANforge cost?","acceptedAnswer":{"@type":"Answer","text":"IBANforge offers a free tier with 200 requests per month using an API key. Beyond that, pay $0.003 to $0.02 per call using USDC micropayments via the x402 protocol. No subscription required."}},
      {"@type":"Question","name":"Can AI agents use IBANforge?","acceptedAnswer":{"@type":"Answer","text":"Yes. IBANforge is MCP-native with 5 tools for AI agents: validate_iban, batch_validate_iban, lookup_bic, check_compliance, and lookup_ch_clearing. Compatible with Claude, GPT, and any MCP client."}},
      {"@type":"Question","name":"What countries does IBANforge support?","acceptedAnswer":{"@type":"Answer","text":"IBANforge supports 84 countries with full BBAN parsing, SEPA membership detection, Verification of Payee (VoP) status, and country-level risk classification."}}
    ]
  });

  const page = html`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>IBANforge — IBAN Validation & BIC Lookup API for Developers & AI Agents</title>
  <meta name="description" content="Validate IBANs, lookup BICs, score compliance risk in under 40 ms. 121K BICs, 84 countries, Swiss BC-Nummer. Free tier or x402 micropayments. MCP native for AI agents.">
  <meta name="robots" content="index, follow">
  <link rel="canonical" href="https://api.ibanforge.com">
  <meta property="og:title" content="IBANforge — IBAN Validation & BIC Lookup API">
  <meta property="og:description" content="Compliance-grade IBAN intelligence in under 40 ms. 121K BICs, Swiss clearing, sanctions screening, risk scoring. Free tier + x402 micropayments.">
  <meta property="og:type" content="website">
  <meta property="og:url" content="https://api.ibanforge.com">
  <meta property="og:image" content="https://api.ibanforge.com/og-image.png">
  <meta property="og:site_name" content="IBANforge">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="IBANforge — IBAN Validation API">
  <meta name="twitter:description" content="121K BICs. Compliance scoring in 40ms. MCP native. Free or pay-per-call with USDC.">
  <meta name="twitter:image" content="https://api.ibanforge.com/og-image.png">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
  <script type="application/ld+json">${raw(jsonLdWebAPI)}</script>
  <script type="application/ld+json">${raw(jsonLdAPIRef)}</script>
  <script type="application/ld+json">${raw(jsonLdFAQ)}</script>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    :root{
      --bg:#09090b;--bg-1:#0a0a0e;--bg-2:#0f0f13;--bg-3:#13131a;
      --line:#1f1f28;--line-2:#27272a;--line-3:#1a1a1f;
      --ink:#fafafa;--ink-1:#e5e5e5;--ink-2:#a1a1aa;--ink-3:#71717a;--ink-4:#52525b;--ink-5:#3f3f46;
      --amber:#f59e0b;--amber-hi:#fbbf24;--amber-lo:#b45309;
      --green:#22c55e;--red:#ef4444;--rose:#f43f5e;--purple:#a855f7;--cyan:#06b6d4;--blue:#3b82f6;
      --mono:'JetBrains Mono','SF Mono',Monaco,'Cascadia Code',monospace;
    }
    html{scroll-behavior:smooth;scroll-padding-top:72px;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale}
    body{font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;background:var(--bg);color:var(--ink-1);min-height:100vh;overflow-x:hidden}
    ::selection{background:var(--amber);color:#000}
    a{color:inherit}

    .container{max-width:960px;margin:0 auto;padding:0 24px}

    /* ---------- Animations ---------- */
    @keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-8px)}}
    @keyframes pulse-ring{0%{box-shadow:0 0 0 0 rgba(34,197,94,.6)}70%{box-shadow:0 0 0 10px rgba(34,197,94,0)}100%{box-shadow:0 0 0 0 rgba(34,197,94,0)}}
    @keyframes caret{0%,45%{opacity:1}55%,100%{opacity:0}}
    @keyframes shimmer{0%{background-position:-200% 0}100%{background-position:200% 0}}
    @keyframes spin{to{transform:rotate(360deg)}}
    @keyframes orbit{0%{transform:translate(-50%,-50%) rotate(0deg) translateX(140px) rotate(0deg)}100%{transform:translate(-50%,-50%) rotate(360deg) translateX(140px) rotate(-360deg)}}

    .reveal{opacity:0;transform:translateY(24px);transition:opacity .7s cubic-bezier(.2,.8,.2,1),transform .7s cubic-bezier(.2,.8,.2,1)}
    .reveal.in{opacity:1;transform:none}

    /* ---------- Nav ---------- */
    .nav{position:sticky;top:0;z-index:50;background:rgba(9,9,11,.7);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);border-bottom:1px solid transparent;padding:0 24px;transition:background .25s ease,border-color .25s ease,box-shadow .25s ease}
    .nav.scrolled{background:rgba(9,9,11,.92);border-bottom-color:var(--line);box-shadow:0 8px 32px rgba(0,0,0,.4)}
    .nav-inner{max-width:960px;margin:0 auto;display:flex;align-items:center;justify-content:space-between;height:60px}
    .nav-logo{font-size:18px;font-weight:800;color:var(--ink);text-decoration:none;letter-spacing:-.02em}
    .nav-logo span{color:var(--amber)}
    .nav-links{display:flex;gap:24px;align-items:center}
    .nav-links a{font-size:13px;color:var(--ink-3);text-decoration:none;transition:color .15s}
    .nav-links a:hover{color:var(--ink-1)}
    .nav-site{font-size:12px;color:var(--ink-4);padding:5px 12px;border:1px solid var(--line-2);border-radius:6px;text-decoration:none;transition:all .15s}
    .nav-site:hover{color:var(--amber);border-color:rgba(245,158,11,.33)}

    /* ---------- Hero ---------- */
    .hero{position:relative;overflow:hidden}
    .hero-bg{position:absolute;inset:0;pointer-events:none;z-index:0}
    .hero-bg::before,.hero-bg::after{content:'';position:absolute;width:640px;height:640px;border-radius:50%;filter:blur(140px);opacity:.14;animation:float 14s ease-in-out infinite}
    .hero-bg::before{background:var(--amber);top:-240px;left:-220px}
    .hero-bg::after{background:var(--red);bottom:-320px;right:-220px;animation-delay:-7s}
    .hero-grid{position:relative;z-index:1;display:grid;grid-template-columns:1.05fr 1fr;gap:48px;align-items:center;padding:72px 0 56px}
    @media(max-width:820px){.hero-grid{grid-template-columns:1fr;padding:48px 0 32px;gap:32px}}
    .hero-copy .hero-badges{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:24px}
    .hero-badge{background:var(--bg-2);padding:5px 12px;border-radius:99px;font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;border:1px solid var(--line)}
    .hero-badge.amber{color:var(--amber);border-color:rgba(245,158,11,.28);background:rgba(245,158,11,.06)}
    .hero-badge.green{color:var(--green);border-color:rgba(34,197,94,.28);background:rgba(34,197,94,.06)}
    .hero-badge.swiss{color:#f87171;border-color:rgba(239,68,68,.33);background:rgba(239,68,68,.08)}
    .hero-copy h1{font-size:56px;letter-spacing:-.022em;line-height:1.02;color:var(--ink);margin-bottom:20px;font-weight:800}
    .hero-copy h1 .glow{position:relative;color:var(--amber)}
    .hero-copy h1 .glow::after{content:'';position:absolute;inset:-8px -14px;background:radial-gradient(ellipse at center,rgba(245,158,11,.32),transparent 70%);z-index:-1;filter:blur(16px);pointer-events:none}
    @media(max-width:820px){.hero-copy h1{font-size:40px}}
    .hero-copy .lede{font-size:18px;color:var(--ink-2);line-height:1.55;margin-bottom:24px;max-width:540px}
    .hero-copy .lede strong{color:var(--ink);font-weight:600}
    .hero-moat{display:flex;align-items:flex-start;gap:12px;padding:14px 18px;border:1px solid rgba(239,68,68,.28);border-radius:12px;background:linear-gradient(135deg,rgba(239,68,68,.08),rgba(9,9,11,.4));font-size:13px;line-height:1.5;color:var(--ink-1);margin-bottom:28px;max-width:540px}
    .hero-moat-flag{width:18px;height:18px;border-radius:3px;background:#dc1f2d;position:relative;flex-shrink:0;margin-top:1px}
    .hero-moat-flag::before,.hero-moat-flag::after{content:'';position:absolute;background:#fff}
    .hero-moat-flag::before{left:7px;top:3px;width:4px;height:12px}
    .hero-moat-flag::after{left:3px;top:7px;width:12px;height:4px}
    .hero-moat strong{color:#f87171;font-weight:600}
    .hero-ctas{display:flex;gap:10px;flex-wrap:wrap}
    .cta{padding:12px 22px;border-radius:10px;font-weight:600;font-size:14.5px;text-decoration:none;cursor:pointer;border:none;transition:all .18s ease;display:inline-flex;align-items:center;gap:8px;font-family:inherit}
    .cta-primary{background:var(--amber);color:#000;box-shadow:0 8px 24px -8px rgba(245,158,11,.55)}.cta-primary:hover{background:var(--amber-hi);transform:translateY(-1px);box-shadow:0 12px 28px -10px rgba(245,158,11,.7)}
    .cta-secondary{background:transparent;color:var(--amber);border:1px solid rgba(245,158,11,.4)}.cta-secondary:hover{border-color:var(--amber);background:rgba(245,158,11,.05)}
    .cta-tertiary{background:transparent;color:var(--ink-2);border:1px solid var(--line-2)}.cta-tertiary:hover{color:var(--ink-1);border-color:var(--ink-4)}
    .cta .arrow{transition:transform .2s ease}.cta:hover .arrow{transform:translateX(3px)}

    /* ---------- Hero demo terminal ---------- */
    .hero-demo{background:linear-gradient(145deg,var(--bg-2),var(--bg-3));border:1px solid var(--line);border-radius:16px;overflow:hidden;position:relative;box-shadow:0 24px 48px -16px rgba(0,0,0,.6),0 0 0 1px rgba(245,158,11,.04)}
    .hero-demo::before{content:'';position:absolute;inset:0;background:linear-gradient(135deg,rgba(245,158,11,.06),transparent 45%);pointer-events:none}
    .hero-demo-head{display:flex;align-items:center;gap:7px;padding:12px 18px;border-bottom:1px solid var(--line);background:var(--bg-1);position:relative;z-index:1}
    .demo-dot{width:10px;height:10px;border-radius:50%;background:var(--line-2)}
    .demo-dot.live{background:var(--green);animation:pulse-ring 2s infinite}
    .hero-demo-label{margin-left:auto;font-size:10.5px;letter-spacing:.12em;color:var(--ink-3);text-transform:uppercase;font-family:var(--mono)}
    .hero-demo-body{padding:18px 20px;font-family:var(--mono);font-size:12.5px;line-height:1.65;min-height:320px;position:relative;z-index:1}
    .hero-demo-input{display:flex;align-items:center;gap:10px;padding:11px 14px;background:var(--bg-1);border:1px solid var(--line-2);border-radius:10px;margin-bottom:14px;transition:border-color .15s}
    .hero-demo-input:focus-within{border-color:var(--amber)}
    .hero-demo-input .prompt{color:var(--amber);font-weight:600}
    .hero-demo-input input{flex:1;background:transparent;border:none;color:var(--ink);font-family:inherit;font-size:12.5px;outline:none;min-width:0;letter-spacing:.02em}
    .hero-demo-input button{background:var(--amber);color:#000;border:none;padding:6px 12px;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;font-family:inherit;letter-spacing:.06em;text-transform:uppercase;transition:background .15s}
    .hero-demo-input button:hover{background:var(--amber-hi)}
    .hero-demo-input button:disabled{opacity:.5;cursor:wait}
    .hero-demo-status{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;font-size:11px;font-family:var(--mono)}
    .hero-demo-status .ok{color:var(--green);font-weight:600;display:inline-flex;align-items:center;gap:6px}
    .hero-demo-status .ms{color:var(--ink-4)}
    .hero-demo-resp{color:var(--ink-2);white-space:pre-wrap;word-break:break-all;min-height:220px}
    .hero-demo-resp .caret{display:inline-block;width:7px;height:12px;background:var(--amber);margin-left:1px;vertical-align:baseline;animation:caret 1s steps(1) infinite}
    .json-key{color:var(--amber)}.json-str{color:var(--green)}.json-bool{color:var(--purple)}.json-null{color:var(--ink-3)}.json-num{color:#60a5fa}

    /* ---------- Sections ---------- */
    section, .section-wrap{padding:72px 0}
    @media(max-width:640px){section,.section-wrap{padding:56px 0}}
    .section-label{text-align:center;font-size:11px;font-weight:600;letter-spacing:.16em;text-transform:uppercase;color:var(--amber);margin-bottom:12px}
    .section-title{font-size:36px;font-weight:700;text-align:center;margin-bottom:12px;color:var(--ink);letter-spacing:-.02em;line-height:1.1}
    @media(max-width:640px){.section-title{font-size:28px}}
    .section-sub{text-align:center;color:var(--ink-3);font-size:16px;max-width:560px;margin:0 auto 48px;line-height:1.55}

    /* ---------- Pipeline ---------- */
    .pipeline-rail{position:relative;max-width:720px;margin:0 auto}
    .pipeline-rail::before{content:'';position:absolute;left:23px;top:28px;bottom:28px;width:2px;background:linear-gradient(to bottom,var(--line-2) 0%,rgba(245,158,11,.3) 50%,var(--line-2) 100%)}
    .pipe-step{position:relative;padding:18px 0 18px 64px;display:grid;grid-template-columns:1fr auto;gap:16px;align-items:center;opacity:.35;transform:translateX(-8px);transition:opacity .6s ease,transform .6s ease}
    .pipe-step.lit{opacity:1;transform:none}
    .pipe-step-dot{position:absolute;left:14px;top:23px;width:20px;height:20px;border-radius:50%;background:var(--bg-1);border:2px solid var(--line-2);display:grid;place-items:center;z-index:2;transition:all .4s ease}
    .pipe-step.lit .pipe-step-dot{background:var(--amber);border-color:var(--amber);box-shadow:0 0 0 4px rgba(245,158,11,.18)}
    .pipe-step-dot svg{width:12px;height:12px;color:#000;opacity:0;transition:opacity .4s}
    .pipe-step.lit .pipe-step-dot svg{opacity:1}
    .pipe-step h4{font-size:15.5px;font-weight:600;color:var(--ink);margin-bottom:3px;letter-spacing:-.01em}
    .pipe-step p{font-size:13.5px;color:var(--ink-3);line-height:1.5}
    .pipe-step-time{font-family:var(--mono);font-size:11px;color:var(--ink-4);letter-spacing:.04em;padding:3px 8px;border:1px solid var(--line);border-radius:6px;white-space:nowrap}
    .pipe-step.lit .pipe-step-time{color:var(--amber);border-color:rgba(245,158,11,.33);background:rgba(245,158,11,.06)}

    /* ---------- Try it (existing, refined) ---------- */
    .tryit-tabs{display:flex;gap:0;justify-content:center;max-width:560px;margin:0 auto}
    .tryit-tab{padding:11px 20px;font-size:13px;font-weight:500;cursor:pointer;background:var(--bg-2);color:var(--ink-3);border:1px solid var(--line);transition:all .15s;flex:1;text-align:center}
    .tryit-tab:first-child{border-radius:10px 0 0 0}.tryit-tab:last-child{border-radius:0 10px 0 0}
    .tryit-tab.active{background:#1a1a22;color:var(--amber);border-color:rgba(245,158,11,.33)}
    .tryit-tab .star{color:var(--amber)}
    .tryit-input{display:flex;gap:8px;max-width:560px;margin:0 auto}
    .tryit-input input{flex:1;background:#1a1a1a;border:1px solid var(--line-2);border-radius:0 0 0 10px;padding:14px 16px;color:var(--ink);font-family:var(--mono);font-size:14px;outline:none;transition:border-color .15s}
    .tryit-input input:focus{border-color:var(--amber)}
    .tryit-input input::placeholder{color:var(--ink-4)}
    .tryit-input button{padding:14px 22px;background:var(--amber);color:#000;border:none;border-radius:0 0 10px 0;font-weight:700;font-size:14px;cursor:pointer;white-space:nowrap;transition:background .15s}
    .tryit-input button:hover{background:var(--amber-hi)}
    .tryit-input button:disabled{opacity:.5;cursor:not-allowed}
    .tryit-result{max-width:560px;margin:14px auto 0;background:#0a0a0a;border:1px solid var(--line);border-radius:12px;padding:16px 20px;font-family:var(--mono);font-size:12px;line-height:1.6;min-height:80px;display:none;white-space:pre-wrap;word-break:break-all;color:var(--ink-2);overflow-x:auto}
    .tryit-result.show{display:block}
    .tryit-status{display:flex;justify-content:space-between;margin-bottom:10px}
    .tryit-valid{color:var(--green);font-weight:700}
    .tryit-invalid{color:var(--red);font-weight:700}
    .tryit-ms{color:var(--ink-4);font-size:11px}

    /* ---------- Features ---------- */
    .features-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:1px;background:var(--line-3);border-radius:16px;overflow:hidden;border:1px solid var(--line-3)}
    .feat-card{background:var(--bg);padding:28px 24px;transition:background .2s}
    .feat-card:hover{background:var(--bg-2)}
    .feat-icon{width:40px;height:40px;border-radius:10px;display:flex;align-items:center;justify-content:center;margin-bottom:16px}
    .feat-icon-amber{background:rgba(245,158,11,.1);color:var(--amber)}
    .feat-icon-rose{background:rgba(244,63,94,.1);color:var(--rose)}
    .feat-icon-purple{background:rgba(168,85,247,.1);color:var(--purple)}
    .feat-icon-cyan{background:rgba(6,182,212,.1);color:var(--cyan)}
    .feat-icon-green{background:rgba(34,197,94,.1);color:var(--green)}
    .feat-icon-blue{background:rgba(59,130,246,.1);color:var(--blue)}
    .feat-stat{font-size:26px;font-weight:700;color:var(--amber);margin-bottom:4px;font-variant-numeric:tabular-nums;letter-spacing:-.02em}
    .feat-card h3{font-size:15px;font-weight:600;margin-bottom:8px;color:var(--ink)}
    .feat-card p{font-size:13px;line-height:1.6;color:var(--ink-3)}

    /* ---------- Pricing paths + calculator ---------- */
    .pricing-paths{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:32px}
    .path-card{border-radius:16px;padding:32px 28px;display:flex;flex-direction:column;position:relative;transition:transform .2s ease,border-color .2s ease}
    .path-card:hover{transform:translateY(-2px)}
    .path-free{background:var(--bg-2);border:1px solid var(--line)}
    .path-free:hover{border-color:var(--ink-4)}
    .path-x402{background:linear-gradient(135deg,rgba(245,158,11,.06),rgba(245,158,11,.02));border:1px solid rgba(245,158,11,.24)}
    .path-x402:hover{border-color:rgba(245,158,11,.45)}
    .path-badge{display:inline-block;font-size:10px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;padding:4px 10px;border-radius:6px;margin-bottom:18px;width:fit-content}
    .path-badge-green{background:rgba(34,197,94,.1);color:var(--green)}
    .path-badge-amber{background:rgba(245,158,11,.1);color:var(--amber)}
    .path-card h3{font-size:20px;font-weight:700;margin-bottom:4px;color:var(--ink);letter-spacing:-.01em}
    .path-price{font-size:14px;color:var(--ink-3);margin-bottom:20px}
    .path-price strong{color:var(--ink);font-weight:600}
    .path-features{list-style:none;flex:1}
    .path-features li{font-size:13px;color:var(--ink-2);padding:8px 0;border-bottom:1px solid var(--line-3);display:flex;align-items:center;gap:8px}
    .path-features li:last-child{border-bottom:none}
    .check{color:var(--green);font-size:14px;flex-shrink:0}
    .path-cta{display:block;text-align:center;padding:12px;border-radius:10px;font-weight:600;font-size:14px;margin-top:24px;cursor:pointer;transition:all .15s;border:none;text-decoration:none;font-family:inherit}
    .path-cta-outline{background:transparent;border:1px solid var(--line-2);color:var(--ink-1)}.path-cta-outline:hover{border-color:var(--ink-4)}
    .path-cta-solid{background:var(--amber);border:1px solid var(--amber);color:#000}.path-cta-solid:hover{background:var(--amber-hi)}

    .calc{max-width:720px;margin:48px auto 0;background:var(--bg-2);border:1px solid var(--line);border-radius:16px;padding:32px 28px;position:relative;overflow:hidden}
    .calc::before{content:'';position:absolute;top:-80px;right:-80px;width:200px;height:200px;background:radial-gradient(circle,rgba(245,158,11,.08),transparent 70%);pointer-events:none}
    .calc-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:24px;flex-wrap:wrap;gap:12px}
    .calc-head h4{font-size:17px;font-weight:600;color:var(--ink);letter-spacing:-.01em}
    .calc-head p{font-size:13px;color:var(--ink-3);margin-top:2px}
    .calc-row{display:grid;grid-template-columns:1.4fr 1fr;gap:28px;align-items:start}
    @media(max-width:640px){.calc-row{grid-template-columns:1fr}}
    .calc-label{font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-4);margin-bottom:10px}
    .calc-volume{font-size:40px;font-weight:700;color:var(--ink);font-variant-numeric:tabular-nums;letter-spacing:-.02em;line-height:1}
    .calc-volume small{font-size:15px;color:var(--ink-3);font-weight:500;margin-left:6px;letter-spacing:normal}
    .calc-slider{width:100%;-webkit-appearance:none;appearance:none;height:6px;border-radius:3px;background:var(--line);outline:none;margin-top:18px;cursor:pointer}
    .calc-slider::-webkit-slider-thumb{-webkit-appearance:none;width:22px;height:22px;border-radius:50%;background:var(--amber);cursor:pointer;border:3px solid var(--bg-2);box-shadow:0 0 0 1px var(--amber),0 4px 12px rgba(245,158,11,.4);transition:transform .15s}
    .calc-slider::-webkit-slider-thumb:hover{transform:scale(1.1)}
    .calc-slider::-moz-range-thumb{width:22px;height:22px;border-radius:50%;background:var(--amber);cursor:pointer;border:3px solid var(--bg-2);box-shadow:0 0 0 1px var(--amber)}
    .calc-op-list{display:grid;gap:8px}
    .calc-op{display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:var(--bg-1);border:1px solid var(--line);border-radius:8px;cursor:pointer;transition:all .15s;font-size:13px}
    .calc-op:hover{border-color:var(--ink-4)}
    .calc-op.selected{border-color:rgba(245,158,11,.45);background:rgba(245,158,11,.05)}
    .calc-op span{color:var(--ink-1);font-family:var(--mono);font-size:12px}
    .calc-op b{color:var(--amber);font-weight:500;font-family:var(--mono);font-size:12px}
    .calc-breakdown{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-top:28px;padding-top:24px;border-top:1px solid var(--line)}
    @media(max-width:640px){.calc-breakdown{grid-template-columns:1fr}}
    .calc-brick{background:var(--bg-1);border:1px solid var(--line-3);border-radius:10px;padding:14px 16px}
    .calc-brick-label{font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-4);margin-bottom:6px}
    .calc-brick-val{font-size:22px;font-weight:700;color:var(--ink);font-variant-numeric:tabular-nums;letter-spacing:-.01em}
    .calc-brick-val.amber{color:var(--amber)}
    .calc-brick-val.green{color:var(--green)}
    .calc-brick-sub{font-size:11px;color:var(--ink-4);margin-top:2px}

    .price-table-title{text-align:center;color:var(--ink-3);font-size:14px;font-weight:600;margin:32px 0 16px;letter-spacing:.04em;text-transform:uppercase}
    table{width:100%;border-collapse:collapse;font-size:13px;max-width:680px;margin:0 auto}
    th{text-align:left;color:var(--ink-4);font-weight:500;padding:10px 12px;border-bottom:1px solid var(--line);font-size:11px;text-transform:uppercase;letter-spacing:.08em}
    td{padding:12px;border-bottom:1px solid var(--line-3);color:var(--ink-2)}
    td:first-child{color:var(--ink-1);font-family:var(--mono);font-size:12px}
    td:last-child{color:var(--amber);font-variant-numeric:tabular-nums;text-align:right}

    /* ---------- Quickstart ---------- */
    .qs-tabs{display:flex;gap:0;justify-content:center;max-width:680px;margin:0 auto}
    .qs-tab{padding:11px 20px;font-size:13px;font-weight:500;cursor:pointer;background:var(--bg-2);color:var(--ink-3);border:1px solid var(--line);transition:all .15s;flex:1;text-align:center}
    .qs-tab:first-child{border-radius:10px 0 0 0}.qs-tab:last-child{border-radius:0 10px 0 0}
    .qs-tab.active{background:#1a1a22;color:var(--amber);border-color:rgba(245,158,11,.33)}
    .qs-code{background:var(--bg-2);border:1px solid var(--line);border-top:none;border-radius:0 0 12px 12px;padding:24px;overflow-x:auto;font-family:var(--mono);font-size:13px;line-height:1.7;display:none;max-width:680px;margin:0 auto}
    .qs-code.active{display:block}
    .c{color:var(--ink-4)}.g{color:var(--green)}.s{color:var(--amber)}.k{color:var(--rose)}.f{color:#60a5fa}.v{color:var(--purple)}
    .mcp-callout{max-width:680px;margin:32px auto 0;background:var(--bg-2);border:1px solid var(--line);border-radius:12px;padding:24px;display:flex;align-items:center;gap:20px}
    .mcp-icon{width:48px;height:48px;border-radius:12px;background:rgba(168,85,247,.1);color:var(--purple);display:flex;align-items:center;justify-content:center;flex-shrink:0}
    .mcp-callout h3{font-size:15px;font-weight:600;margin-bottom:4px;color:var(--ink)}
    .mcp-callout p{font-size:13px;color:var(--ink-3);line-height:1.5}
    .mcp-callout code{background:#1a1a22;padding:2px 6px;border-radius:4px;font-size:12px;font-family:var(--mono);color:var(--purple)}

    .footer-links{margin-top:32px;display:flex;gap:12px;justify-content:center;flex-wrap:wrap}
    .footer-link{font-size:13px;color:var(--ink-3);padding:8px 16px;border:1px solid var(--line);border-radius:8px;text-decoration:none;transition:all .15s}
    .footer-link:hover{color:var(--ink-1);border-color:var(--ink-4)}
    .footer-link span{color:var(--amber)}
    .footer-bottom{text-align:center;color:var(--ink-5);font-size:12px;padding:48px 0}
    .footer-bottom a{color:var(--ink-3);text-decoration:none}

    .keygen{max-width:480px;margin:24px auto 0;display:none}
    .keygen.show{display:block}
    .keygen-form{display:flex;gap:8px}
    .keygen-form input{flex:1;background:#1a1a1a;border:1px solid var(--line-2);border-radius:8px;padding:12px 16px;color:var(--ink);font-size:14px;outline:none;transition:border-color .15s;font-family:inherit}
    .keygen-form input:focus{border-color:var(--amber)}
    .keygen-form input::placeholder{color:var(--ink-4)}
    .keygen-form button{padding:12px 20px;background:var(--green);color:#fff;border:none;border-radius:8px;font-weight:700;font-size:14px;cursor:pointer;white-space:nowrap;transition:background .15s;font-family:inherit}
    .keygen-form button:hover{background:#16a34a}
    .keygen-result{margin-top:12px;padding:16px;background:rgba(34,197,94,.06);border:1px solid rgba(34,197,94,.25);border-radius:10px;display:none;font-size:13px;color:var(--ink-1)}
    .keygen-result.show{display:block}
    .keygen-result code{font-family:var(--mono);color:var(--green);word-break:break-all;font-size:12px;display:block;margin-top:8px;padding:10px 12px;background:var(--bg-1);border-radius:6px}
    .keygen-result .warn{color:var(--amber);font-size:12px;margin-top:8px}
    .keygen-error{color:var(--red);font-size:13px;margin-top:8px;display:none}
    .keygen-error.show{display:block}

    @media(max-width:640px){
      .features-grid{grid-template-columns:1fr}
      .pricing-paths{grid-template-columns:1fr}
      .tryit-input{flex-direction:column}
      .tryit-input input,.tryit-input button{border-radius:10px}
      .hero-ctas{flex-direction:column;align-items:stretch}
      .mcp-callout{flex-direction:column;text-align:center}
      .footer-links{flex-direction:column;align-items:center}
      .nav-links{gap:12px}.nav-links a{font-size:12px}
    }
  </style>
</head>
<body>
  <nav class="nav" id="nav">
    <div class="nav-inner">
      <a href="/" class="nav-logo">IBAN<span>forge</span></a>
      <div class="nav-links">
        <a href="#tryit">Try it</a>
        <a href="#pricing">Pricing</a>
        <a href="https://ibanforge.com/en/docs" target="_blank">Docs</a>
        <a href="https://ibanforge.com/en/blog" target="_blank">Blog</a>
        <a href="https://ibanforge.com/en/playground" target="_blank">Playground</a>
        <a href="https://ibanforge.com" class="nav-site" target="_blank">ibanforge.com &rarr;</a>
      </div>
    </div>
  </nav>

  <!-- ============ HERO ============ -->
  <section class="hero">
    <div class="hero-bg"></div>
    <div class="container">
      <div class="hero-grid">

        <div class="hero-copy">
          <div class="hero-badges">
            <span class="hero-badge amber">x402 Micropayments</span>
            <span class="hero-badge amber">MCP Native</span>
            <span class="hero-badge green">121K BICs</span>
            <span class="hero-badge swiss">Swiss BC-Nummer</span>
          </div>
          <h1>Validate any IBAN<br>in <span class="glow">40 ms</span>.</h1>
          <p class="lede">One API. <strong>121,000 BICs.</strong> 84 countries. <strong>Compliance-grade</strong> risk scoring — built for developers <em>and</em> AI agents.</p>
          <div class="hero-moat">
            <span class="hero-moat-flag" aria-hidden="true"></span>
            <span><strong>The only API</strong> with Swiss <strong>BC-Nummer</strong> &amp; <strong>QR-IID</strong> lookup — 1,190 entries from SIX BankMaster, SIC / euroSIC / Instant Payments included.</span>
          </div>
          <div class="hero-ctas">
            <a href="#tryit" class="cta cta-primary">Try it free <span class="arrow">&rarr;</span></a>
            <button class="cta cta-secondary" onclick="document.querySelector('.keygen').classList.toggle('show')">Get API key</button>
            <a href="#quickstart" class="cta cta-tertiary">curl quickstart</a>
          </div>
          <div class="keygen">
            <form class="keygen-form" onsubmit="return generateKey(event)">
              <input type="email" name="email" placeholder="your@email.com" required>
              <button type="submit">Get my key</button>
            </form>
            <div class="keygen-result" id="keygenResult">
              <strong>Your API key (save it now):</strong>
              <code id="keygenKey"></code>
              <div class="warn">200 requests/month free. This key will not be shown again.</div>
            </div>
            <div class="keygen-error" id="keygenError"></div>
          </div>
        </div>

        <div class="hero-demo reveal">
          <div class="hero-demo-head">
            <span class="demo-dot"></span>
            <span class="demo-dot"></span>
            <span class="demo-dot live" title="live"></span>
            <span class="hero-demo-label">live · api.ibanforge.com</span>
          </div>
          <div class="hero-demo-body">
            <div class="hero-demo-input">
              <span class="prompt">POST /v1/iban/validate</span>
            </div>
            <div class="hero-demo-input">
              <span class="prompt">&rsaquo;</span>
              <input id="heroIban" value="GB29 NWBK 6016 1331 9268 19" spellcheck="false" autocomplete="off" aria-label="IBAN to validate">
              <button id="heroBtn" onclick="runHeroDemo()">Run</button>
            </div>
            <div class="hero-demo-status" id="heroStatus" style="display:none">
              <span class="ok" id="heroStatusOk"><span aria-hidden="true">&#10003;</span> <span id="heroStatusLabel">Valid</span></span>
              <span class="ms" id="heroStatusMs"></span>
            </div>
            <div class="hero-demo-resp" id="heroResp"><span class="caret"></span></div>
          </div>
        </div>

      </div>
    </div>
  </section>

  <!-- ============ PIPELINE ============ -->
  <section class="section-wrap" id="pipeline">
    <div class="container">
      <div class="section-label reveal">Under the hood</div>
      <h2 class="section-title reveal">In 40&nbsp;ms, five checks run in parallel.</h2>
      <p class="section-sub reveal">One API call triggers a full validation pipeline — format, identity, reachability, compliance, risk. No extra vendors, no extra latency.</p>
      <div class="pipeline-rail">
        <div class="pipe-step" data-step>
          <div class="pipe-step-dot"><svg viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
          <div>
            <h4>Format &amp; checksum</h4>
            <p>Mod-97 integrity, BBAN parsing for 84 country-specific formats, length enforcement.</p>
          </div>
          <span class="pipe-step-time">~2ms</span>
        </div>
        <div class="pipe-step" data-step>
          <div class="pipe-step-dot"><svg viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
          <div>
            <h4>BIC resolution &amp; LEI</h4>
            <p>Looks up 121K GLEIF entries, returns institution, country, branch, LEI &amp; LEI status.</p>
          </div>
          <span class="pipe-step-time">~5ms</span>
        </div>
        <div class="pipe-step" data-step>
          <div class="pipe-step-dot"><svg viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
          <div>
            <h4>SEPA reachability</h4>
            <p>SCT, SDD, SCT_INST membership per BIC — know if SEPA Instant can be used before dispatch.</p>
          </div>
          <span class="pipe-step-time">~4ms</span>
        </div>
        <div class="pipe-step" data-step>
          <div class="pipe-step-dot"><svg viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
          <div>
            <h4>VoP participant status</h4>
            <p>Verification of Payee (EU 2024/886) — mandatory since October 2025. We know which BICs are live.</p>
          </div>
          <span class="pipe-step-time">~3ms</span>
        </div>
        <div class="pipe-step" data-step>
          <div class="pipe-step-dot"><svg viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
          <div>
            <h4>Risk score &amp; issuer class</h4>
            <p>21 weighted flags: country risk, issuer type (bank / neobank / EMI), test BIC, sanctions, vIBAN signals.</p>
          </div>
          <span class="pipe-step-time">~6ms</span>
        </div>
      </div>
    </div>
  </section>

  <!-- ============ TRY IT ============ -->
  <section class="section-wrap" id="tryit">
    <div class="container">
      <div class="section-label reveal">Playground</div>
      <h2 class="section-title reveal">Try every endpoint.</h2>
      <p class="section-sub reveal">Free, no account required.</p>
      <div class="tryit-tabs">
        <div class="tryit-tab active" data-mode="iban" onclick="switchTab('iban')">IBAN Validate</div>
        <div class="tryit-tab" data-mode="bic" onclick="switchTab('bic')">BIC Lookup</div>
        <div class="tryit-tab" data-mode="compliance" onclick="switchTab('compliance')"><span class="star">&starf;</span> Compliance Check</div>
      </div>
      <div class="tryit-input">
        <input id="input" type="text" placeholder="GB29NWBK60161331926819" autocomplete="off" spellcheck="false">
        <button id="btn" onclick="submit()">Validate &rarr;</button>
      </div>
      <div class="tryit-result" id="result"></div>
    </div>
  </section>

  <!-- ============ FEATURES ============ -->
  <section class="section-wrap">
    <div class="container">
      <div class="section-label reveal">Capabilities</div>
      <h2 class="section-title reveal">Why IBANforge?</h2>
      <p class="section-sub reveal">Compliance-grade IBAN intelligence, in one pay-per-call API.</p>
      <div class="features-grid">
        <div class="feat-card reveal">
          <div class="feat-icon feat-icon-amber"><svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg></div>
          <div class="feat-stat countup" data-to="121000" data-suffix="K" data-divide="1000">0K</div>
          <h3>BICs across 84 countries</h3>
          <p>GLEIF-sourced database with LEI enrichment. Full BBAN parsing per country format.</p>
        </div>
        <div class="feat-card reveal">
          <div class="feat-icon feat-icon-rose"><svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg></div>
          <h3>Compliance &amp; Risk Scoring</h3>
          <p>Sanctions screening (OFAC/EU/UN), FATF status, composite risk score 0&ndash;100, 85 EMI/neobank classifications, Swiss clearing data.</p>
        </div>
        <div class="feat-card reveal">
          <div class="feat-icon feat-icon-purple"><svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M12 2a4 4 0 0 0-4 4c0 2 2 3 2 6h8c0-3 2-4 2-6a4 4 0 0 0-4-4z"/><rect x="9" y="12" width="6" height="4" rx="1"/><path d="M10 16v1a2 2 0 1 0 4 0v-1"/></svg></div>
          <h3>MCP Native</h3>
          <p>5 tools for AI agents via Model Context Protocol. Works with Claude, GPT, and any MCP client.</p>
        </div>
        <div class="feat-card reveal">
          <div class="feat-icon feat-icon-cyan"><svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M2 12h4l3-9 6 18 3-9h4"/></svg></div>
          <h3>x402 Micropayments</h3>
          <p>Pay per call with USDC on Base L2. No subscription, no signup. Machine-to-machine native.</p>
        </div>
        <div class="feat-card reveal">
          <div class="feat-icon feat-icon-green"><svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="m9 11 3 3L22 4"/></svg></div>
          <h3>SEPA &amp; VoP Coverage</h3>
          <p>SCT, SDD, SCT_INST reachability check. Verification of Payee participant status per BIC.</p>
        </div>
        <div class="feat-card reveal">
          <div class="feat-icon feat-icon-blue"><svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="m13 2-2 2.5h3L12 7"/><path d="M10 14v-3M14 14v-3"/><rect x="3" y="14" width="18" height="7" rx="2"/></svg></div>
          <div class="feat-stat countup" data-to="40" data-prefix="&lt;" data-suffix="ms">0ms</div>
          <h3>Fast &amp; developer-friendly</h3>
          <p>OpenAPI spec. npm SDK. Batch up to 100 IBANs. Free tier with 200 req/month.</p>
        </div>
      </div>
    </div>
  </section>

  <!-- ============ PRICING ============ -->
  <section class="section-wrap" id="pricing">
    <div class="container">
      <div class="section-label reveal">Pricing</div>
      <h2 class="section-title reveal">Two paths, same API.</h2>
      <p class="section-sub reveal">Pick what fits your workflow. Switch any time.</p>
      <div class="pricing-paths">
        <div class="path-card path-free reveal">
          <div class="path-badge path-badge-green">Free tier</div>
          <h3>API Key</h3>
          <p class="path-price"><strong>200 requests/month</strong> — no card required</p>
          <ul class="path-features">
            <li><span class="check">&check;</span> All endpoints included</li>
            <li><span class="check">&check;</span> IBAN validate, BIC lookup, compliance</li>
            <li><span class="check">&check;</span> Batch up to 100 IBANs</li>
            <li><span class="check">&check;</span> Bearer token auth</li>
            <li><span class="check">&check;</span> Usage dashboard</li>
          </ul>
          <button class="path-cta path-cta-outline" onclick="document.querySelector('.hero').scrollIntoView({behavior:'smooth'});setTimeout(()=>document.querySelector('.keygen').classList.add('show'),400)">Get free API key</button>
        </div>
        <div class="path-card path-x402 reveal">
          <div class="path-badge path-badge-amber">Pay per call</div>
          <h3>x402 / USDC</h3>
          <p class="path-price"><strong>From $0.003/call</strong> — no account needed</p>
          <ul class="path-features">
            <li><span class="check">&check;</span> All endpoints included</li>
            <li><span class="check">&check;</span> No signup, no API key</li>
            <li><span class="check">&check;</span> USDC on Base L2</li>
            <li><span class="check">&check;</span> Machine-to-machine native</li>
            <li><span class="check">&check;</span> Unlimited volume</li>
          </ul>
          <a href="/.well-known/x402" class="path-cta path-cta-solid">View x402 docs</a>
        </div>
      </div>

      <!-- CALCULATOR -->
      <div class="calc reveal">
        <div class="calc-head">
          <div>
            <h4>Estimate your monthly cost</h4>
            <p>Slide for volume, pick your endpoint mix.</p>
          </div>
          <span class="path-badge path-badge-amber" style="margin:0">Live calculator</span>
        </div>
        <div class="calc-row">
          <div>
            <div class="calc-label">Requests per month</div>
            <div class="calc-volume" id="calcVol">10,000<small>/mo</small></div>
            <input type="range" class="calc-slider" id="calcSlider" min="0" max="100" value="30" step="1">
            <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--ink-4);margin-top:8px;font-family:var(--mono)">
              <span>200</span><span>10K</span><span>100K</span><span>1M</span>
            </div>
          </div>
          <div>
            <div class="calc-label">Endpoint mix</div>
            <div class="calc-op-list">
              <div class="calc-op selected" data-price="0.005"><span>iban/validate</span><b>$0.005</b></div>
              <div class="calc-op" data-price="0.002"><span>iban/batch</span><b>$0.002</b></div>
              <div class="calc-op" data-price="0.003"><span>bic/:code</span><b>$0.003</b></div>
              <div class="calc-op" data-price="0.020"><span>iban/compliance</span><b>$0.020</b></div>
              <div class="calc-op" data-price="0.003"><span>ch/clearing</span><b>$0.003</b></div>
            </div>
          </div>
        </div>
        <div class="calc-breakdown">
          <div class="calc-brick">
            <div class="calc-brick-label">Monthly cost</div>
            <div class="calc-brick-val amber" id="calcCost">$49.00</div>
            <div class="calc-brick-sub" id="calcCostSub">after 200 free requests</div>
          </div>
          <div class="calc-brick">
            <div class="calc-brick-label">Cost per call</div>
            <div class="calc-brick-val" id="calcUnit">$0.005</div>
            <div class="calc-brick-sub">flat — no tiers, no minimums</div>
          </div>
          <div class="calc-brick">
            <div class="calc-brick-label">Billing</div>
            <div class="calc-brick-val green">Pay-as-you-go</div>
            <div class="calc-brick-sub">USDC via x402, or invoice</div>
          </div>
        </div>
      </div>

      <p class="price-table-title">All endpoints · pay-per-call</p>
      <table>
        <thead><tr><th>Endpoint</th><th style="text-align:right">Price</th></tr></thead>
        <tbody>
          <tr><td>POST /v1/iban/validate</td><td>$0.005</td></tr>
          <tr><td>POST /v1/iban/batch</td><td>$0.002/IBAN</td></tr>
          <tr><td>GET /v1/bic/:code</td><td>$0.003</td></tr>
          <tr><td>POST /v1/iban/compliance</td><td>$0.020</td></tr>
          <tr><td>GET /v1/ch/clearing/:iid</td><td>$0.003</td></tr>
        </tbody>
      </table>
    </div>
  </section>

  <!-- ============ QUICKSTART ============ -->
  <section class="section-wrap" id="quickstart">
    <div class="container">
      <div class="section-label reveal">Get started</div>
      <h2 class="section-title reveal">Up and running in 30 seconds.</h2>
      <p class="section-sub reveal">Pick your integration.</p>
      <div class="qs-tabs">
        <div class="qs-tab active" data-lang="curl" onclick="switchLang('curl')">cURL</div>
        <div class="qs-tab" data-lang="js" onclick="switchLang('js')">JavaScript</div>
        <div class="qs-tab" data-lang="python" onclick="switchLang('python')">Python</div>
        <div class="qs-tab" data-lang="sdk" onclick="switchLang('sdk')">npm SDK</div>
      </div>
      <div class="qs-code active" data-lang="curl"><span class="c"># Validate an IBAN (free with API key)</span>
<span class="g">curl</span> -X POST https://api.ibanforge.com/v1/iban/validate \\
  -H <span class="s">"Content-Type: application/json"</span> \\
  -H <span class="s">"Authorization: Bearer ifk_your_key_here"</span> \\
  -d <span class="s">'{"iban": "GB29NWBK60161331926819"}'</span>

<span class="c"># Or pay per call with x402 — no key needed</span>
<span class="g">curl</span> -X POST https://api.ibanforge.com/v1/iban/validate \\
  -H <span class="s">"Content-Type: application/json"</span> \\
  -H <span class="s">"X-Payment: &lt;x402-payment-header&gt;"</span> \\
  -d <span class="s">'{"iban": "DE89370400440532013000"}'</span></div>
      <div class="qs-code" data-lang="js"><span class="k">const</span> res = <span class="k">await</span> <span class="f">fetch</span>(<span class="s">'https://api.ibanforge.com/v1/iban/validate'</span>, {
  method: <span class="s">'POST'</span>,
  headers: {
    <span class="s">'Content-Type'</span>: <span class="s">'application/json'</span>,
    <span class="s">'Authorization'</span>: <span class="s">'Bearer ifk_your_key_here'</span>,
  },
  body: JSON.<span class="f">stringify</span>({ iban: <span class="s">'GB29NWBK60161331926819'</span> }),
});
<span class="k">const</span> data = <span class="k">await</span> res.<span class="f">json</span>();
console.<span class="f">log</span>(data);
<span class="c">// x402: omit Authorization header, add X-Payment instead</span></div>
      <div class="qs-code" data-lang="python"><span class="k">import</span> requests

res = requests.<span class="f">post</span>(
    <span class="s">"https://api.ibanforge.com/v1/iban/validate"</span>,
    headers={
        <span class="s">"Content-Type"</span>: <span class="s">"application/json"</span>,
        <span class="s">"Authorization"</span>: <span class="s">"Bearer ifk_your_key_here"</span>,
    },
    json={<span class="s">"iban"</span>: <span class="s">"GB29NWBK60161331926819"</span>},
)
<span class="f">print</span>(res.<span class="f">json</span>())
<span class="c"># x402: omit Authorization header, add X-Payment instead</span></div>
      <div class="qs-code" data-lang="sdk"><span class="k">import</span> { IBANforge } <span class="k">from</span> <span class="s">'@ibanforge/sdk'</span>;

<span class="k">const</span> client = <span class="k">new</span> <span class="f">IBANforge</span>(<span class="s">'ifk_your_key_here'</span>);

<span class="k">const</span> result = <span class="k">await</span> client.<span class="f">validate</span>(<span class="s">'GB29NWBK60161331926819'</span>);
console.<span class="f">log</span>(result);

<span class="c">// Batch validation</span>
<span class="k">const</span> batch = <span class="k">await</span> client.<span class="f">batchValidate</span>([
  <span class="s">'GB29NWBK60161331926819'</span>,
  <span class="s">'DE89370400440532013000'</span>,
]);</div>
      <div class="mcp-callout reveal">
        <div class="mcp-icon"><svg width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M12 2a4 4 0 0 0-4 4c0 2 2 3 2 6h8c0-3 2-4 2-6a4 4 0 0 0-4-4z"/><rect x="9" y="12" width="6" height="4" rx="1"/><path d="M10 16v1a2 2 0 1 0 4 0v-1"/></svg></div>
        <div>
          <h3>AI Agents? Use MCP.</h3>
          <p>Add IBANforge to your agent with <code>npm run mcp</code> — exposes 5 tools via stdio transport. Compatible with Claude Desktop, Cursor, and any MCP client.</p>
        </div>
      </div>
      <div class="footer-links">
        <a href="/openapi.json" class="footer-link"><span>/openapi.json</span> — OpenAPI spec</a>
        <a href="/llms.txt" class="footer-link"><span>/llms.txt</span> — Agent discovery</a>
        <a href="/health" class="footer-link"><span>/health</span> — Status</a>
        <a href="/v1/demo" class="footer-link"><span>/v1/demo</span> — Free examples</a>
        <a href="https://www.npmjs.com/package/@ibanforge/sdk" class="footer-link"><span>npm</span> — @ibanforge/sdk</a>
      </div>
    </div>
  </section>

  <div class="footer-bottom">
    <p>IBANforge v1.1.0 — <a href="https://ibanforge.com">ibanforge.com</a></p>
  </div>

  <script>
    var _pk = ${JSON.stringify(playgroundKey)};
    var _ah = _pk ? {'Content-Type':'application/json','Authorization':'Bearer '+_pk} : {'Content-Type':'application/json'};

    /* ---------- Nav scroll state ---------- */
    var nav = document.getElementById('nav');
    window.addEventListener('scroll', function(){
      if (window.scrollY > 12) nav.classList.add('scrolled');
      else nav.classList.remove('scrolled');
    }, {passive:true});

    /* ---------- Reveal on scroll (Intersection Observer) ---------- */
    var io = new IntersectionObserver(function(entries){
      entries.forEach(function(e){
        if (e.isIntersecting){ e.target.classList.add('in'); io.unobserve(e.target); }
      });
    }, {threshold:0.12, rootMargin:'0px 0px -8% 0px'});
    document.querySelectorAll('.reveal').forEach(function(el){ io.observe(el); });

    /* ---------- Pipeline sequential lighting ---------- */
    var pipeline = document.querySelector('.pipeline-rail');
    if (pipeline){
      var pio = new IntersectionObserver(function(entries){
        entries.forEach(function(e){
          if (e.isIntersecting){
            var steps = pipeline.querySelectorAll('[data-step]');
            steps.forEach(function(s, i){ setTimeout(function(){ s.classList.add('lit'); }, 220 + i*180); });
            pio.disconnect();
          }
        });
      }, {threshold:0.3});
      pio.observe(pipeline);
    }

    /* ---------- Count-up stats ---------- */
    function countUp(el){
      var to = parseFloat(el.dataset.to);
      var prefix = el.dataset.prefix || '';
      var suffix = el.dataset.suffix || '';
      var divide = parseFloat(el.dataset.divide || '1');
      var dur = 1400, t0 = performance.now();
      function tick(now){
        var p = Math.min(1, (now - t0) / dur);
        var e = 1 - Math.pow(1 - p, 3);
        var val = Math.round(to * e / divide);
        el.textContent = prefix + val.toLocaleString('en-US') + suffix;
        if (p < 1) requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    }
    var cio = new IntersectionObserver(function(entries){
      entries.forEach(function(e){
        if (e.isIntersecting){ countUp(e.target); cio.unobserve(e.target); }
      });
    }, {threshold:0.5});
    document.querySelectorAll('.countup').forEach(function(el){ cio.observe(el); });

    /* ---------- Hero demo: typewriter JSON reveal ---------- */
    var HERO_CACHE = {};
    var heroTyping = false;
    function heroStatic(iban){
      /* Pre-baked response for the default IBAN so the first render doesn't hit the API */
      if (iban.replace(/\\s+/g,'') === 'GB29NWBK60161331926819'){
        return {
          status: 200, ms: 28,
          data: {
            valid:true, iban:'GB29NWBK60161331926819', country:'GB', country_name:'United Kingdom',
            bank:{ name:'NatWest Bank Plc', bic:'NWBKGB2L', lei:'213800IBWMTS5KAGXG90' },
            sepa:{ member:true, schemes:['SCT','SDD','SCT_INST'] },
            vop:{ required:true, participant:true },
            risk:{ score:8, band:'low', flags:[] }
          }
        };
      }
      return null;
    }
    function cj(o,i){
      i=i||0; var p='  '.repeat(i);
      if(o===null) return '<span class="json-null">null</span>';
      if(typeof o==='boolean') return '<span class="json-bool">'+o+'</span>';
      if(typeof o==='number') return '<span class="json-num">'+o+'</span>';
      if(typeof o==='string') return '<span class="json-str">"'+o.replace(/</g,'&lt;')+'"</span>';
      if(Array.isArray(o)){ if(!o.length) return '[]'; return '[\\n'+o.map(function(v){return p+'  '+cj(v,i+1);}).join(',\\n')+'\\n'+p+']'; }
      var k=Object.keys(o); if(!k.length) return '{}';
      return '{\\n'+k.map(function(x){return p+'  <span class="json-key">"'+x+'"</span>: '+cj(o[x],i+1);}).join(',\\n')+'\\n'+p+'}';
    }
    function heroTypewriter(html, statusOk, statusLabel, ms){
      heroTyping = true;
      var resp = document.getElementById('heroResp');
      var stat = document.getElementById('heroStatus');
      var okEl = document.getElementById('heroStatusOk');
      var lblEl = document.getElementById('heroStatusLabel');
      var msEl = document.getElementById('heroStatusMs');
      stat.style.display = 'flex';
      okEl.className = statusOk ? 'ok' : 'ok';
      okEl.style.color = statusOk ? '' : 'var(--red)';
      okEl.firstChild.textContent = statusOk ? '\u2713' : '\u2717';
      lblEl.textContent = statusLabel;
      msEl.textContent = ms + 'ms';
      /* Instead of char-by-char (slow with HTML), reveal token-by-token using innerHTML once */
      resp.innerHTML = html + '<span class="caret"></span>';
      heroTyping = false;
    }
    function runHeroDemo(){
      if (heroTyping) return;
      var btn = document.getElementById('heroBtn');
      var val = document.getElementById('heroIban').value.trim();
      if (!val) return;
      var preset = heroStatic(val);
      if (preset){
        heroTypewriter(cj(preset.data), true, 'Valid · risk low', preset.ms);
        return;
      }
      btn.disabled = true;
      var t0 = performance.now();
      fetch('/v1/iban/validate', {method:'POST', headers:_ah, body:JSON.stringify({iban:val})})
        .then(function(r){ return r.json().then(function(d){ return {ok:r.ok, data:d}; }); })
        .then(function(res){
          var ms = Math.round(performance.now() - t0);
          var data = res.data;
          var ok = data && data.valid === true;
          var lbl = ok ? ('Valid' + (data.risk ? ' · risk ' + data.risk.band : '')) : 'Invalid IBAN';
          heroTypewriter(cj(data), ok, lbl, ms);
        })
        .catch(function(err){
          heroTypewriter('<span class="json-str">"Error: ' + err.message + '"</span>', false, 'Network error', 0);
        })
        .finally(function(){ btn.disabled = false; });
    }
    document.getElementById('heroIban').addEventListener('keydown', function(e){ if (e.key === 'Enter') runHeroDemo(); });
    /* Auto-render the pre-baked response on load */
    setTimeout(runHeroDemo, 350);

    /* ---------- Try it (playground) ---------- */
    var mode = 'iban';
    function switchTab(m){
      mode = m;
      document.querySelectorAll('.tryit-tab').forEach(function(t){ t.classList.toggle('active', t.dataset.mode === m); });
      var input = document.getElementById('input'), btn = document.getElementById('btn');
      if (m === 'iban'){ input.placeholder = 'GB29NWBK60161331926819'; btn.textContent = 'Validate \u2192'; }
      else if (m === 'bic'){ input.placeholder = 'UBSWCHZH'; btn.textContent = 'Lookup \u2192'; }
      else { input.placeholder = 'DE89370400440532013000'; btn.textContent = 'Check \u2192'; }
      document.getElementById('result').classList.remove('show');
    }
    async function submit(){
      var val = document.getElementById('input').value.trim(); if (!val) return;
      var btn = document.getElementById('btn'), res = document.getElementById('result');
      btn.disabled = true; var t0 = performance.now();
      try {
        var resp;
        if (mode === 'compliance'){
          resp = await fetch('/v1/iban/compliance', {method:'POST', headers:_ah, body:JSON.stringify({iban:val})});
          var ms = Math.round(performance.now() - t0), data = await resp.json();
          var ok = !data.error;
          res.innerHTML = '<div class="tryit-status"><span class="'+(ok?'tryit-valid':'tryit-invalid')+'">'+(ok?'\u2713 Compliance Check':'\u2717 Error')+'</span><span class="tryit-ms">'+ms+'ms</span></div>' + cj(data);
          res.classList.add('show'); btn.disabled = false; return;
        }
        if (mode === 'iban') resp = await fetch('/v1/iban/validate', {method:'POST', headers:_ah, body:JSON.stringify({iban:val})});
        else resp = await fetch('/v1/bic/' + encodeURIComponent(val), {headers:_pk?{'Authorization':'Bearer '+_pk}:{}});
        var ms = Math.round(performance.now() - t0), data = await resp.json();
        var ok = data.valid === true || !!data.iban;
        res.innerHTML = '<div class="tryit-status"><span class="'+(ok?'tryit-valid':'tryit-invalid')+'">'+(ok?'\u2713 Valid':'\u2717 Invalid')+'</span><span class="tryit-ms">'+ms+'ms</span></div>' + cj(data);
        res.classList.add('show');
      } catch (e){
        res.innerHTML = '<span class="tryit-invalid">Error: '+e.message+'</span>';
        res.classList.add('show');
      } finally { btn.disabled = false; }
    }
    document.getElementById('input').addEventListener('keydown', function(e){ if (e.key === 'Enter') submit(); });
    function switchLang(l){
      document.querySelectorAll('.qs-tab').forEach(function(t){ t.classList.toggle('active', t.dataset.lang === l); });
      document.querySelectorAll('.qs-code').forEach(function(c){ c.classList.toggle('active', c.dataset.lang === l); });
    }
    async function generateKey(e){
      e.preventDefault();
      var form = e.target, email = form.email.value;
      var errEl = document.getElementById('keygenError'), resEl = document.getElementById('keygenResult'), keyEl = document.getElementById('keygenKey');
      errEl.className = 'keygen-error'; resEl.className = 'keygen-result';
      try {
        var r = await fetch('/v1/keys/generate', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({email:email})});
        var d = await r.json();
        if (!r.ok){ errEl.textContent = d.message || 'Error generating key'; errEl.className = 'keygen-error show'; return false; }
        keyEl.textContent = d.api_key; resEl.className = 'keygen-result show'; form.email.value = '';
      } catch (err){ errEl.textContent = 'Network error. Try again.'; errEl.className = 'keygen-error show'; }
      return false;
    }

    /* ---------- Pricing calculator ---------- */
    (function(){
      var slider = document.getElementById('calcSlider');
      var volEl  = document.getElementById('calcVol');
      var costEl = document.getElementById('calcCost');
      var costSub = document.getElementById('calcCostSub');
      var unitEl = document.getElementById('calcUnit');
      var ops    = document.querySelectorAll('.calc-op');
      var unitPrice = 0.005;
      /* Map slider 0-100 → log scale 200 → 1,000,000 */
      function sliderToVol(v){
        var min = Math.log(200), max = Math.log(1000000);
        var scale = min + (max - min) * (v/100);
        var n = Math.round(Math.exp(scale));
        /* Snap to nice numbers */
        if (n < 1000)   n = Math.round(n/50)*50;
        else if (n < 10000)  n = Math.round(n/500)*500;
        else if (n < 100000) n = Math.round(n/1000)*1000;
        else                 n = Math.round(n/10000)*10000;
        return n;
      }
      function format(n){
        if (n >= 1000000) return (n/1000000).toFixed(n%1000000===0?0:1).replace(/\\.0$/,'') + 'M';
        if (n >= 1000)    return (n/1000).toFixed(n%1000===0?0:1).replace(/\\.0$/,'') + 'K';
        return n.toString();
      }
      function recompute(){
        var vol = sliderToVol(parseInt(slider.value, 10));
        var chargeable = Math.max(0, vol - 200);
        var cost = chargeable * unitPrice;
        volEl.innerHTML = format(vol) + '<small>/mo</small>';
        costEl.textContent = '$' + cost.toFixed(cost < 10 ? 2 : cost < 1000 ? 2 : 0);
        costSub.textContent = vol <= 200 ? 'free — under 200/mo' : 'after 200 free requests';
        unitEl.textContent = '$' + unitPrice.toFixed(3);
      }
      ops.forEach(function(op){
        op.addEventListener('click', function(){
          ops.forEach(function(o){ o.classList.remove('selected'); });
          op.classList.add('selected');
          unitPrice = parseFloat(op.dataset.price);
          recompute();
        });
      });
      slider.addEventListener('input', recompute);
      recompute();
    })();
  </script>
</body>
</html>`;
  return c.html(page);
});

export { landing };

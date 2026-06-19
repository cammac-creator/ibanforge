// src/routes/landing.ts
import { Hono } from 'hono';
import { html, raw } from 'hono/html';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pkg = require('../../package.json') as { version: string };

const landing = new Hono();

landing.get('/', (c) => {
  c.header('Cache-Control', 'public, max-age=3600');

  const playgroundKey = process.env.PLAYGROUND_API_KEY || '';

  const jsonLdWebAPI = JSON.stringify({
    "@context":"https://schema.org",
    "@type":"WebAPI",
    "name":"IBANforge",
    "description":"IBAN validation, BIC/SWIFT lookup, and compliance risk scoring API for developers and AI agents",
    "url":"https://api.ibanforge.com",
    "documentation":"https://api.ibanforge.com/openapi.json",
    "provider":{"@type":"Organization","name":"IBANforge","url":"https://ibanforge.com"},
    "offers":[
      {"@type":"Offer","price":"0","priceCurrency":"USD","description":"Free tier: 200 requests/month with API key"},
      {"@type":"Offer","price":"0.003","priceCurrency":"USD","description":"Pay per call via x402 USDC on Base L2"}
    ]
  });

  const jsonLdFAQ = JSON.stringify({
    "@context":"https://schema.org",
    "@type":"FAQPage",
    "mainEntity":[
      {"@type":"Question","name":"What is IBANforge?","acceptedAnswer":{"@type":"Answer","text":"IBANforge is a REST API for IBAN validation, BIC/SWIFT lookup, and compliance risk scoring. It covers 89 countries with 121K+ BIC entries from public sources (GLEIF, SWIFT directory, Bundesbank, SIX, NBP), 38K of which are LEI-enriched via GLEIF."}},
      {"@type":"Question","name":"How much does IBANforge cost?","acceptedAnswer":{"@type":"Answer","text":"IBANforge offers a free tier with 200 requests per month using an API key. Beyond that, pay $0.003 to $0.02 per call using USDC micropayments via the x402 protocol. No subscription required."}},
      {"@type":"Question","name":"Can AI agents use IBANforge?","acceptedAnswer":{"@type":"Answer","text":"Yes. IBANforge is MCP-native with 5 tools for AI agents: validate_iban, batch_validate_iban, lookup_bic, check_compliance, and lookup_ch_clearing. Compatible with Claude, GPT, and any MCP client."}},
      {"@type":"Question","name":"What countries does IBANforge support?","acceptedAnswer":{"@type":"Answer","text":"IBANforge supports 89 countries with full BBAN parsing, SEPA membership detection, Verification of Payee (VoP) reachability status, and country-level risk classification."}}
    ]
  });

  const page = html`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>IBANforge — IBAN Validation & BIC Lookup API for Developers & AI Agents</title>
  <meta name="description" content="Validate IBANs, lookup BICs, score compliance risk. 121K BICs, 89 countries. Free tier or x402 micropayments. MCP native for AI agents.">
  <meta name="robots" content="index, follow">
  <link rel="canonical" href="https://api.ibanforge.com">
  <meta property="og:title" content="IBANforge — IBAN Validation & BIC Lookup API">
  <meta property="og:description" content="Compliance-grade IBAN intelligence. 121K BICs, sanctions screening, risk scoring. Free tier + x402 micropayments.">
  <meta property="og:type" content="website">
  <meta property="og:url" content="https://api.ibanforge.com">
  <meta property="og:image" content="https://api.ibanforge.com/og-image.png">
  <meta property="og:site_name" content="IBANforge">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="IBANforge — IBAN Validation API">
  <meta name="twitter:description" content="121K BICs. Compliance scoring. MCP native. Free or pay-per-call with USDC.">
  <meta name="twitter:image" content="https://api.ibanforge.com/og-image.png">
  <script type="application/ld+json">${raw(jsonLdWebAPI)}</script>
  <script type="application/ld+json">${raw(jsonLdFAQ)}</script>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;background:#09090b;color:#e5e5e5;min-height:100vh}
    .container{max-width:820px;margin:0 auto;padding:48px 24px}
    .section-label{text-align:center;font-size:12px;font-weight:600;letter-spacing:2px;text-transform:uppercase;color:#f59e0b;margin-bottom:12px}
    .section-title{font-size:28px;font-weight:700;text-align:center;margin-bottom:8px;color:#fafafa}
    .section-sub{text-align:center;color:#71717a;font-size:15px;margin-bottom:40px}
    .hero{text-align:center;padding:24px 0 48px}
    .hero-badges{display:inline-flex;gap:8px;flex-wrap:wrap;justify-content:center;margin-bottom:24px}
    .hero-badge{background:#1a1a2e;padding:4px 12px;border-radius:99px;font-size:12px;font-weight:600;letter-spacing:.5px}
    .hero-badge-amber{color:#f59e0b;border:1px solid #f59e0b33}
    .hero-badge-green{color:#22c55e;border:1px solid #22c55e33}
    .hero-badge-red{color:#ef4444;border:1px solid #ef444444;background:#ef444411}
    .hero-moat{max-width:620px;margin:16px auto 28px;padding:12px 20px;border:1px solid #ef444433;border-radius:10px;background:linear-gradient(135deg,#ef444411,#18181b);color:#e5e5e5;font-size:14px;line-height:1.55}
    .hero-moat strong{color:#f87171;font-weight:600}
    .hero h1{font-size:48px;font-weight:800;color:#fafafa;margin-bottom:16px;line-height:1.1}
    .hero h1 span{color:#f59e0b}
    .hero-sub{font-size:20px;color:#a1a1aa;margin-bottom:4px}
    .hero-sub strong{color:#e5e5e5;font-weight:600}
    .hero-features{font-size:14px;color:#52525b;margin-bottom:32px}
    .hero-ctas{display:flex;gap:12px;justify-content:center;flex-wrap:wrap}
    .cta{padding:12px 24px;border-radius:10px;font-weight:600;font-size:15px;text-decoration:none;cursor:pointer;border:none;transition:all .15s;display:inline-block}
    .cta-primary{background:#f59e0b;color:#000}.cta-primary:hover{background:#eab308}
    .cta-secondary{background:transparent;color:#f59e0b;border:1px solid #f59e0b55}.cta-secondary:hover{border-color:#f59e0b}
    .cta-tertiary{background:transparent;color:#a1a1aa;border:1px solid #27272a}.cta-tertiary:hover{color:#e5e5e5;border-color:#3f3f46}
    .tryit{padding:48px 0}
    .tryit-tabs{display:flex;gap:0;margin-bottom:0;justify-content:center}
    .tryit-tab{padding:10px 24px;font-size:13px;font-weight:500;cursor:pointer;background:#0f0f13;color:#71717a;border:1px solid #1f1f28;transition:all .15s}
    .tryit-tab:first-child{border-radius:8px 0 0 0}
    .tryit-tab:last-child{border-radius:0 8px 0 0}
    .tryit-tab.active{background:#1a1a22;color:#f59e0b;border-color:#f59e0b33}
    .tryit-tab .star{color:#f59e0b}
    .tryit-input{display:flex;gap:8px;max-width:560px;margin:20px auto}
    .tryit-input input{flex:1;background:#1a1a1a;border:1px solid #27272a;border-radius:8px;padding:12px 16px;color:#fafafa;font-family:'SF Mono',Monaco,'Cascadia Code',monospace;font-size:14px;outline:none;transition:border-color .15s}
    .tryit-input input:focus{border-color:#f59e0b}
    .tryit-input input::placeholder{color:#52525b}
    .tryit-input button{padding:12px 20px;background:#f59e0b;color:#000;border:none;border-radius:8px;font-weight:700;font-size:14px;cursor:pointer;white-space:nowrap;transition:background .15s}
    .tryit-input button:hover{background:#eab308}
    .tryit-input button:disabled{opacity:.5;cursor:not-allowed}
    .tryit-result{max-width:560px;margin:0 auto;background:#0a0a0a;border:1px solid #1f1f28;border-radius:12px;padding:16px 20px;font-family:'SF Mono',Monaco,'Cascadia Code',monospace;font-size:12px;line-height:1.6;min-height:80px;display:none;white-space:pre-wrap;word-break:break-all;color:#a1a1aa;overflow-x:auto}
    .tryit-result.show{display:block}
    .tryit-status{display:flex;justify-content:space-between;margin-bottom:8px}
    .tryit-valid{color:#22c55e;font-weight:700}
    .tryit-invalid{color:#ef4444;font-weight:700}
    .tryit-ms{color:#52525b;font-size:11px}
    .json-key{color:#f59e0b}.json-str{color:#22c55e}.json-bool{color:#a78bfa}.json-null{color:#71717a}.json-num{color:#60a5fa}
    .features-section{padding:48px 0}
    .features-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:1px;background:#1a1a1f;border-radius:16px;overflow:hidden;border:1px solid #1a1a1f}
    .feat-card{background:#09090b;padding:28px 24px;transition:background .2s}
    .feat-card:hover{background:#0f0f13}
    .feat-icon{width:40px;height:40px;border-radius:10px;display:flex;align-items:center;justify-content:center;margin-bottom:16px}
    .feat-icon-amber{background:rgba(245,158,11,.1);color:#f59e0b}
    .feat-icon-rose{background:rgba(244,63,94,.1);color:#f43f5e}
    .feat-icon-purple{background:rgba(168,85,247,.1);color:#a855f7}
    .feat-icon-cyan{background:rgba(6,182,212,.1);color:#06b6d4}
    .feat-icon-green{background:rgba(34,197,94,.1);color:#22c55e}
    .feat-icon-blue{background:rgba(59,130,246,.1);color:#3b82f6}
    .feat-stat{font-size:22px;font-weight:700;color:#f59e0b;margin-bottom:4px;font-variant-numeric:tabular-nums}
    .feat-card h3{font-size:15px;font-weight:600;margin-bottom:8px;color:#fafafa}
    .feat-card p{font-size:13px;line-height:1.6;color:#71717a}
    .pricing-section{padding:48px 0}
    .pricing-paths{display:grid;grid-template-columns:repeat(3,1fr);gap:20px;margin-bottom:32px}
    .path-card{border-radius:16px;padding:32px 28px;display:flex;flex-direction:column}
    .path-free{background:#0f0f13;border:1px solid #1f1f28}
    .path-stripe{background:linear-gradient(135deg,rgba(99,91,255,.08),rgba(99,91,255,.02));border:1px solid rgba(99,91,255,.25)}
    .stripe-buttons{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-top:14px}
    .stripe-pack-btn{display:flex;flex-direction:column;align-items:center;gap:1px;padding:10px 6px;background:#0f0f13;border:1px solid #27272a;border-radius:6px;color:#e5e5e5;text-decoration:none;transition:all .15s ease;cursor:pointer}
    .stripe-pack-btn:hover{border-color:#9b94ff;background:rgba(99,91,255,.06)}
    .stripe-pack-btn-best{border-color:rgba(99,91,255,.4);background:rgba(99,91,255,.05)}
    .stripe-pack-btn-best:hover{border-color:#9b94ff}
    .pack-credits{font-family:'JetBrains Mono',monospace;font-size:13px;font-weight:600;color:#fafafa}
    .pack-price{font-family:'JetBrains Mono',monospace;font-size:16px;font-weight:700;color:#9b94ff;margin-top:1px}
    .pack-rate{font-size:10px;color:#a1a1aa;letter-spacing:.02em;margin-top:1px}
    .path-x402{background:linear-gradient(135deg,rgba(245,158,11,.06),rgba(245,158,11,.02));border:1px solid rgba(245,158,11,.2)}
    .path-badge{display:inline-block;font-size:11px;font-weight:600;letter-spacing:1px;text-transform:uppercase;padding:4px 10px;border-radius:6px;margin-bottom:20px;width:fit-content}
    .path-badge-green{background:rgba(34,197,94,.1);color:#22c55e}
    .path-badge-blue{background:rgba(99,91,255,.12);color:#9b94ff}
    .path-badge-amber{background:rgba(245,158,11,.1);color:#f59e0b}
    .path-card h3{font-size:20px;font-weight:700;margin-bottom:4px;color:#fafafa}
    .path-price{font-size:14px;color:#71717a;margin-bottom:20px}
    .path-price strong{color:#fafafa;font-weight:600}
    .path-features{list-style:none;flex:1}
    .path-features li{font-size:13px;color:#a1a1aa;padding:8px 0;border-bottom:1px solid #1a1a1f;display:flex;align-items:center;gap:8px}
    .path-features li:last-child{border-bottom:none}
    .check{color:#22c55e;font-size:14px;flex-shrink:0}
    .path-cta{display:block;text-align:center;padding:12px;border-radius:10px;font-weight:600;font-size:14px;margin-top:24px;cursor:pointer;transition:all .15s;border:none;text-decoration:none}
    .path-cta-outline{background:transparent;border:1px solid #27272a;color:#e5e5e5}.path-cta-outline:hover{border-color:#3f3f46}
    .path-cta-solid{background:#f59e0b;border:1px solid #f59e0b;color:#000}.path-cta-solid:hover{background:#eab308}
    .price-table-title{text-align:center;color:#71717a;font-size:16px;font-weight:600;margin-bottom:16px}
    table{width:100%;border-collapse:collapse;font-size:13px}
    th{text-align:left;color:#52525b;font-weight:500;padding:8px 12px;border-bottom:1px solid #1f1f28;font-size:12px;text-transform:uppercase;letter-spacing:.5px}
    td{padding:10px 12px;border-bottom:1px solid #1a1a1f;color:#a1a1aa}
    td:first-child{color:#e5e5e5;font-family:'SF Mono',Monaco,monospace;font-size:12px}
    td:last-child{color:#f59e0b;font-variant-numeric:tabular-nums;text-align:right}
    .quickstart-section{padding:48px 0}
    .qs-tabs{display:flex;gap:0;justify-content:center;margin-bottom:0}
    .qs-tab{padding:10px 24px;font-size:13px;font-weight:500;cursor:pointer;background:#0f0f13;color:#71717a;border:1px solid #1f1f28;transition:all .15s}
    .qs-tab:first-child{border-radius:8px 0 0 0}
    .qs-tab:last-child{border-radius:0 8px 0 0}
    .qs-tab.active{background:#1a1a22;color:#f59e0b;border-color:#f59e0b33}
    .qs-code{background:#0f0f13;border:1px solid #1f1f28;border-top:none;border-radius:0 0 12px 12px;padding:24px;overflow-x:auto;font-family:'SF Mono',Monaco,'Cascadia Code',monospace;font-size:13px;line-height:1.7;display:none}
    .qs-code.active{display:block}
    .c{color:#52525b}.g{color:#22c55e}.s{color:#f59e0b}.k{color:#f43f5e}.f{color:#60a5fa}.v{color:#a78bfa}
    .mcp-callout{margin-top:32px;background:#0f0f13;border:1px solid #1f1f28;border-radius:12px;padding:24px;display:flex;align-items:center;gap:20px}
    .mcp-icon{width:48px;height:48px;border-radius:12px;background:rgba(168,85,247,.1);color:#a855f7;display:flex;align-items:center;justify-content:center;flex-shrink:0}
    .mcp-callout h3{font-size:15px;font-weight:600;margin-bottom:4px;color:#fafafa}
    .mcp-callout p{font-size:13px;color:#71717a;line-height:1.5}
    .mcp-callout code{background:#1a1a22;padding:2px 6px;border-radius:4px;font-size:12px;font-family:'SF Mono',Monaco,monospace;color:#a78bfa}
    .footer-links{margin-top:32px;display:flex;gap:12px;justify-content:center;flex-wrap:wrap}
    .footer-link{font-size:13px;color:#71717a;padding:8px 16px;border:1px solid #1f1f28;border-radius:8px;text-decoration:none;transition:all .15s}
    .footer-link:hover{color:#e5e5e5;border-color:#3f3f46}
    .footer-link span{color:#f59e0b}
    .footer-bottom{text-align:center;color:#3f3f46;font-size:12px;padding-top:48px}
    .footer-bottom a{color:#71717a;text-decoration:none}
    .nav{position:sticky;top:0;z-index:50;background:rgba(9,9,11,.85);backdrop-filter:blur(12px);border-bottom:1px solid #1f1f28;padding:0 24px}
    .nav-inner{max-width:820px;margin:0 auto;display:flex;align-items:center;justify-content:space-between;height:52px}
    .nav-logo{font-size:18px;font-weight:800;color:#fafafa;text-decoration:none}.nav-logo span{color:#f59e0b}
    .nav-links{display:flex;gap:24px;align-items:center}
    .nav-links a{font-size:13px;color:#71717a;text-decoration:none;transition:color .15s}.nav-links a:hover{color:#e5e5e5}
    .nav-links a.nav-active{color:#f59e0b}
    .nav-site{font-size:12px;color:#52525b;padding:4px 10px;border:1px solid #27272a;border-radius:6px;text-decoration:none;transition:all .15s}.nav-site:hover{color:#f59e0b;border-color:#f59e0b33}
    .keygen{max-width:480px;margin:24px auto 0;display:none}
    .keygen.show{display:block}
    .keygen-form{display:flex;gap:8px}
    .keygen-form input{flex:1;background:#1a1a1a;border:1px solid #27272a;border-radius:8px;padding:12px 16px;color:#fafafa;font-size:14px;outline:none;transition:border-color .15s}
    .keygen-form input:focus{border-color:#f59e0b}
    .keygen-form input::placeholder{color:#52525b}
    .keygen-form button{padding:12px 20px;background:#22c55e;color:#fff;border:none;border-radius:8px;font-weight:700;font-size:14px;cursor:pointer;white-space:nowrap;transition:background .15s}
    .keygen-form button:hover{background:#16a34a}
    .keygen-result{margin-top:12px;padding:16px;background:#22c55e10;border:1px solid #22c55e40;border-radius:10px;display:none;font-size:13px;color:#e5e5e5}
    .keygen-result.show{display:block}
    .keygen-result code{font-family:'SF Mono',Monaco,monospace;color:#22c55e;word-break:break-all;font-size:12px;display:block;margin-top:8px;padding:8px 12px;background:#09090b;border-radius:6px}
    .keygen-result .warn{color:#f59e0b;font-size:12px;margin-top:8px}
    .keygen-error{color:#ef4444;font-size:13px;margin-top:8px;display:none}
    .keygen-error.show{display:block}
    @media(max-width:960px){.pricing-paths{grid-template-columns:1fr}}
    @media(max-width:640px){.features-grid{grid-template-columns:1fr}.pricing-paths{grid-template-columns:1fr}.tryit-input{flex-direction:column}.hero h1{font-size:36px}.hero-ctas{flex-direction:column;align-items:center}.mcp-callout{flex-direction:column;text-align:center}.footer-links{flex-direction:column;align-items:center}.nav-links{gap:12px}.nav-links a{font-size:12px}}
  </style>
</head>
<body>
  <nav class="nav">
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
  <div class="container">

    <!-- HERO -->
    <div class="hero">
      <div class="hero-badges">
        <span class="hero-badge hero-badge-amber">x402 MICROPAYMENTS</span>
        <span class="hero-badge hero-badge-amber">MCP NATIVE</span>
        <span class="hero-badge hero-badge-green">121K BICs</span>
        <span class="hero-badge hero-badge-red">🇨🇭 SWISS BC-NUMMER</span>
      </div>
      <h1>IBAN<span>forge</span></h1>
      <p class="hero-sub">Validate IBANs. Lookup BICs. Score risk.</p>
      <p class="hero-sub"><strong>One API for developers &amp; AI agents.</strong></p>
      <p class="hero-features">Compliance-grade validation &middot; Sanctions screening &middot; SEPA &amp; VoP coverage &middot; 89 countries</p>
      <div class="hero-moat">
        <strong>The only API</strong> with Swiss <strong>BC-Nummer</strong> &amp; <strong>QR-IID</strong> lookup &mdash; 1,190 entries from SIX BankMaster, with SIC/euroSIC/Instant Payments participation included.
      </div>
      <div class="hero-ctas">
        <a href="#tryit" class="cta cta-primary">Try it free &darr;</a>
        <button class="cta cta-secondary" onclick="document.querySelector('.keygen').classList.toggle('show')">Get API key &mdash; free</button>
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

    <!-- TRY IT -->
    <div class="tryit" id="tryit">
      <div class="section-label">Demo</div>
      <div class="section-title">Try it now</div>
      <p class="section-sub">Free, no account required</p>
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

    <!-- FEATURES -->
    <div class="features-section">
      <div class="section-label">Capabilities</div>
      <div class="section-title">Why IBANforge?</div>
      <p class="section-sub">Compliance-grade IBAN intelligence for developers and AI agents.</p>
      <div class="features-grid">
        <div class="feat-card">
          <div class="feat-icon feat-icon-amber"><svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg></div>
          <div class="feat-stat">121K</div>
          <h3>BICs across 89 countries</h3>
          <p>GLEIF-sourced database with LEI enrichment. Full BBAN parsing per country format.</p>
        </div>
        <div class="feat-card">
          <div class="feat-icon feat-icon-rose"><svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg></div>
          <h3>Compliance &amp; Risk Scoring</h3>
          <p>Sanctions screening (OFAC/EU/UN), FATF status, composite risk score 0&ndash;100, 85 EMI/neobank classifications, Swiss clearing data.</p>
        </div>
        <div class="feat-card">
          <div class="feat-icon feat-icon-purple"><svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M12 2a4 4 0 0 0-4 4c0 2 2 3 2 6h8c0-3 2-4 2-6a4 4 0 0 0-4-4z"/><rect x="9" y="12" width="6" height="4" rx="1"/><path d="M10 16v1a2 2 0 1 0 4 0v-1"/></svg></div>
          <h3>MCP Native</h3>
          <p>5 tools for AI agents via Model Context Protocol. Works with Claude, GPT, and any MCP client.</p>
        </div>
        <div class="feat-card">
          <div class="feat-icon feat-icon-cyan"><svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M2 12h4l3-9 6 18 3-9h4"/></svg></div>
          <h3>x402 Micropayments</h3>
          <p>Pay per call with USDC on Base L2. No subscription, no signup. Machine-to-machine native.</p>
        </div>
        <div class="feat-card">
          <div class="feat-icon feat-icon-green"><svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="m9 11 3 3L22 4"/></svg></div>
          <h3>SEPA &amp; VoP Coverage</h3>
          <p>SCT, SDD, SCT_INST reachability check. Verification of Payee participant status per BIC.</p>
        </div>
        <div class="feat-card">
          <div class="feat-icon feat-icon-blue"><svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="m13 2-2 2.5h3L12 7"/><path d="M10 14v-3M14 14v-3"/><rect x="3" y="14" width="18" height="7" rx="2"/></svg></div>
          <div class="feat-stat">&lt;30ms</div>
          <h3>Fast &amp; Developer-friendly</h3>
          <p>OpenAPI spec. npm SDK. Batch up to 100 IBANs. Free tier with 200 req/month.</p>
        </div>
      </div>
    </div>

    <!-- PRICING -->
    <div class="pricing-section" id="pricing">
      <div class="section-label">Pricing</div>
      <div class="section-title">Three paths, same API</div>
      <p class="section-sub">Choose what fits your workflow. Switch anytime.</p>
      <div class="pricing-paths">
        <div class="path-card path-free">
          <div class="path-badge path-badge-green">FREE TIER</div>
          <h3>API Key</h3>
          <p class="path-price"><strong>200 requests/month</strong> &mdash; no card required</p>
          <ul class="path-features">
            <li><span class="check">&check;</span> All endpoints included</li>
            <li><span class="check">&check;</span> IBAN validate, BIC lookup, compliance</li>
            <li><span class="check">&check;</span> Batch up to 100 IBANs</li>
            <li><span class="check">&check;</span> Bearer token auth</li>
            <li><span class="check">&check;</span> Usage dashboard</li>
          </ul>
          <button class="path-cta path-cta-outline" onclick="document.querySelector('.hero').scrollIntoView({behavior:'smooth'});setTimeout(()=>document.querySelector('.keygen').classList.add('show'),400)">Get free API key</button>
        </div>
        <div class="path-card path-stripe">
          <div class="path-badge path-badge-blue">CREDIT PACKS</div>
          <h3>Stripe / Card</h3>
          <p class="path-price"><strong>From $5 / 1k credits</strong> &mdash; pay by card</p>
          <ul class="path-features">
            <li><span class="check">&check;</span> Credits never expire</li>
            <li><span class="check">&check;</span> Bearer token, all endpoints</li>
            <li><span class="check">&check;</span> Larger packs = lower per-call cost</li>
            <li><span class="check">&check;</span> Card, Apple Pay, Google Pay</li>
            <li><span class="check">&check;</span> Receipt + key by email</li>
          </ul>
          <div class="stripe-buttons" data-stripe-guard="true">
            <a href="https://buy.stripe.com/3cI00c18lauh1i8bqO8so00" class="stripe-pack-btn" data-stripe-bundle="1k">
              <span class="pack-credits">1 000</span>
              <span class="pack-price">$5</span>
              <span class="pack-rate">$0.005/call</span>
            </a>
            <a href="https://buy.stripe.com/aFafZa6sF45TaSI9iG8so01" class="stripe-pack-btn stripe-pack-btn-best" data-stripe-bundle="5k">
              <span class="pack-credits">5 000</span>
              <span class="pack-price">$20</span>
              <span class="pack-rate">$0.004/call</span>
            </a>
            <a href="https://buy.stripe.com/14A7sE9ERbyld0QcuS8so02" class="stripe-pack-btn" data-stripe-bundle="25k">
              <span class="pack-credits">25 000</span>
              <span class="pack-price">$80</span>
              <span class="pack-rate">$0.0032/call</span>
            </a>
          </div>
        </div>
        <div class="path-card path-x402">
          <div class="path-badge path-badge-amber">PAY PER CALL</div>
          <h3>x402 / USDC</h3>
          <p class="path-price"><strong>From $0.003/call</strong> &mdash; no account needed</p>
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
      <p class="price-table-title">Per-call pricing (both paths)</p>
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

    <!-- QUICK START -->
    <div class="quickstart-section" id="quickstart">
      <div class="section-label">Get Started</div>
      <div class="section-title">Up and running in 30 seconds</div>
      <p class="section-sub">Choose your integration method.</p>
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
      <div class="mcp-callout">
        <div class="mcp-icon"><svg width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M12 2a4 4 0 0 0-4 4c0 2 2 3 2 6h8c0-3 2-4 2-6a4 4 0 0 0-4-4z"/><rect x="9" y="12" width="6" height="4" rx="1"/><path d="M10 16v1a2 2 0 1 0 4 0v-1"/></svg></div>
        <div>
          <h3>AI Agents? Use MCP</h3>
          <p>Add IBANforge to your agent with <code>npm run mcp</code> &mdash; exposes 5 tools via stdio transport. Compatible with Claude Desktop, Cursor, and any MCP client.</p>
        </div>
      </div>
      <div class="footer-links">
        <a href="/openapi.json" class="footer-link"><span>/openapi.json</span> &mdash; OpenAPI spec</a>
        <a href="/health" class="footer-link"><span>/health</span> &mdash; Status</a>
        <a href="/v1/demo" class="footer-link"><span>/v1/demo</span> &mdash; Free examples</a>
        <a href="https://www.npmjs.com/package/@ibanforge/sdk" class="footer-link"><span>npm</span> &mdash; @ibanforge/sdk</a>
      </div>
    </div>

    <div class="footer-bottom">
      <p>IBANforge v${pkg.version} &mdash; <a href="https://ibanforge.com">ibanforge.com</a></p>
    </div>

  </div>

  <script>
    // Guard against unconfigured Stripe Payment Links — until Alain pastes the
    // real URLs into the data-href attributes, clicking these buttons would
    // navigate to a relative path matching the literal placeholder and 404.
    document.querySelectorAll('[data-stripe-guard="true"] a[href^="STRIPE_PAYMENT_LINK_"]').forEach(function(a){
      a.addEventListener('click', function(e){
        e.preventDefault();
        alert('Stripe Payment Links not yet configured. Email support@ibanforge.com to purchase credits manually for now.');
      });
    });
    let mode='iban';
    function switchTab(m){
      mode=m;
      document.querySelectorAll('.tryit-tab').forEach(t=>t.classList.toggle('active',t.dataset.mode===m));
      const input=document.getElementById('input'),btn=document.getElementById('btn');
      if(m==='iban'){input.placeholder='GB29NWBK60161331926819';btn.textContent='Validate \u2192';}
      else if(m==='bic'){input.placeholder='UBSWCHZH';btn.textContent='Lookup \u2192';}
      else{input.placeholder='DE89370400440532013000';btn.textContent='Check \u2192';}
      document.getElementById('result').classList.remove('show');
    }
    function cj(o,i){
      i=i||0;var p='  '.repeat(i);
      if(o===null)return'<span class="json-null">null</span>';
      if(typeof o==='boolean')return'<span class="json-bool">'+o+'</span>';
      if(typeof o==='number')return'<span class="json-num">'+o+'</span>';
      if(typeof o==='string')return'<span class="json-str">"'+o.replace(/</g,'&lt;')+'"</span>';
      if(Array.isArray(o)){if(!o.length)return'[]';return'[\\n'+o.map(v=>p+'  '+cj(v,i+1)).join(',\\n')+'\\n'+p+']';}
      var k=Object.keys(o);if(!k.length)return'{}';
      return'{\\n'+k.map(x=>p+'  <span class="json-key">"'+x+'"</span>: '+cj(o[x],i+1)).join(',\\n')+'\\n'+p+'}';
    }
    var _pk='${playgroundKey}';
    var _ah=_pk?{'Content-Type':'application/json','Authorization':'Bearer '+_pk}:{'Content-Type':'application/json'};
    async function submit(){
      var val=document.getElementById('input').value.trim();if(!val)return;
      var btn=document.getElementById('btn'),res=document.getElementById('result');
      btn.disabled=true;var t0=performance.now();
      try{
        var resp;
        if(mode==='compliance'){
          resp=await fetch('/v1/iban/compliance',{method:'POST',headers:_ah,body:JSON.stringify({iban:val})});
          var ms=Math.round(performance.now()-t0),data=await resp.json();
          var ok=!data.error;
          res.innerHTML='<div class="tryit-status"><span class="'+(ok?'tryit-valid':'tryit-invalid')+'">'+(ok?'\u2713 Compliance Check':'\u2717 Error')+'</span><span class="tryit-ms">'+ms+'ms</span></div>'+cj(data);
          res.classList.add('show');
          btn.disabled=false;
          return;
        }
        if(mode==='iban')resp=await fetch('/v1/iban/validate',{method:'POST',headers:_ah,body:JSON.stringify({iban:val})});
        else resp=await fetch('/v1/bic/'+encodeURIComponent(val),{headers:_pk?{'Authorization':'Bearer '+_pk}:{}});
        var ms=Math.round(performance.now()-t0),data=await resp.json();
        var ok=data.valid===true||!!data.iban;
        res.innerHTML='<div class="tryit-status"><span class="'+(ok?'tryit-valid':'tryit-invalid')+'">'+(ok?'\u2713 Valid':'\u2717 Invalid')+'</span><span class="tryit-ms">'+ms+'ms</span></div>'+cj(data);
        res.classList.add('show');
      }catch(e){res.innerHTML='<span class="tryit-invalid">Error: '+e.message+'</span>';res.classList.add('show');}
      finally{btn.disabled=false;}
    }
    document.getElementById('input').addEventListener('keydown',e=>{if(e.key==='Enter')submit();});
    function switchLang(l){
      document.querySelectorAll('.qs-tab').forEach(t=>t.classList.toggle('active',t.dataset.lang===l));
      document.querySelectorAll('.qs-code').forEach(c=>c.classList.toggle('active',c.dataset.lang===l));
    }
    async function generateKey(e){
      e.preventDefault();
      var form=e.target,email=form.email.value;
      var errEl=document.getElementById('keygenError'),resEl=document.getElementById('keygenResult'),keyEl=document.getElementById('keygenKey');
      errEl.className='keygen-error';resEl.className='keygen-result';
      try{
        var r=await fetch('/v1/keys/generate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:email})});
        var d=await r.json();
        if(!r.ok){errEl.textContent=d.message||'Error generating key';errEl.className='keygen-error show';return false;}
        keyEl.textContent=d.api_key;resEl.className='keygen-result show';form.email.value='';
      }catch(err){errEl.textContent='Network error. Try again.';errEl.className='keygen-error show';}
      return false;
    }
  </script>
</body>
</html>`;
  return c.html(page);
});

export { landing };

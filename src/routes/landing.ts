import { Hono } from 'hono';
import { html } from 'hono/html';

const landing = new Hono();

landing.get('/', (c) => {
  const page = html`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>IBANforge — IBAN Validation & BIC/SWIFT Lookup API</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0a0a0a; color: #e0e0e0; min-height: 100vh; }
    .container { max-width: 780px; margin: 0 auto; padding: 48px 24px; }
    h1 { font-size: 2.2rem; font-weight: 700; margin-bottom: 8px; color: #fff; }
    h1 span { color: #f59e0b; }
    .subtitle { color: #999; margin-bottom: 40px; font-size: 1.1rem; line-height: 1.5; }
    h2 { font-size: 1.3rem; color: #fff; margin: 36px 0 16px; font-weight: 600; }
    .badge { display: inline-block; background: #1a1a2e; border: 1px solid #f59e0b33; color: #f59e0b; padding: 4px 12px; border-radius: 20px; font-size: 0.8rem; font-weight: 600; margin-bottom: 24px; letter-spacing: 0.5px; }
    .endpoints { display: flex; flex-direction: column; gap: 12px; margin-bottom: 32px; }
    .endpoint { background: #111; border: 1px solid #222; border-radius: 10px; padding: 16px 20px; display: flex; align-items: center; gap: 16px; transition: border-color 0.2s; }
    .endpoint:hover { border-color: #f59e0b55; }
    .method { font-family: 'SF Mono', 'Fira Code', monospace; font-weight: 700; font-size: 0.75rem; padding: 4px 10px; border-radius: 4px; min-width: 52px; text-align: center; }
    .method-post { background: #166534; color: #4ade80; }
    .method-get { background: #1e3a5f; color: #60a5fa; }
    .path { font-family: 'SF Mono', 'Fira Code', monospace; font-size: 0.9rem; color: #fff; flex: 1; }
    .price { font-family: 'SF Mono', 'Fira Code', monospace; font-size: 0.8rem; color: #f59e0b; white-space: nowrap; }
    .price-free { color: #4ade80; }
    .desc { color: #888; font-size: 0.85rem; margin-top: 4px; }
    .features { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 32px; }
    .feature { background: #111; border: 1px solid #222; border-radius: 10px; padding: 20px; }
    .feature h3 { font-size: 0.95rem; color: #fff; margin-bottom: 6px; }
    .feature p { font-size: 0.85rem; color: #888; line-height: 1.5; }
    .try-section { background: #111; border: 1px solid #222; border-radius: 10px; padding: 24px; margin-bottom: 32px; }
    .input-row { display: flex; gap: 12px; margin-bottom: 16px; }
    input { flex: 1; padding: 12px 14px; background: #1a1a1a; border: 1px solid #333; border-radius: 8px; color: #fff; font-size: 0.95rem; font-family: 'SF Mono', 'Fira Code', monospace; outline: none; transition: border-color 0.2s; }
    input:focus { border-color: #f59e0b; }
    input::placeholder { color: #555; }
    button { padding: 12px 24px; background: #f59e0b; color: #0a0a0a; border: none; border-radius: 8px; font-size: 0.95rem; font-weight: 600; cursor: pointer; transition: background 0.2s; white-space: nowrap; }
    button:hover { background: #d97706; }
    button:disabled { opacity: 0.5; cursor: not-allowed; }
    .tabs { display: flex; gap: 8px; margin-bottom: 12px; }
    .tab { padding: 8px 16px; background: transparent; color: #888; border: 1px solid #333; border-radius: 6px; cursor: pointer; font-size: 0.85rem; transition: all 0.2s; }
    .tab.active { background: #f59e0b22; color: #f59e0b; border-color: #f59e0b55; }
    #result { background: #0d0d0d; border: 1px solid #222; border-radius: 8px; padding: 16px; font-family: 'SF Mono', 'Fira Code', monospace; font-size: 0.82rem; white-space: pre-wrap; word-break: break-all; min-height: 100px; display: none; line-height: 1.6; color: #ccc; }
    #result.show { display: block; }
    .footer { text-align: center; color: #555; font-size: 0.82rem; padding-top: 32px; border-top: 1px solid #1a1a1a; }
    .footer a { color: #f59e0b; text-decoration: none; }
    code { background: #1a1a1a; padding: 2px 6px; border-radius: 4px; font-family: 'SF Mono', 'Fira Code', monospace; font-size: 0.85rem; color: #f59e0b; }
    @media (max-width: 600px) { .features { grid-template-columns: 1fr; } .input-row { flex-direction: column; } .endpoint { flex-wrap: wrap; } }
  </style>
</head>
<body>
  <div class="container">
    <div class="badge">x402 MICROPAYMENTS ON BASE L2</div>
    <h1>IBAN<span>forge</span></h1>
    <p class="subtitle">Unified API for IBAN validation and BIC/SWIFT code lookup.<br>Pay-per-call with USDC micropayments. Built for AI agents and developers.</p>

    <h2>Endpoints</h2>
    <div class="endpoints">
      <div class="endpoint">
        <span class="method method-post">POST</span>
        <div>
          <div class="path">/v1/iban/validate</div>
          <div class="desc">Validate a single IBAN + automatic BIC lookup</div>
        </div>
        <span class="price">$0.002</span>
      </div>
      <div class="endpoint">
        <span class="method method-post">POST</span>
        <div>
          <div class="path">/v1/iban/batch</div>
          <div class="desc">Validate up to 10 IBANs in one call</div>
        </div>
        <span class="price">$0.015</span>
      </div>
      <div class="endpoint">
        <span class="method method-get">GET</span>
        <div>
          <div class="path">/v1/bic/:code</div>
          <div class="desc">Lookup BIC/SWIFT code with LEI enrichment</div>
        </div>
        <span class="price">$0.001</span>
      </div>
      <div class="endpoint">
        <span class="method method-get">GET</span>
        <div>
          <div class="path">/v1/demo</div>
          <div class="desc">Free example validations</div>
        </div>
        <span class="price price-free">free</span>
      </div>
      <div class="endpoint">
        <span class="method method-get">GET</span>
        <div>
          <div class="path">/health</div>
          <div class="desc">Health check + uptime + stats summary</div>
        </div>
        <span class="price price-free">free</span>
      </div>
      <div class="endpoint">
        <span class="method method-get">GET</span>
        <div>
          <div class="path">/stats</div>
          <div class="desc">Detailed usage statistics</div>
        </div>
        <span class="price price-free">free</span>
      </div>
    </div>

    <div class="features">
      <div class="feature">
        <h3>75+ Countries</h3>
        <p>Full IBAN validation with BBAN parsing, checksum verification, and country-specific formatting rules.</p>
      </div>
      <div class="feature">
        <h3>39K+ BIC Entries</h3>
        <p>GLEIF-sourced database with LEI enrichment. Supports BIC8 and BIC11 formats.</p>
      </div>
      <div class="feature">
        <h3>MCP Server</h3>
        <p>Built-in Model Context Protocol server. Connect AI agents directly via stdio transport.</p>
      </div>
      <div class="feature">
        <h3>x402 Payments</h3>
        <p>USDC micropayments on Base L2. No API keys, no subscriptions. Pay only for what you use.</p>
      </div>
    </div>

    <div class="try-section">
      <h2 style="margin-top:0">Try it</h2>
      <div class="tabs">
        <div class="tab active" data-mode="iban" onclick="switchTab('iban')">IBAN Validate</div>
        <div class="tab" data-mode="bic" onclick="switchTab('bic')">BIC Lookup</div>
      </div>
      <div class="input-row">
        <input id="input" type="text" placeholder="CH56 0483 5012 3456 7800 9" autocomplete="off" spellcheck="false">
        <button id="btn" onclick="submit()">Validate</button>
      </div>
      <div id="result"></div>
    </div>

    <h2>Quick Start</h2>
    <div class="try-section" style="margin-bottom:32px">
      <p style="color:#888;font-size:0.9rem;margin-bottom:12px">IBAN validation:</p>
      <code style="display:block;padding:12px;font-size:0.82rem;line-height:1.6">curl -X POST https://ibanforge.com/v1/iban/validate \\<br>&nbsp;&nbsp;-H "Content-Type: application/json" \\<br>&nbsp;&nbsp;-d '{"iban": "CH5604835012345678009"}'</code>
      <p style="color:#888;font-size:0.9rem;margin:16px 0 12px">BIC lookup:</p>
      <code style="display:block;padding:12px;font-size:0.82rem;line-height:1.6">curl https://ibanforge.com/v1/bic/UBSWCHZH</code>
    </div>

    <div class="footer">
      <p>IBANforge v1.0.0 &mdash; <a href="/v1/demo">Demo</a> &middot; <a href="/health">Health</a> &middot; <a href="/stats">Stats</a></p>
      <p style="margin-top:8px">Powered by x402 micropayments on Base L2</p>
    </div>
  </div>

  <script>
    let mode = 'iban';
    function switchTab(m) {
      mode = m;
      document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.mode === m));
      const input = document.getElementById('input');
      const btn = document.getElementById('btn');
      if (m === 'iban') {
        input.placeholder = 'CH56 0483 5012 3456 7800 9';
        btn.textContent = 'Validate';
      } else {
        input.placeholder = 'UBSWCHZH';
        btn.textContent = 'Lookup';
      }
      document.getElementById('result').classList.remove('show');
    }
    async function submit() {
      const val = document.getElementById('input').value.trim();
      if (!val) return;
      const btn = document.getElementById('btn');
      const res = document.getElementById('result');
      btn.disabled = true;
      try {
        let resp;
        if (mode === 'iban') {
          resp = await fetch('/v1/iban/validate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ iban: val }),
          });
        } else {
          resp = await fetch('/v1/bic/' + encodeURIComponent(val));
        }
        const data = await resp.json();
        res.textContent = JSON.stringify(data, null, 2);
        res.classList.add('show');
      } catch (e) {
        res.textContent = 'Error: ' + e.message;
        res.classList.add('show');
      } finally {
        btn.disabled = false;
      }
    }
    document.getElementById('input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submit();
    });
  </script>
</body>
</html>`;
  return c.html(page);
});

export { landing };

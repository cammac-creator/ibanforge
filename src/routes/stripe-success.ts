/**
 * GET /stripe/success — HTML page shown after a successful Stripe Checkout.
 *
 * Stripe redirects here with ?session_id=cs_test_XXX as configured in each
 * Payment Link's success URL. The page reads the query string, calls
 * /v1/stripe/key/:session_id, and shows the raw API key ONCE.
 *
 * This is intentionally a minimal backend-served page so the flow works end
 * to end without depending on the Next.js frontend. Can be migrated to
 * ibanforge.com/stripe/success later.
 */
import { Hono } from 'hono';
// One source of truth for the first-call block: the same IBAN, endpoint and
// expected answer the delivery emails carry. Interpolated into the page at
// module load, so a change in src/lib/first-call.ts reaches this page too.
import {
  ACCOUNT_PAGE,
  FIRST_CALL_ENDPOINT,
  FIRST_CALL_EXPECTED_LINE_1,
  FIRST_CALL_EXPECTED_LINE_2,
  FIRST_CALL_IBAN,
} from '../lib/first-call.js';

export const stripeSuccess = new Hono();

stripeSuccess.get('/stripe/success', (c) => {
  return c.html(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex, nofollow">
<title>Payment successful — IBANforge</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#0a0a0c;color:#e5e5e5;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;font-size:15px;line-height:1.55}
  .card{max-width:540px;width:100%;background:#121216;border:1px solid #27272a;border-radius:14px;padding:32px}
  .check{width:48px;height:48px;border-radius:50%;background:rgba(34,197,94,.12);color:#22c55e;display:flex;align-items:center;justify-content:center;font-size:24px;margin-bottom:16px}
  h1{font-size:22px;font-weight:600;margin-bottom:6px;color:#fafafa}
  .sub{color:#a1a1aa;font-size:14px;margin-bottom:24px}
  .key-box{background:#0a0a0c;border:1px solid #27272a;border-radius:8px;padding:14px;font-family:'JetBrains Mono','SF Mono',Menlo,monospace;font-size:13px;color:#22c55e;word-break:break-all;margin-bottom:8px}
  .stat-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:18px 0 24px}
  .stat{background:#0a0a0c;border:1px solid #27272a;border-radius:8px;padding:12px 14px}
  .stat-label{font-size:11px;color:#71717a;text-transform:uppercase;letter-spacing:.04em;margin-bottom:2px}
  .stat-value{font-size:16px;font-weight:600;color:#fafafa;font-family:'JetBrains Mono',monospace}
  .warn{background:rgba(245,158,11,.08);border:1px solid rgba(245,158,11,.25);color:#fbbf24;padding:12px 14px;border-radius:8px;font-size:13px;margin-bottom:16px}
  .err{background:rgba(239,68,68,.08);border:1px solid rgba(239,68,68,.25);color:#fca5a5;padding:14px;border-radius:8px;font-size:13px}
  button.copy{background:#27272a;color:#e5e5e5;border:1px solid #3f3f46;border-radius:6px;padding:6px 12px;font-size:12px;cursor:pointer;font-family:inherit}
  button.copy:hover{background:#3f3f46}
  button.copy.ok{background:rgba(34,197,94,.15);color:#22c55e;border-color:rgba(34,197,94,.4)}
  button.run{background:#9b94ff;color:#0a0a0c;border:1px solid #9b94ff;border-radius:6px;padding:7px 14px;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit}
  button.run:hover{background:#b3adff;border-color:#b3adff}
  button.run[disabled]{opacity:.6;cursor:progress}
  .btnrow{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:0 0 4px}
  .runout{background:#0a0a0c;border:1px solid #27272a;border-radius:8px;padding:12px;font-family:'JetBrains Mono',monospace;font-size:12px;color:#a1a1aa;overflow-x:auto;margin:12px 0 0;white-space:pre-wrap;word-break:break-word}
  .runout.ok{border-color:rgba(34,197,94,.4);color:#d4d4d8}
  .runout.ko{border-color:rgba(239,68,68,.4);color:#fca5a5}
  pre{background:#0a0a0c;border:1px solid #27272a;border-radius:8px;padding:12px;font-family:'JetBrains Mono',monospace;font-size:12px;color:#a1a1aa;overflow-x:auto;margin:12px 0}
  a{color:#9b94ff;text-decoration:none}
  a:hover{text-decoration:underline}
  .small{font-size:12px;color:#71717a;margin-top:18px;line-height:1.5}
  .loader{display:inline-block;width:14px;height:14px;border:2px solid #3f3f46;border-top-color:#9b94ff;border-radius:50%;animation:spin .8s linear infinite}
  @keyframes spin{to{transform:rotate(360deg)}}
</style>
</head>
<body>
<div class="card">
  <div id="content">
    <div class="check">✓</div>
    <h1>Verifying your payment…</h1>
    <p class="sub"><span class="loader"></span> Fetching your API key from Stripe webhook</p>
  </div>
</div>

<script>
(function(){
  const params = new URLSearchParams(window.location.search);
  const sessionId = params.get('session_id');
  const content = document.getElementById('content');

  if (!sessionId) {
    content.innerHTML = '<h1>Missing session id</h1><p class="sub">This page is meant to be reached from Stripe Checkout. <a href="/">Return to home</a>.</p>';
    return;
  }

  // Validate session id format client-side too
  if (!/^cs_(test|live)_[A-Za-z0-9_]+$/.test(sessionId)) {
    content.innerHTML = '<h1>Invalid session id</h1><p class="sub">The session id in the URL does not match the expected format. <a href="/">Return to home</a>.</p>';
    return;
  }

  let attempts = 0;
  const maxAttempts = 6;

  function fetchKey() {
    attempts++;
    fetch('/v1/stripe/key/' + encodeURIComponent(sessionId), { headers: { 'Accept': 'application/json' } })
      .then(function(r){ return r.json().then(function(b){ return { status: r.status, body: b }; }); })
      .then(function(res){
        if (res.status === 200 && res.body.api_key) {
          render(res.body);
        } else if (res.status === 404 && attempts < maxAttempts) {
          // Webhook may still be in flight — retry in 2s, up to maxAttempts
          setTimeout(fetchKey, 2000);
        } else {
          renderError(res.body.message || 'Unable to retrieve your API key.');
        }
      })
      .catch(function(err){
        renderError('Network error: ' + err.message);
      });
  }

  function escapeHtml(s){
    return String(s).replace(/[&<>"']/g, function(c){
      return ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c];
    });
  }

  // The command in two forms: raw for the clipboard and for nothing else, HTML
  // escaped for the <pre>. Copying the escaped one would hand the buyer a curl
  // full of &quot; that fails in their shell.
  function curlFor(rawKey) {
    return 'curl -X POST ${FIRST_CALL_ENDPOINT} \\\\\\n' +
      '  -H "Authorization: Bearer ' + rawKey + '" \\\\\\n' +
      '  -H "content-type: application/json" \\\\\\n' +
      '  -d \\'{"iban":"${FIRST_CALL_IBAN}"}\\'';
  }

  function render(data) {
    const key = escapeHtml(data.api_key);
    const curl = curlFor(data.api_key);
    const isOem = data.plan === 'oem';
    const total = data.credits_total;
    const email = data.email ? escapeHtml(data.email) : null;
    const subLine = isOem
      ? 'Editor / OEM subscription active — ' + Number(data.monthly_limit).toLocaleString() + ' requests/month. Save your API key — it will not be shown again.'
      : total + ' credits added. Save your API key — it will not be shown again.';
    const statBlock = isOem
      ? '<div class="stat"><div class="stat-label">Requests / month</div><div class="stat-value">' + Number(data.monthly_limit).toLocaleString() + '</div></div>'
      : '<div class="stat"><div class="stat-label">Credits total</div><div class="stat-value">' + Number(total).toLocaleString() + '</div></div>';
    content.innerHTML =
      '<div class="check">✓</div>' +
      '<h1>Payment confirmed</h1>' +
      '<p class="sub">' + subLine + '</p>' +
      '<div class="warn"><strong>Save this key now.</strong> We do not store it in plaintext after this page is closed. If lost, contact support@ibanforge.com.</div>' +
      '<div class="key-box" id="keybox">' + key + '</div>' +
      '<button class="copy" id="copybtn" type="button">Copy to clipboard</button>' +
      '<div class="stat-grid">' +
        statBlock +
        '<div class="stat"><div class="stat-label">Email</div><div class="stat-value" style="font-size:13px">' + (email || '—') + '</div></div>' +
      '</div>' +
      '<h3 style="font-size:14px;margin-bottom:8px;color:#fafafa">Your first successful call in 30 seconds</h3>' +
      '<pre id="curlbox">' + escapeHtml(curl) + '</pre>' +
      '<div class="btnrow">' +
        '<button class="run" id="runbtn" type="button">Run this call now</button>' +
        '<button class="copy" id="copycurl" type="button">Copy command</button>' +
      '</div>' +
      '<div class="runout" id="runout" hidden></div>' +
      '<p class="small">${FIRST_CALL_EXPECTED_LINE_1}<br>${FIRST_CALL_EXPECTED_LINE_2}</p>' +
      '<p class="small"><a href="${ACCOUNT_PAGE}">Everything this key does, on one page</a> &middot; Docs: <a href="https://api.ibanforge.com/openapi.json">openapi.json</a> &middot; <a href="/llms.txt">llms.txt</a> &middot; <a href="/">Home</a> &middot; <a href="https://ibanforge.com/legal/terms">Terms</a> (14-day refund on unused packs)</p>';

    const btn = document.getElementById('copybtn');
    btn.addEventListener('click', function(){
      navigator.clipboard.writeText(data.api_key).then(function(){
        btn.textContent = '✓ Copied';
        btn.classList.add('ok');
        setTimeout(function(){ btn.textContent = 'Copy to clipboard'; btn.classList.remove('ok'); }, 2000);
      });
    });

    // The key had a copy button, the command it goes into had none: the buyer
    // had to select four lines of a <pre> by hand (BIZ-08, 2026-09-01). The RAW
    // command goes to the clipboard, never the escaped one, or the shell would
    // receive a curl full of &quot;.
    const copyCurl = document.getElementById('copycurl');
    copyCurl.addEventListener('click', function(){
      navigator.clipboard.writeText(curl).then(function(){
        copyCurl.textContent = '✓ Copied';
        copyCurl.classList.add('ok');
        setTimeout(function(){ copyCurl.textContent = 'Copy command'; copyCurl.classList.remove('ok'); }, 2000);
      });
    });

    // The first call, made from here.
    //
    // WHY (funnel measurement of 2026-08-30, BIZ-08): the break is after the
    // purchase, not before it. Most keys never carry a single call, and the page
    // only ever offered a command the buyer had to WANT to run in a terminal
    // they had to open. One button removes the terminal, and the buyer leaves
    // this page having seen their key answer with real data.
    //
    // Relative path on purpose: this page is served by the API host itself, so
    // the call is same-origin and no CORS question can turn a working key into
    // what looks like a broken one.
    const runBtn = document.getElementById('runbtn');
    const runOut = document.getElementById('runout');
    runBtn.addEventListener('click', function(){
      runBtn.disabled = true;
      runBtn.textContent = 'Running…';
      runOut.hidden = false;
      runOut.className = 'runout';
      runOut.textContent = 'Calling POST /v1/iban/validate…';
      fetch('/v1/iban/validate', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + data.api_key, 'content-type': 'application/json' },
        body: JSON.stringify({ iban: '${FIRST_CALL_IBAN}' })
      })
        .then(function(r){ return r.text().then(function(t){ return { status: r.status, text: t }; }); })
        .then(function(res){
          let body = res.text;
          try { body = JSON.stringify(JSON.parse(res.text), null, 2); } catch (e) { /* not JSON: show it raw */ }
          const ok = res.status === 200;
          runOut.className = ok ? 'runout ok' : 'runout ko';
          runOut.textContent = 'HTTP ' + res.status + '\\n\\n' + body;
          runBtn.textContent = ok ? '✓ Your key works' : 'Try again';
          runBtn.disabled = false;
        })
        .catch(function(err){
          runOut.hidden = false;
          runOut.className = 'runout ko';
          runOut.textContent = 'Could not reach the API from this page: ' + err.message +
            '\\nThe command above makes the same call from your terminal.';
          runBtn.disabled = false;
          runBtn.textContent = 'Run this call now';
        });
    });
  }

  function renderError(msg) {
    content.innerHTML =
      '<h1>Could not retrieve your key</h1>' +
      '<p class="sub">Your payment succeeded but we could not deliver the key automatically.</p>' +
      '<div class="err">' + escapeHtml(msg) + '</div>' +
      '<p class="small">Email <a href="mailto:support@ibanforge.com">support@ibanforge.com</a> with your Stripe receipt and session id <code style="background:#27272a;padding:2px 6px;border-radius:3px">' + escapeHtml(sessionId) + '</code> — we will reissue manually.</p>';
  }

  fetchKey();
})();
</script>
</body>
</html>`, 200);
});

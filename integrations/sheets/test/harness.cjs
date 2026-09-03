// Runs Code.gs under Node with the Apps Script services stubbed. Two modes:
//   node harness.js canned   -> canned batch answers, checks the projections and the cache
//   node harness.js live     -> a fake key against the REAL api.ibanforge.com, checks the 401 path
const fs = require('fs'); const vm = require('vm'); const https = require('https');
const mode = process.argv[2] || 'canned';
const code = fs.readFileSync(process.env.CODE_GS, 'utf8');
const calls = [];
const cacheStore = {}; const props = { IBANFORGE_API_KEY: 'ifk_' + 'x'.repeat(40) };
function syncFetch(url, opts) {
  // Apps Script fetch is synchronous; emulate with a child process for the live mode.
  const { execFileSync } = require('child_process');
  const args = ['-s', '-o', '/dev/stdout', '-w', '\n%{http_code}', '-X', (opts.method || 'get').toUpperCase(), url, '-H', 'Authorization: ' + opts.headers.Authorization];
  if (opts.payload) args.push('-H', 'content-type: application/json', '--data', opts.payload);
  const out = execFileSync('curl', args, { encoding: 'utf8' });
  const i = out.lastIndexOf('\n'); return { body: out.slice(0, i), code: Number(out.slice(i + 1)) };
}
const canned = (ibans) => ({ results: ibans.map((iban) => iban === 'CH1000230000000012345'
  ? { iban, valid: true, bic: { code: 'POFICHBEXXX', bank_name: 'PostFinance AG' }, bank_code_check: { status: 'verified', institution: { name: 'PostFinance AG' } }, sepa: { member: true, schemes: ['SCT', 'SCT Inst'] } }
  : iban === 'DE89370400440532013000'
  ? { iban, valid: true, bic: { code: 'COBADEFFXXX', bank_name: 'Commerzbank' }, bank_code_check: { status: 'verified' }, sepa: { member: true, schemes: [] } }
  : { iban, valid: false, error: 'checksum_failed' }) });
const sandbox = {
  console,
  UrlFetchApp: { fetch(url, opts) { calls.push({ url, payload: opts.payload });
    if (mode === 'live') { const r = syncFetch(url, opts); return { getResponseCode: () => r.code, getContentText: () => r.body }; }
    const ibans = JSON.parse(opts.payload).ibans; return { getResponseCode: () => 200, getContentText: () => JSON.stringify(canned(ibans)) }; } },
  CacheService: { getUserCache: () => ({ getAll: (keys) => { const o = {}; keys.forEach((k) => { if (cacheStore[k]) o[k] = cacheStore[k]; }); return o; }, putAll: (obj) => Object.assign(cacheStore, obj) }) },
  PropertiesService: { getUserProperties: () => ({ getProperty: (k) => props[k] || null, setProperty: (k, v) => { props[k] = v; }, deleteProperty: (k) => { delete props[k]; } }) },
  SpreadsheetApp: {}, HtmlService: {},
};
vm.createContext(sandbox); vm.runInContext(code, sandbox);
const assert = require('assert');
// Arrays born inside the vm context carry another Array prototype: compare by value.
const J = (x) => JSON.parse(JSON.stringify(x));
for (const fn of ['IBAN_VALID','IBAN_BANK','IBAN_BIC','IBAN_CHECK','IBAN_VALIDE','IBAN_PRUEFUNG']) { const orig = sandbox[fn]; sandbox[fn] = (x) => J(orig(x)); }
if (mode === 'canned') {
  const grid = [['CH10 0023 0000 0000 1234 5'], ['DE89 3704 0044 0532 0130 00'], [''], ['GB00XXXX']];
  assert.deepStrictEqual(sandbox.IBAN_VALID(grid), [[true], [true], [''], [false]]);
  assert.deepStrictEqual(sandbox.IBAN_BANK(grid), [['PostFinance AG'], ['Commerzbank'], [''], ['']]);
  assert.deepStrictEqual(sandbox.IBAN_BIC(grid), [['POFICHBEXXX'], ['COBADEFFXXX'], [''], ['']]);
  assert.deepStrictEqual(sandbox.IBAN_CHECK(grid), [[true, 'PostFinance AG', 'POFICHBEXXX', 'verified', 'SCT SCT Inst'], [true, 'Commerzbank', 'COBADEFFXXX', 'verified', 'yes'], ['', '', '', '', ''], [false, '', '', 'checksum_failed', '']]);
  assert.strictEqual(sandbox.IBAN_VALID('CH1000230000000012345')[0][0], true, 'single cell');
  assert.strictEqual(calls.length, 1, 'one batch call for the grid, then cache: ' + calls.length);
  assert.deepStrictEqual(JSON.parse(calls[0].payload).ibans, ['CH1000230000000012345', 'DE89370400440532013000', 'GB00XXXX']);
  assert.deepStrictEqual(sandbox.IBAN_VALIDE(grid), sandbox.IBAN_VALID(grid)); assert.deepStrictEqual(sandbox.IBAN_PRUEFUNG(grid), sandbox.IBAN_CHECK(grid));
  const big = Array.from({ length: 230 }, (_, i) => ['XX' + String(i).padStart(20, '0')]);
  sandbox.IBAN_VALID(big); assert.strictEqual(calls.length, 1 + 3, 'three batches of 100 for 230 new IBANs: ' + calls.length);
  delete props.IBANFORGE_API_KEY; assert.throws(() => sandbox.IBAN_VALID('FR7630006000011234567890189'), /no API key yet/);
  console.log('canned: all assertions passed, calls =', calls.length);
} else {
  try { sandbox.IBAN_VALID('CH1000230000000012345'); console.log('live: unexpected success'); process.exit(1); }
  catch (e) { console.log('live 401 path:', e.message); assert.match(e.message, /401|invalid or revoked/); }
  assert.strictEqual(calls[0].url, 'https://api.ibanforge.com/v1/iban/batch?source=sheets');
  console.log('live: request shape and 401 handling verified against the real API');
}

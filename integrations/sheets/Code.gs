/**
 * Fonctions IBANforge pour Google Sheets, installation manuelle par Apps Script.
 * IBAN_VALID : résultat valid de l'API, pas existence du compte.
 * IBAN_BANK : nom lié au BIC, sinon établissement du contrôle du code banque.
 * IBAN_BIC : BIC résolu, cellule vide si absent.
 * IBAN_CHECK : cinq colonnes, résumé sans les dates et détails de source.
 *
 * Une clé est nécessaire pour les valeurs absentes du cache. Les chaînes reçues,
 * la clé d'authentification et source=sheets sont transmis par les serveurs Google.
 * Les valeurs normalisées sont dédoublonnées dans une exécution, puis envoyées
 * par lots de 100 au plus. Chaque IBAN envoyé compte, même s'il est invalide.
 * Le cache demandé dure six heures au plus ; Google peut l'effacer plus tôt.
 * Les formules simultanées et les nouvelles tentatives peuvent consommer à nouveau.
 * En classeur partagé, les propriétés lues par la fonction sont celles du propriétaire :
 * ne pas supposer une clé ou un quota isolé pour chaque collaborateur.
 */

var IBF_API = 'https://api.ibanforge.com';
var IBF_BATCH = 100;
var IBF_CACHE_SECONDS = 21600; // Six heures demandées, sans garantie de conservation par Google.
var IBF_CACHE_PREFIX = 'ibf:v1:';
var IBF_KEY_PROP = 'IBANFORGE_API_KEY';
var IBF_SOURCE = 'sheets';

// ---------------------------------------------------------------------------
// Menu and sidebar
// ---------------------------------------------------------------------------

function onOpen() {
  SpreadsheetApp.getUi()
    .createAddonMenu()
    .addItem('Set up API key', 'ibfShowSidebar')
    .addItem('How to use', 'ibfShowHelp')
    .addToUi();
}

function onInstall() {
  onOpen();
}

function ibfShowSidebar() {
  var html = HtmlService.createHtmlOutputFromFile('Sidebar').setTitle('IBANforge').setWidth(320);
  SpreadsheetApp.getUi().showSidebar(html);
}

function ibfShowHelp() {
  var ui = SpreadsheetApp.getUi();
  ui.alert(
    'IBANforge functions',
    '=IBAN_VALID(A2:A200)  TRUE / FALSE\n' +
      '=IBAN_BANK(A2:A200)   resolved bank name, if available\n' +
      '=IBAN_BIC(A2:A200)    BIC\n' +
      '=IBAN_CHECK(A2:A200)  valid, bank, BIC, bank-code verdict, SEPA\n\n' +
      'An API key is required. Each IBAN sent consumes one unit. Cache eviction or recalculation can consume again. See ibanforge.com/pricing and your key usage. Results are for review, not payment approval.',
    ui.ButtonSet.OK
  );
}

/** Sidebar: save the key after one authenticated call proves it works. */
function ibfSaveKey(key) {
  key = String(key || '').trim();
  if (!/^ifk_[A-Za-z0-9]{16,}$/.test(key)) {
    throw new Error('That does not look like an IBANforge key (they start with ifk_).');
  }
  var status = ibfFetchUsage_(key);
  PropertiesService.getUserProperties().setProperty(IBF_KEY_PROP, key);
  return status;
}

function ibfGetKeyStatus() {
  var key = PropertiesService.getUserProperties().getProperty(IBF_KEY_PROP);
  if (!key) return { configured: false };
  try {
    var status = ibfFetchUsage_(key);
    status.configured = true;
    status.key_prefix = key.slice(0, 12);
    return status;
  } catch (err) {
    return { configured: true, key_prefix: key.slice(0, 12), error: String(err.message || err) };
  }
}

function ibfClearKey() {
  PropertiesService.getUserProperties().deleteProperty(IBF_KEY_PROP);
  return { configured: false };
}

function ibfFetchUsage_(key) {
  var res = UrlFetchApp.fetch(IBF_API + '/v1/keys/usage?source=' + IBF_SOURCE, {
    method: 'get',
    headers: { Authorization: 'Bearer ' + key, 'User-Agent': 'ibanforge-sheets/1.0' },
    muteHttpExceptions: true,
  });
  var code = res.getResponseCode();
  var body = ibfParse_(res.getContentText());
  if (code === 401) throw new Error('IBANforge does not know this key (401). Check it, or create a free one at ibanforge.com.');
  if (code !== 200) throw new Error('IBANforge answered ' + code + (body && body.message ? ': ' + body.message : ''));
  return body;
}

// ---------------------------------------------------------------------------
// Custom functions
// ---------------------------------------------------------------------------

/**
 * Renvoie le résultat valid de l'API ; ne confirme pas l'existence du compte.
 *
 * @param {A2:A200} input A cell or a range of IBANs (spaces allowed).
 * @return {boolean} TRUE when the IBAN is structurally valid, one row per cell.
 * @customfunction
 */
function IBAN_VALID(input) {
  return ibfMap_(input, function (r) {
    return r.valid === true;
  });
}

/**
 * Renvoie le nom associé au BIC, sinon celui de l'établissement du code banque.
 *
 * @param {A2:A200} input A cell or a range of IBANs.
 * @return {string} Nom de banque disponible, sinon cellule vide.
 * @customfunction
 */
function IBAN_BANK(input) {
  return ibfMap_(input, ibfBankName_);
}

/**
 * Renvoie le BIC résolu par l'API, quelle que soit sa source disponible.
 *
 * @param {A2:A200} input A cell or a range of IBANs.
 * @return {string} BIC disponible, sinon cellule vide.
 * @customfunction
 */
function IBAN_BIC(input) {
  return ibfMap_(input, function (r) {
    return r.bic && r.bic.code ? r.bic.code : '';
  });
}

/**
 * Résumé en cinq colonnes : valid, banque, BIC, statut du code banque, SEPA.
 *
 * @param {A2:A200} input A cell or a range of IBANs.
 * @return {Array} Five columns per row.
 * @customfunction
 */
function IBAN_CHECK(input) {
  return ibfMap_(input, ibfCheckRow_, 5);
}

function ibfCheckRow_(r) {
  return [
      r.valid === true,
      ibfBankName_(r),
      r.bic && r.bic.code ? r.bic.code : '',
      ibfBankCodeVerdict_(r),
      ibfSepa_(r),
    ];
}

/** @customfunction */
function IBAN_VALIDE(input) { return IBAN_VALID(input); }
/** @customfunction */
function IBAN_BANQUE(input) { return IBAN_BANK(input); }
/** @customfunction */
function IBAN_CONTROLE(input) { return IBAN_CHECK(input); }
/** @customfunction */
function IBAN_GUELTIG(input) { return IBAN_VALID(input); }
/** @customfunction */
function IBAN_BANKNAME(input) { return IBAN_BANK(input); }
/** @customfunction */
function IBAN_PRUEFUNG(input) { return IBAN_CHECK(input); }

// ---------------------------------------------------------------------------
// Core: normalise, cache, batch, map
// ---------------------------------------------------------------------------

function ibfBankName_(r) {
  if (r.bic && r.bic.bank_name) return r.bic.bank_name;
  if (r.bank_code_check && r.bank_code_check.institution && r.bank_code_check.institution.name) {
    return r.bank_code_check.institution.name;
  }
  return '';
}

function ibfBankCodeVerdict_(r) {
  if (r.valid !== true) return r.error ? String(r.error) : 'invalid';
  var b = r.bank_code_check;
  if (!b || !b.status) return '';
  if (b.status === 'verified') return b.retired ? 'verified, retired' : 'verified';
  return b.reason ? b.status + ' (' + b.reason + ')' : b.status;
}

function ibfSepa_(r) {
  if (r.valid !== true || !r.sepa) return '';
  if (!r.sepa.member) return 'no';
  var s = r.sepa.schemes && r.sepa.schemes.length ? r.sepa.schemes.join(' ') : 'yes';
  return s;
}

/** Turn a cell, a 1-D or a 2-D range into a 2-D array of trimmed strings. */
function ibfNormalise_(input) {
  if (!Array.isArray(input)) return [[ibfClean_(input)]];
  return input.map(function (row) {
    if (!Array.isArray(row)) return [ibfClean_(row)];
    return row.map(ibfClean_);
  });
}

function ibfClean_(v) {
  if (v === null || v === undefined) return '';
  return String(v).replace(/\s+/g, '').toUpperCase();
}

/**
 * Resolve every IBAN of the input once (cache, then batches of 100), then
 * project each result through `pick`. Empty cells yield '' without a call;
 * with a multi-column `pick` (width > 1) they yield a blank row of that width,
 * so the columns stay aligned with the input rows.
 */
function ibfMap_(input, pick, width) {
  width = width || 1;
  var grid = ibfNormalise_(input);
  if (width > 1 && grid.some(function (row) { return row.length > 1; })) {
    throw new Error('IBANforge: this function takes a single column of IBANs, e.g. A2:A200.');
  }
  var wanted = {};
  grid.forEach(function (row) {
    row.forEach(function (iban) {
      if (iban) wanted[iban] = true;
    });
  });
  var results = ibfResolve_(Object.keys(wanted));
  return grid.map(function (row) {
    return row.map(function (iban) {
      var r = iban ? results[iban] : null;
      if (!r) return width > 1 ? ibfBlankRow_(width) : '';
      return pick(r);
    });
  }).map(function (row) {
    // A single-column input with a multi-column pick must flatten to one row.
    return row.length === 1 && Array.isArray(row[0]) ? row[0] : row;
  });
}

function ibfBlankRow_(width) {
  var row = [];
  for (var i = 0; i < width; i++) row.push('');
  return row;
}

function ibfResolve_(ibans) {
  var out = {};
  if (!ibans.length) return out;
  var cache = CacheService.getUserCache();
  var missing = [];
  var cached = cache.getAll(ibans.map(ibfCacheKey_));
  ibans.forEach(function (iban) {
    var hit = cached[ibfCacheKey_(iban)];
    if (hit) out[iban] = ibfParse_(hit);
    else missing.push(iban);
  });
  if (!missing.length) return out;

  var key = PropertiesService.getUserProperties().getProperty(IBF_KEY_PROP);
  if (!key) {
    throw new Error('IBANforge: no API key yet. Run ibfShowSidebar in Apps Script to save your key. See ibanforge.com/docs/api-keys for access and the effective quota.');
  }
  var toCache = {};
  for (var i = 0; i < missing.length; i += IBF_BATCH) {
    var chunk = missing.slice(i, i + IBF_BATCH);
    var batch = ibfFetchBatch_(key, chunk);
    batch.forEach(function (r, idx) {
      var iban = chunk[idx];
      var compact = ibfCompact_(r, iban);
      out[iban] = compact;
      toCache[ibfCacheKey_(iban)] = JSON.stringify(compact);
    });
  }
  cache.putAll(toCache, IBF_CACHE_SECONDS);
  return out;
}

function ibfFetchBatch_(key, ibans) {
  var res = UrlFetchApp.fetch(IBF_API + '/v1/iban/batch?source=' + IBF_SOURCE, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + key, 'User-Agent': 'ibanforge-sheets/1.0' },
    payload: JSON.stringify({ ibans: ibans }),
    muteHttpExceptions: true,
  });
  var code = res.getResponseCode();
  var body = ibfParse_(res.getContentText()) || {};
  if (code === 200 && Array.isArray(body.results)) return body.results;
  if (code === 401) throw new Error('IBANforge: the saved key is not accepted (401). Extensions > IBANforge > Set up API key.');
  if (code === 402) throw new Error('IBANforge: ' + (body.message || 'free quota exhausted for this month. Packs and the Pro plan: ibanforge.com/pricing'));
  if (code === 429) throw new Error('IBANforge: too many requests at once (429). Wait a moment and recalculate.');
  throw new Error('IBANforge answered ' + code + (body.message ? ': ' + body.message : ''));
}

/** Keep only what the functions read, so a cached entry stays small. */
function ibfCompact_(r, iban) {
  r = r || {};
  return {
    iban: r.iban || iban,
    valid: r.valid === true,
    error: r.error || null,
    bic: r.bic ? { code: r.bic.code || null, bank_name: r.bic.bank_name || null } : null,
    bank_code_check: r.bank_code_check
      ? {
          status: r.bank_code_check.status || null,
          reason: r.bank_code_check.reason || null,
          retired: r.bank_code_check.retired === true,
          institution: r.bank_code_check.institution ? { name: r.bank_code_check.institution.name || null } : null,
        }
      : null,
    sepa: r.sepa ? { member: r.sepa.member === true, schemes: r.sepa.schemes || [] } : null,
  };
}

function ibfCacheKey_(iban) {
  return IBF_CACHE_PREFIX + iban;
}

function ibfParse_(text) {
  try {
    return JSON.parse(text);
  } catch (e) {
    return null;
  }
}

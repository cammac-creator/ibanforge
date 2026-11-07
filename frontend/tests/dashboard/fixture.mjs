import { createServer } from 'node:http';
import { businessFixture } from '../../lib/dashboard/business-pulse.fixture.ts';

/** Exemples inventés : aucun fichier privé ni service distant n’est consulté. */
export function createDashboardFixture({ token, origin }) {
  let state;
  let pending = [];
  const release = () => { for (const resolve of pending) resolve(); pending = []; };
  const reset = () => {
    release();
    state = { now: new Date(), business: 'normal', accounts: 'normal', search: 'normal', stripe: 'unavailable', relations: false, writes: [], wallet: 7.5, walletFailure: '', hold: '', requests: [] };
  };
  reset();
  const date = (days = 0) => new Date(state.now.getTime() - days * 86_400_000).toISOString();
  // Calcul indépendant côté serveur de recette ; aucune dépendance au formatage du navigateur.
  const swissCalendar = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Zurich', year: 'numeric', month: '2-digit', day: '2-digit' });
  const stripeDays = () => {
    const today = swissCalendar.format(state.now);
    const anchor = Date.parse(`${today}T12:00:00Z`);
    const previous = days => new Date(anchor - days * 86_400_000).toISOString().slice(0, 10);
    return { today, yesterday: previous(1), old: previous(40) };
  };
  const stripeRevenue = () => {
    const days = stripeDays(), last = day => `${day}T12:00:00.000Z`;
    const kind = over => ({ count: 0, gross: {}, refunded: {}, fees: {}, net: {}, net_unknown: 0, last_payment_at: null, ...over });
    const by_kind = {
      pack: kind({ count: 2, gross: { usd: 1200 }, refunded: { usd: 200 }, fees: { chf: 20 }, net: { chf: 850 }, last_payment_at: last(days.old) }),
      abonnement: kind({ count: 1, gross: { eur: 900 }, fees: { chf: 30 }, net: { chf: 810 }, last_payment_at: date() }),
      audit: kind({ count: 1, gross: { usd: 300 }, fees: { chf: 10 }, net: { chf: 250 }, last_payment_at: last(days.yesterday) }),
      autre: kind({ count: 1, gross: { usd: 9900 }, fees: { chf: 100 }, net: { chf: 8800 }, last_payment_at: date(2) }),
    };
    const ibanforge_days = {
      [days.today]: { count: 1, gross: { eur: 900 }, refunded: {}, fees: { chf: 30 }, net_unknown: 0 },
      [days.yesterday]: { count: 1, gross: { usd: 300 }, refunded: {}, fees: { chf: 10 }, net_unknown: 0 },
      [days.old]: { count: 2, gross: { usd: 1200 }, refunded: { usd: 200 }, fees: { chf: 20 }, net_unknown: 0 },
    };
    if (state.stripe === 'invalid-series') delete ibanforge_days[days.old];
    return {
      version: 1, source: 'stripe', reason: null, served_at: date(), cache_ttl_seconds: 900,
      stripe: {
        version: 1, read_at: date(), livemode: true, by_kind, classification: { invoices: true, sessions: true },
        ibanforge: kind({ count: 4, gross: { usd: 1500, eur: 900 }, refunded: { usd: 200 }, fees: { chf: 60 }, net: { chf: 1910 }, last_payment_at: date() }),
        account: kind({ count: 5, gross: { usd: 11400, eur: 900 }, refunded: { usd: 200 }, fees: { chf: 160 }, net: { chf: 10710 }, last_payment_at: date() }),
        payouts: { paid: { count: 1, amount: { chf: 5000 }, last_arrival_at: date(2) }, in_transit: { count: 0, amount: {} } },
        balance: { available: { chf: 4710 }, pending: { chf: 1000 } }, awaiting_payout: { chf: 5710 }, ibanforge_days,
      },
      derived: { source: 'api_keys_and_ledgers', currency: 'usd', total_minor: 1500, by_kind: { pack: 1200, abonnement: 0, audit: 300 },
        other_currency_payments: 1, unusable_amount_payments: 0, last_payment_at: last(days.yesterday) },
    };
  };
  const monday = () => {
    const d = new Date(state.now); d.setUTCDate(d.getUTCDate() - (d.getUTCDay() + 6) % 7);
    return d.toISOString().slice(0, 10);
  };
  const keys = () => ['alpha', 'beta', 'gamma', 'delta'].map((name, i) => ({
    key_prefix: `ifk_fictif_${name}`, email: `contact@${name}.example.net`, company: `Société Exemple ${i + 1}`,
    active: 1, created_at: date(i < 2 ? 0 : 100), monthly_limit: i === 0 ? null : i === 1 ? 1000 : 200,
    credits_total: i === 0 ? 100 : null, credits_remaining: i === 0 ? 50 : null,
    paid: i === 1 ? 1 : 0, used: i === 1 ? 0 : 11, used_prev: i < 2 ? 0 : 9,
    used_all_time: i === 1 ? 0 : 30, tier: 'email', series: [2, 9, 11], last_active_month: date().slice(0, 7),
  }));
  const relations = () => ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta', 'theta', 'iota'].map((name, i) => ({
    id: `prospect-fictif-${name}`, company: `Société Exemple ${name}`, contact_email: `contact@${name}.example.net`,
    status: 'nouveau', outcome: ['en_discussion', 'pas_maintenant', 'pas_interesse', 'mauvaise_personne', null, null, null, null, null][i],
    outcome_note: null, wake_up_at: null, outcome_at: date(1), created_at: date(10), segment: null, website: null, country: null,
    what_they_do: null, fit_reason: null, buying_signal: null, signal_source_url: null, contact_name: null, contact_role: null,
    email_source_url: null, personalization_hook: null, confidence: null, mail_subject_en: null, mail_body_en: null,
    mail_subject_fr: null, mail_body_fr: null, recommended_lang: 'fr', source: null,
  }));
  const activation = (days) => ({
    clients: keys().map((key, i) => ({ email: key.email, status: i < 2 ? 'paying' : 'active', source: 'documentation',
      signup_at: key.created_at, last_seen_at: i === 1 ? null : date(), first_call_at: i === 1 ? null : date(i === 0 ? 0 : 90),
      last_call_at: i === 1 ? null : date(), calls_90d: key.used_all_time, calls_30d: key.used, calls_today: i === 1 ? 0 : 3,
      credits_total: key.credits_total ?? 0, credits_remaining: key.credits_remaining ?? 0, packs: i === 0 ? 1 : 0,
      keys: 1, free_quota: i === 1 ? 1000 : 200 })),
    funnel: { period_days: days, signed_up: 4, first_call: 3, hit_limit: 1, purchased: 2,
      median_hours_signup_to_first_call: null, median_hours_first_call_to_purchase: null,
      median_n_signup_to_first_call: 0, median_n_first_call_to_purchase: 0 },
    sources: [{ source: 'documentation-integration-exemple', signups: 4, called: 3, paying: 2 }],
    cohorts: [{ week_start: monday(), signups: 2, called_pct: 50, paid_pct: 100, partial: true }],
  });
  const pulse = () => {
    const p = businessFixture(state.now);
    for (const d of p.days) Object.assign(d, { active_accounts: 2, new_accounts: 0, new_buyers: 0 });
    Object.assign(p.days.at(-1), { active_accounts: 3, new_accounts: 2, new_buyers: 1 });
    for (const w of p.weeks) Object.assign(w, { new_accounts: 0, new_buyers: 0 });
    Object.assign(p.weeks.at(-1), { new_accounts: 2, new_buyers: 1 });
    p.totals = { known_accounts: 4, buyer_accounts: 1, active_7d: 3, active_30d: 3, returning_7d: 2 };
    return p;
  };
  const accounts = (url) => {
    const cohort = url.searchParams.get('cohort'), today = date().slice(0, 10);
    const start = cohort === 'active_today' ? today : cohort === 'active_week' ? date(6).slice(0, 10) : monday();
    let rows = keys().map((key, i) => ({ email: key.email, created_at: key.created_at,
      first_purchase_at: i === 0 ? date() : null, active_days: i === 1 ? 0 : 1,
      last_active_day: i === 1 ? null : today,
    })).filter((_, i) => cohort.startsWith('active_') ? i !== 1 : cohort === 'new_accounts' ? i < 2 : i === 0);
    if (state.accounts === 'empty') rows = [];
    if (state.accounts === 'legacy') rows[0].email = '<b>exemple</b>@alpha.example.net';
    if (state.accounts === 'pagination') rows = Array.from({ length: 55 }, (_, i) => ({ ...rows[0], email: `compte-${i + 1}@alpha.example.net` }));
    const total = rows.length, pages = Math.max(1, Math.ceil(total / 50));
    const page = Math.min(pages, Math.max(1, Number(url.searchParams.get('page') || 1)));
    return { version: 1, generated_at: date(), timezone: 'UTC', basis: 'retained_accounts_and_purchases',
      cohort, window: { start, end: today }, total, page, page_size: 50, pages, rows: rows.slice((page - 1) * 50, page * 50) };
  };
  const profiles = (period) => ({
    period_days: period, timezone: 'UTC', generated_at: date(), window_end: date(),
    window_start: date(period - 1).slice(0, 10) + 'T00:00:00.000Z', months_by_key: {}, quota_warned_by_key: {},
    profiles: Object.fromEntries(keys().map(key => [key.key_prefix, {
      key_prefix: key.key_prefix, total: key.used, ok: key.used, paywall: 0, bad_input: 0, auth_or_quota: 0, server_error: 0,
      avg_ms: 12, p95_ms: 20, distinct_ips: key.used ? 1 : 0,
      first_seen: key.used ? date() : null, last_seen: key.used ? date() : null, last_success_at: key.used ? date() : null, last_refusal_at: null,
      hours: Array.from({ length: 24 }, (_, hour) => hour === state.now.getUTCHours() ? key.used : 0),
      days: key.used ? [{ day: date().slice(0, 10), count: key.used, bad: 0 }] : [],
      endpoints: [], countries: [], user_agents: [], client_kinds: [], reject_reasons: [],
    }])),
  });
  const statuses = () => [
    { path: '/v1/iban/validate', total: 1322, s2xx: 1200, s3xx: 0, s4xx: 120, s5xx: 2, avg_ms: 12,
      by_status: { 200: 1200, 402: 120, 500: 2 }, by_method: { POST: 1322 } },
    { path: '/mcp', total: 120, s2xx: 75, s3xx: 0, s4xx: 45, s5xx: 0, avg_ms: 10,
      by_status: { 200: 75, 400: 40, 429: 5 }, by_method: { POST: 120 } },
    { path: '/v1/exemple/une-adresse-longue-pour-verifier-la-lecture-sur-telephone', total: 50, s2xx: 50, s3xx: 0, s4xx: 0, s5xx: 0,
      avg_ms: null, by_status: { 200: 50 }, by_method: { GET: 50 } },
    ...Array.from({ length: 15 }, (_, i) => ({ path: `/v1/exemple/${i}`, total: 20 - i, s2xx: 20 - i, s3xx: 0, s4xx: 0, s5xx: 0,
      avg_ms: 5, by_status: { 200: 20 - i }, by_method: { GET: 20 - i } })),
  ];
  const send = (res, body, status = 200) => {
    res.writeHead(status, { 'content-type': 'application/json', 'access-control-allow-origin': origin,
      'cache-control': 'no-store' }); res.end(JSON.stringify(body));
  };
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname === '/__recipe') {
      if (req.headers['x-recipe-token'] !== token) return send(res, { error: 'Accès refusé' }, 403);
      if (req.method === 'POST') {
        let raw = '';
        for await (const chunk of req) { raw += chunk; if (raw.length > 4096) return send(res, { error: 'Commande trop longue' }, 413); }
        try {
          const command = JSON.parse(raw || '{}');
          if (command.reset) reset();
          if (command.release) { state.hold = ''; release(); }
          if (['normal', 'unavailable'].includes(command.business)) state.business = command.business;
          if (['normal', 'empty', 'unauthorized', 'forbidden', 'unavailable', 'network', 'invalid', 'pagination', 'legacy'].includes(command.accounts)) state.accounts = command.accounts;
          if (['normal', 'unavailable', 'invalid'].includes(command.search)) state.search = command.search;
          if (['normal', 'unavailable', 'invalid-series'].includes(command.stripe)) state.stripe = command.stripe;
          if (typeof command.relations === 'boolean') state.relations = command.relations;
          if (Number.isFinite(command.wallet) && command.wallet >= 0) state.wallet = command.wallet;
          if (['', 'balance', 'full'].includes(command.walletFailure)) state.walletFailure = command.walletFailure;
          if (['', 'stripe', 'balance', 'full', 'accounts'].includes(command.hold)) state.hold = command.hold;
        } catch { return send(res, { error: 'Commande illisible' }, 400); }
      } else if (req.method !== 'GET') return send(res, { error: 'Méthode refusée' }, 405);
      return send(res, { requests: state.requests, writes: state.writes, business: state.business, wallet: state.wallet, hold: state.hold, stripeDays: stripeDays() });
    }
    // Même une erreur de scénario ne peut envoyer un message ni modifier un compte.
    if (req.method !== 'GET') { state.writes.push(req.method + ' ' + url.pathname); return send(res, { error: 'Écriture métier interdite dans la recette' }, 405); }
    if (url.pathname !== '/health') {
      const bearer = url.pathname.startsWith('/stats') || url.pathname === '/admin/revenue';
      const expected = bearer ? req.headers.authorization === `Bearer ${token}` : req.headers['x-admin-secret'] === token;
      if (!expected) return send(res, { error: 'Accès refusé' }, 403);
    }
    state.requests.push(url.pathname + url.search);
    const days = Number(url.searchParams.get('period') || 30), month = date().slice(0, 7);
    switch (url.pathname) {
      case '/health': return send(res, { status: 'ok', version: 'recette-fictive', uptime_seconds: 3600, database: { bic_entries: 1200 },
        bic_database_entries: 1200, bic_sources: [{ source: 'registre-fictif', entries: 1200, stale: false, last_updated: date().slice(0, 10) }] });
      case '/v1/admin/business-pulse': return state.business === 'unavailable' ? send(res, {}, 503) : send(res, pulse());
      case '/v1/admin/business-accounts': {
        if (state.hold === 'accounts') await new Promise(resolve => pending.push(resolve));
        if (state.accounts === 'network') { res.destroy(); return; }
        const status = { unauthorized: 401, forbidden: 403, unavailable: 503 }[state.accounts];
        if (status) return send(res, { error: 'Lecture fictivement refusée' }, status);
        if (state.accounts === 'invalid') return send(res, { incomplet: true });
        return send(res, accounts(url));
      }
      case '/v1/admin/activation': return send(res, activation(Number(url.searchParams.get('days') || 30)));
      case '/v1/admin/keys': return state.search === 'unavailable' ? send(res, {}, 503) : send(res, { keys: keys(), months: [month] });
      case '/v1/admin/client-profiles': return send(res, profiles(Number(url.searchParams.get('days') || 90)));
      case '/v1/admin/company-profiles': return send(res, { profiles: {} });
      case '/v1/admin/client-activity': return send(res, { by_key: {} });
      case '/v1/admin/prospects':
        if (state.search === 'unavailable') return send(res, {}, 503);
        if (state.search === 'invalid') { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{'); return; }
        return send(res, { prospects: state.relations ? relations() : [] });
      case '/v1/admin/email-messages': return send(res, { messages: state.relations ? ['zeta', 'eta', 'theta', 'iota'].map(name => ({ id: `message-fictif-${name}`, customer_email: `contact@${name}.example.net`, direction: name === 'theta' ? 'out' : 'in', msg_date: date(1), subject: 'Échange fictif', snippet: 'Bonjour, cet échange sert uniquement à la recette visuelle.', counterparty: name === 'iota' ? 'no-reply@iota.example.net' : null, no_reply_needed: name === 'zeta' ? 1 : 0 })) : [] });
      case '/v1/admin/institutional-contacts': return send(res, { contacts: [] });
      case '/v1/admin/thread-reads': return send(res, { reads: state.relations ? { 'contact@zeta.example.net': date(), 'contact@eta.example.net': date(), 'contact@theta.example.net': date(), 'contact@iota.example.net': date() } : {} });
      case '/v1/admin/orphan-mail': return send(res, { orphans: [], pending: 0 });
      case '/v1/admin/digest': return send(res, { digests: [] });
      case '/v1/admin/stripe-revenue':
        if (state.hold === 'stripe') await new Promise(resolve => pending.push(resolve));
        return state.stripe === 'unavailable' ? send(res, { error: 'Source fictivement indisponible' }, 503) : send(res, stripeRevenue());
      case '/admin/revenue': {
        const mode = url.searchParams.get('balance_only') === 'true' ? 'balance' : 'full';
        const amount = state.wallet, failed = state.walletFailure === mode, readAt = new Date().toISOString();
        if (state.hold === mode) await new Promise(resolve => pending.push(resolve));
        if (failed) return send(res, { error: 'Échec fictif de lecture' }, 503);
        const hash = `0x${'11'.repeat(32)}`;
        return send(res, { network: 'base', asset: 'USDC', balance_usdc: amount, read_at: readAt,
          total_received_usdc: 5, received_external_usdc: null, received_internal_usdc: null, internal_payers_configured: false,
          transaction_count: 1, recent: [{ hash, from: `0x${'00'.repeat(20)}`, value_usdc: 5, time: date(), explorer: `https://basescan.org/tx/${hash}` }],
          chunks_total: 1, chunks_attempted: 1, chunks_failed: 0, chunks_skipped: 0, scan_complete: true, block_range: { from: 1, to: 10 } });
      }
      case '/stats/pulse': return send(res, { last_write_at: date(), total_requests: 5000, requests_today: 100,
        operations_today: 80, operations_yesterday: 60, operations_by_day: Array.from({ length: 7 }, (_, i) => ({ date: date(6 - i).slice(0, 10), operations: 60 + i })) });
      case '/stats': return send(res, { total_requests: 5000, requests_today: 100, requests_by_path: [], last_write_at: date(),
        by_type: { iban_validate: { total: 100, valid_count: 90, success_rate: 90 }, iban_batch: { total: 20, valid_count: 18, success_rate: 90 }, bic_lookup: { total: 10, found_count: 9, hit_rate: 90 } },
        total_revenue_usdc: 0, total_revenue_usdc_clean: 0, top_countries: [] });
      case '/stats/history': return send(res, []);
      case '/stats/status-by-path': return send(res, { period_days: days, rows: statuses() });
      case '/stats/errors': return send(res, { error_rate: { iban_validate: { rate: 10, trend: [] }, bic_lookup: { rate: 10, trend: [] } }, top_invalid_ibans: [], top_missing_bics: [] });
      case '/stats/sources': return send(res, { by_client_kind: [] });
      case '/stats/patterns': return send(res, { geo_trend: [] });
      case '/stats/events': return send(res, { events: [] });
      default: return send(res, { error: 'Source non simulée dans cette recette' }, 503);
    }
  });
  return {
    server,
    async close() { release(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); },
  };
}

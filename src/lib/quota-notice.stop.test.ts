/**
 * Le STOP coupe aussi les alertes de consommation (décision de Claude-Alain du
 * 07.10.2026, point 8). Depuis la PR 363, un STOP faisait taire le mot du
 * fondateur et la relance d'activation ; l'alerte des 80 % du mois partait
 * encore, et celle des 10 % d'un pack de crédits aussi. Elles se taisent.
 *
 * Ce qui continue de partir à une adresse sous STOP, et pourquoi (la liste
 * complète est dans la description de la PR) :
 *   - les reçus et livraisons de ce qui a été payé (clé achetée, recharge,
 *     abonnement posé ou terminé, rapport d'audit) : la trace d'un paiement ;
 *   - les codes à six chiffres et les clés demandés à l'instant par la
 *     personne elle-même : la réponse à sa propre demande ;
 *   - les avis légaux (préavis d'arrêt selon les CGU, incident selon le DPA),
 *     qui ne partent d'aucun code de ce dépôt : un humain les envoie.
 * Le dernier test de ce fichier tient cette liste par la structure : seules les
 * deux alertes lisent la liste des STOP.
 *
 * Tous les envois passent par un relais simulé : rien ne sort.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, beforeEach, vi } from 'vitest';

const relay = vi.fn(async (_mail: { to: string; subject: string }) => true);

vi.mock('./mail-transport.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    isRelayConfigured: () => true,
    sendViaRelay: (mail: { to: string; subject: string }) => relay(mail),
  };
});

const { maybeSendCreditsWarning, maybeSendQuotaWarning } = await import('./quota-notice.js');
const { isAddressUnderStop } = await import('./activation-nudge-server.js');
const { sendRechargeEmail } = await import('./email.js');
const { generateApiKey, validateApiKey } = await import('./api-keys.js');
const { addAlias } = await import('./email-aliases.js');
const { getStatsDB } = await import('./db.js');

const RUN = Date.now();
const DOMAIN = 'alpha.example.net';
let seq = 0;

/** Une adresse neuve par test : la liste des STOP ne se lève jamais d'elle-même. */
function address(label: string): string {
  seq += 1;
  return `${label}-${RUN}-${seq}@${DOMAIN}`;
}

/** Une clé de plus de 24 heures : la garde « trop jeune » ne doit pas répondre à la place du STOP. */
function agedKey(email: string): string {
  const { keyHash } = validateApiKey(generateApiKey(email)!.api_key);
  getStatsDB()
    .prepare("UPDATE api_keys SET created_at = datetime('now', '-3 days') WHERE key_hash = ?")
    .run(keyHash);
  return keyHash;
}

function inbound(id: string, from: string, subject: string, body: string): void {
  getStatsDB()
    .prepare(
      `INSERT INTO email_messages (id, customer_email, direction, msg_date, subject, snippet, body, counterparty)
       VALUES (?, ?, 'in', ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      from,
      new Date().toISOString().slice(0, 16),
      subject,
      body.slice(0, 280),
      body,
      `"A person" <${from}>`,
    );
}

const quota = (keyHash: string, email: string, month: string) => ({
  keyHash,
  email,
  keyPrefix: 'ifk_test0000',
  used: 160,
  limit: 200,
  month,
});

beforeEach(() => relay.mockClear());

describe('le STOP fait taire les alertes de consommation', () => {
  it('un STOP reçu ce matin, avant toute passe quotidienne : l’alerte des 80 % ne part pas', async () => {
    const holder = address('stop-today');
    const keyHash = agedKey(holder);
    inbound(`stop-today-${RUN}`, holder, 'Re: your IBANforge key', 'STOP');

    expect(await maybeSendQuotaWarning(quota(keyHash, holder, '2031-01'))).toBe('stopped');
    expect(relay).not.toHaveBeenCalled();
  });

  it('le STOP survit à l’effacement du fil', async () => {
    const holder = address('stop-deleted');
    const keyHash = agedKey(holder);
    inbound(`stop-deleted-${RUN}`, holder, 'STOP', '');
    expect(isAddressUnderStop(holder)).toBe(true);
    getStatsDB().prepare('DELETE FROM email_messages WHERE id = ?').run(`stop-deleted-${RUN}`);

    expect(await maybeSendQuotaWarning(quota(keyHash, holder, '2031-02'))).toBe('stopped');
    expect(relay).not.toHaveBeenCalled();
  });

  it('un STOP venu d’une adresse déclarée comme alias couvre la personne', async () => {
    const canonical = address('canon');
    const alias = address('alias');
    expect(addAlias(alias, canonical)).toEqual({ ok: true });
    const keyHash = agedKey(canonical);
    inbound(`stop-alias-${RUN}`, alias, 'unsubscribe', '');

    expect(await maybeSendQuotaWarning(quota(keyHash, canonical, '2031-03'))).toBe('stopped');
    expect(relay).not.toHaveBeenCalled();
  });

  it('l’alerte des 10 % d’un pack de crédits se tait aussi', async () => {
    const holder = address('stop-credits');
    const keyHash = agedKey(holder);
    inbound(`stop-credits-${RUN}`, holder, 'Re: credits', 'Stop.');

    const outcome = await maybeSendCreditsWarning({
      keyHash,
      email: holder,
      keyPrefix: 'ifk_test0000',
      remaining: 90,
      total: 1000,
    });
    expect(outcome).toBe('stopped');
    expect(relay).not.toHaveBeenCalled();
  });

  it('une phrase qui contient « stop » n’est pas un STOP : l’alerte part', async () => {
    const holder = address('talker');
    const keyHash = agedKey(holder);
    inbound(`talker-${RUN}`, holder, 'Question', 'Stop by our booth next week if you can.');

    expect(await maybeSendQuotaWarning(quota(keyHash, holder, '2031-04'))).toBe('sent');
    expect(relay).toHaveBeenCalledTimes(1);
    expect(relay.mock.calls[0][0].to).toBe(holder);
  });

  it('un STOP ne brûle pas l’unique alerte du mois : levé à la main, elle part', async () => {
    const holder = address('lifted');
    const keyHash = agedKey(holder);
    inbound(`lifted-${RUN}`, holder, 'STOP', '');
    expect(await maybeSendQuotaWarning(quota(keyHash, holder, '2031-05'))).toBe('stopped');

    // Le seul geste qui lève un STOP : un humain efface la ligne, et le message.
    getStatsDB().prepare('DELETE FROM email_messages WHERE id = ?').run(`lifted-${RUN}`);
    getStatsDB().prepare('DELETE FROM outreach_stops WHERE email = ?').run(holder);

    expect(await maybeSendQuotaWarning(quota(keyHash, holder, '2031-05'))).toBe('sent');
  });
});

describe('ce qui continue de partir après un STOP', () => {
  it('le reçu d’une recharge part quand même : c’est la trace d’un paiement', async () => {
    const holder = address('receipt');
    inbound(`receipt-${RUN}`, holder, 'STOP', '');
    expect(isAddressUnderStop(holder)).toBe(true);

    const ok = await sendRechargeEmail({
      to: holder,
      keyPrefix: 'ifk_test0000',
      creditsAdded: 1000,
      balance: 1000,
      bundle: '1k',
    });
    expect(ok).toBe(true);
    expect(relay).toHaveBeenCalledTimes(1);
    expect(relay.mock.calls[0][0].to).toBe(holder);
  });

  it('seules les deux alertes de consommation lisent la liste des STOP', () => {
    const root = join(import.meta.dirname, '..');
    const readers: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (path.endsWith('.ts') && !path.endsWith('.test.ts')) {
          if (/isAddressUnderStop\(/.test(readFileSync(path, 'utf8'))) {
            readers.push(path.slice(root.length + 1));
          }
        }
      }
    };
    walk(root);
    // La définition, et les deux alertes de quota-notice.ts : un troisième
    // lecteur ferait taire un reçu, un code demandé ou un avis légal.
    expect(readers.sort()).toEqual(['lib/activation-nudge-server.ts', 'lib/quota-notice.ts']);
    const notice = readFileSync(join(root, 'lib/quota-notice.ts'), 'utf8');
    expect(notice.match(/isAddressUnderStop\(/g)).toHaveLength(2);
  });
});

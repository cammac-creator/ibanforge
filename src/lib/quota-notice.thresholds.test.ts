/**
 * Les alertes de quota après le chantier « compte client et alertes » (lot 1,
 * 27.11.2026) : seuils choisis par le client, un seul mail par seuil et par
 * mois, adresses ajoutées, STOP adresse par adresse, texte d'une clé qui paie,
 * message à l'exploitant seulement pour les clés payantes.
 *
 * Tous les envois passent par un relais simulé, et le canal de l'exploitant
 * est simulé aussi : rien ne sort. Fixtures inventées (dépôt public) :
 * alpha.example.net.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const relay = vi.fn(
  async (_mail: { to: string; subject: string; text: string; html?: string }) => true,
);
vi.mock('./mail-transport.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    isRelayConfigured: () => true,
    sendViaRelay: (mail: { to: string; subject: string; text: string; html?: string }) =>
      relay(mail),
  };
});
const operator = vi.fn((_kind: string, _text: string) => undefined);
vi.mock('./admin-alerts.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, adminEventAlert: (kind: string, text: string) => operator(kind, text) };
});

const { maybeSendQuotaWarning } = await import('./quota-notice.js');
const { generateApiKey, generateOemKey, validateApiKey, PRO_MONTHLY_LIMIT } =
  await import('./api-keys.js');
const { startRecipient, confirmRecipient, writeThresholds } = await import('./quota-alerts.js');
const { getStatsDB } = await import('./db.js');

const RUN = Date.now();
let seq = 0;
const DOMAIN = 'alpha.example.net';
const address = (label: string) => `${label}-${RUN}-${++seq}@${DOMAIN}`;

function age(keyHash: string): void {
  getStatsDB()
    .prepare("UPDATE api_keys SET created_at = datetime('now', '-3 days') WHERE key_hash = ?")
    .run(keyHash);
}

function freeKey(email: string, aged = true): string {
  const { keyHash } = validateApiKey(generateApiKey(email)!.api_key);
  if (aged) age(keyHash);
  return keyHash;
}

function proKey(email: string, aged = true): string {
  const made = generateOemKey(email, PRO_MONTHLY_LIMIT, `cs_${RUN}_${++seq}`, `sub_${RUN}_${seq}`);
  const { keyHash } = validateApiKey(made.api_key!);
  if (aged) age(keyHash);
  return keyHash;
}

function stop(email: string): void {
  getStatsDB()
    .prepare(
      `INSERT INTO email_messages (id, customer_email, direction, msg_date, subject, snippet, body, counterparty)
       VALUES (?, ?, 'in', ?, 'Re: alerts', 'STOP', 'STOP', ?)`,
    )
    .run(
      `stop-${RUN}-${++seq}`,
      email,
      new Date().toISOString().slice(0, 16),
      `"A person" <${email}>`,
    );
}

function addConfirmed(keyHash: string, email: string): void {
  startRecipient(keyHash, email, '123456');
  expect(confirmRecipient(keyHash, email, '123456').ok).toBe(true);
}

const free = (keyHash: string, email: string, month: string, crossed?: number[]) => ({
  keyHash,
  email,
  keyPrefix: 'ifk_free0000',
  used: 160,
  limit: 200,
  month,
  ...(crossed ? { crossed: crossed as Array<50 | 80 | 90 | 100> } : {}),
});
const pro = (keyHash: string, email: string, month: string, crossed: number[], used = 9000) => ({
  keyHash,
  email,
  keyPrefix: 'ifk_pro00000',
  used,
  limit: PRO_MONTHLY_LIMIT,
  month,
  crossed: crossed as Array<50 | 80 | 90 | 100>,
});

beforeEach(() => {
  relay.mockClear();
  operator.mockClear();
});

describe('comportement inchangé pour qui ne touche à rien', () => {
  it('80 % seul : une clé gratuite reçoit le texte d’avant, une fois par mois', async () => {
    const holder = address('default');
    const k = freeKey(holder);
    expect(await maybeSendQuotaWarning(free(k, holder, '2032-01'))).toBe('sent');
    const mail = relay.mock.calls[0][0];
    expect(mail.to).toBe(holder);
    expect(mail.subject).toBe('You are at 80% of your IBANforge free tier (80% alert)');
    expect(mail.text).toContain('has used 160 of its 200 free requests for 2032-01');
    expect(mail.text).toContain('before validation stops until the 1st of next month');
    expect(mail.text).not.toContain('Pro plan');
    expect(await maybeSendQuotaWarning(free(k, holder, '2032-01'))).toBe('already_notified');
    expect(relay).toHaveBeenCalledTimes(1);
  });

  it('un seuil que le client n’a pas choisi ne part pas et ne prend aucun verrou', async () => {
    const holder = address('not-chosen');
    const k = freeKey(holder);
    expect(await maybeSendQuotaWarning(free(k, holder, '2032-02', [50]))).toBe('not_selected');
    expect(relay).not.toHaveBeenCalled();
    // Le 80 % reste possible ensuite : rien n'a été verrouillé.
    expect(await maybeSendQuotaWarning(free(k, holder, '2032-02', [80]))).toBe('sent');
  });
});

describe('les seuils choisis', () => {
  it('un mail par seuil et par mois, jamais en rafale', async () => {
    const holder = address('multi');
    const k = freeKey(holder);
    writeThresholds(k, [50, 90]);
    expect(await maybeSendQuotaWarning(free(k, holder, '2032-03', [50]))).toBe('sent');
    expect(relay.mock.calls[0][0].subject).toContain('(50% alert)');
    expect(await maybeSendQuotaWarning(free(k, holder, '2032-03', [50]))).toBe('already_notified');
    expect(await maybeSendQuotaWarning(free(k, holder, '2032-03', [90]))).toBe('sent');
    expect(relay.mock.calls[1][0].subject).toContain('(90% alert)');
    expect(relay).toHaveBeenCalledTimes(2);
    // Le mois suivant, tout se réarme.
    expect(await maybeSendQuotaWarning(free(k, holder, '2032-04', [50]))).toBe('sent');
  });

  it('un lot qui saute plusieurs seuils envoie UN mail, au plus haut, et les verrouille tous', async () => {
    const holder = address('burst');
    const k = freeKey(holder);
    writeThresholds(k, [50, 80, 90]);
    expect(await maybeSendQuotaWarning(free(k, holder, '2032-05', [50, 80, 90]))).toBe('sent');
    expect(relay).toHaveBeenCalledTimes(1);
    expect(relay.mock.calls[0][0].subject).toContain('(90% alert)');
    for (const t of [50, 80, 90]) {
      expect(await maybeSendQuotaWarning(free(k, holder, '2032-05', [t])), `${t}`).toBe(
        'already_notified',
      );
    }
    expect(relay).toHaveBeenCalledTimes(1);
  });

  it('un envoi qui échoue partout rend les verrous : la nouvelle tentative part', async () => {
    const holder = address('retry');
    const k = freeKey(holder);
    relay.mockResolvedValueOnce(false);
    expect(await maybeSendQuotaWarning(free(k, holder, '2032-06'))).toBe('send_failed');
    expect(await maybeSendQuotaWarning(free(k, holder, '2032-06'))).toBe('sent');
  });
});

describe('une clé qui PAIE ne lit jamais « free »', () => {
  it('le texte Pro dit l’allocation de la formule, ce qui arrive au plafond et la date de remise à zéro', async () => {
    const holder = address('pro');
    const k = proKey(holder);
    expect(await maybeSendQuotaWarning(pro(k, holder, '2032-07', [80]))).toBe('sent');
    const mail = relay.mock.calls[0][0];
    expect(mail.subject).toContain('Pro plan');
    expect(mail.text).toContain(
      'has used 9,000 of the 10,000 requests of your Pro plan for 2032-07',
    );
    expect(mail.text).toContain('answer HTTP 402');
    expect(mail.text).toMatch(/starts over on \d{4}-\d{2}-01 00:00 UTC/);
    expect(mail.text).toContain('prepaid credits');
    expect(mail.text).not.toMatch(/free/i);
    expect(mail.html).not.toMatch(/free/i);
    expect(/[—–]/.test(mail.subject + mail.text + mail.html)).toBe(false);
  });

  it('avec des crédits sur la clé, ils prennent le relais', async () => {
    const holder = address('pro-credits');
    const k = proKey(holder);
    writeThresholds(k, [90]);
    expect(
      await maybeSendQuotaWarning({
        ...pro(k, holder, '2032-08', [90], 9000),
        creditsRemaining: 2500,
      }),
    ).toBe('sent');
    const mail = relay.mock.calls[0][0];
    expect(mail.text).toContain('your 2,500 prepaid credits on this key take over');
    expect(mail.text).not.toContain('answer HTTP 402');
  });

  it('à 100 %, le texte dit qu’il ne reste rien sur la formule', async () => {
    const holder = address('pro-full');
    const k = proKey(holder);
    writeThresholds(k, [100]);
    expect(await maybeSendQuotaWarning(pro(k, holder, '2032-09', [100], 10_000))).toBe('sent');
    expect(relay.mock.calls[0][0].text).toContain('No request is left on the plan');
  });

  it('le délai de 24 heures ne s’applique pas à une clé qui paie, mais à une gratuite', async () => {
    const payer = address('young-pro');
    const kp = proKey(payer, false);
    expect(await maybeSendQuotaWarning(pro(kp, payer, '2032-10', [80]))).toBe('sent');
    const young = address('young-free');
    const kf = freeKey(young, false);
    expect(await maybeSendQuotaWarning(free(kf, young, '2032-10'))).toBe('too_new');
  });
});

describe('les adresses ajoutées', () => {
  it('une adresse non confirmée ne reçoit RIEN', async () => {
    const holder = address('pending');
    const k = freeKey(holder);
    const later = address('later');
    startRecipient(k, later, '123456'); // le code n'a jamais été saisi
    expect(await maybeSendQuotaWarning(free(k, holder, '2033-01'))).toBe('sent');
    expect(relay.mock.calls.map((c) => c[0].to)).toEqual([holder]);
  });

  it('une adresse confirmée reçoit la même alerte, avec la phrase qui dit pourquoi et comment arrêter', async () => {
    const holder = address('with-extra');
    const k = freeKey(holder);
    const colleague = address('colleague');
    addConfirmed(k, colleague);
    expect(await maybeSendQuotaWarning(free(k, holder, '2033-02'))).toBe('sent');
    const sent = relay.mock.calls.map((c) => c[0]);
    expect(sent.map((m) => m.to).sort()).toEqual([colleague, holder].sort());
    const extra = sent.find((m) => m.to === colleague)!;
    const primary = sent.find((m) => m.to === holder)!;
    expect(extra.text).toContain('Reply STOP to stop receiving these alerts');
    expect(extra.html).toContain('Reply STOP');
    expect(primary.text).not.toContain('Reply STOP');
  });

  it('le STOP vaut pour UNE adresse : l’autre reçoit toujours', async () => {
    const holder = address('stop-one');
    const k = freeKey(holder);
    const colleague = address('colleague-stop');
    addConfirmed(k, colleague);
    stop(colleague);
    expect(await maybeSendQuotaWarning(free(k, holder, '2033-03'))).toBe('sent');
    expect(relay.mock.calls.map((c) => c[0].to)).toEqual([holder]);
  });

  it('le titulaire sous STOP : l’adresse ajoutée reçoit, lui non', async () => {
    const holder = address('stop-holder');
    const k = freeKey(holder);
    const colleague = address('colleague-ok');
    addConfirmed(k, colleague);
    stop(holder);
    expect(await maybeSendQuotaWarning(free(k, holder, '2033-04'))).toBe('sent');
    expect(relay.mock.calls.map((c) => c[0].to)).toEqual([colleague]);
  });

  it('toutes les adresses sous STOP : rien ne part et le verrou n’est pas brûlé', async () => {
    const holder = address('stop-all');
    const k = freeKey(holder);
    const colleague = address('colleague-all');
    addConfirmed(k, colleague);
    stop(holder);
    stop(colleague);
    expect(await maybeSendQuotaWarning(free(k, holder, '2033-05'))).toBe('stopped');
    expect(relay).not.toHaveBeenCalled();
    const left = getStatsDB()
      .prepare('SELECT COUNT(*) AS n FROM quota_notices WHERE key_hash = ?')
      .get(k) as { n: number };
    expect(left.n).toBe(0);
  });

  it('un échec d’envoi vers une adresse n’empêche pas l’autre, et le verrou reste pris', async () => {
    const holder = address('partial');
    const k = freeKey(holder);
    const colleague = address('colleague-partial');
    addConfirmed(k, colleague);
    relay.mockResolvedValueOnce(false);
    expect(await maybeSendQuotaWarning(free(k, holder, '2033-06'))).toBe('sent');
    expect(relay).toHaveBeenCalledTimes(2);
    expect(await maybeSendQuotaWarning(free(k, holder, '2033-06'))).toBe('already_notified');
  });
});

describe('le message à l’exploitant : seulement les clés payantes', () => {
  it('une clé Pro à 90 % : un message, avec le préfixe et la remise à zéro, sans adresse ni domaine', async () => {
    const holder = address('ops-pro');
    const k = proKey(holder);
    await maybeSendQuotaWarning(pro(k, holder, '2033-07', [90], 9000));
    expect(operator).toHaveBeenCalledTimes(1);
    const [kind, text] = operator.mock.calls[0];
    expect(kind).toBe('quota:paying-key');
    expect(text).toContain('ifk_pro00000');
    expect(text).toContain('90 %');
    expect(text).toContain('9000 sur 10000');
    expect(text).toMatch(/Remise à zéro le \d{4}-\d{2}-01 00:00 UTC/);
    expect(text).not.toContain('@');
    expect(text).not.toContain(DOMAIN);
    expect(text).not.toContain(holder.split('@')[0]);
  });

  it('un seul message par seuil et par mois', async () => {
    const holder = address('ops-once');
    const k = proKey(holder);
    await maybeSendQuotaWarning(pro(k, holder, '2033-08', [90]));
    await maybeSendQuotaWarning(pro(k, holder, '2033-08', [90]));
    expect(operator).toHaveBeenCalledTimes(1);
  });

  it('un lot qui saute 80, 90 et 100 ne fait qu’un message, au plus haut seuil', async () => {
    const holder = address('ops-burst');
    const k = proKey(holder);
    await maybeSendQuotaWarning(pro(k, holder, '2033-09', [50, 80, 90, 100], 10_000));
    expect(operator).toHaveBeenCalledTimes(1);
    expect(operator.mock.calls[0][1]).toContain('100 %');
  });

  it('même quand le client n’a pas choisi ce seuil, et même si son adresse est sous STOP', async () => {
    const holder = address('ops-stop');
    const k = proKey(holder);
    writeThresholds(k, [50]);
    stop(holder);
    await maybeSendQuotaWarning(pro(k, holder, '2033-10', [90]));
    expect(operator).toHaveBeenCalledTimes(1);
    expect(relay).not.toHaveBeenCalled();
  });

  it('une clé gratuite ne déclenche rien, quel que soit le seuil', async () => {
    const holder = address('ops-free');
    const k = freeKey(holder);
    await maybeSendQuotaWarning(free(k, holder, '2033-11', [80, 90, 100]));
    expect(operator).not.toHaveBeenCalled();
  });

  it('le seuil de 50 % ne réveille pas l’exploitant, même sur une clé payante', async () => {
    const holder = address('ops-fifty');
    const k = proKey(holder);
    await maybeSendQuotaWarning(pro(k, holder, '2033-12', [50], 5000));
    expect(operator).not.toHaveBeenCalled();
  });
});

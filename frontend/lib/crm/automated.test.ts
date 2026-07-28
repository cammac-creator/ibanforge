import { describe, expect, it } from 'vitest';
import { humanOnly, isAutomated } from './automated';
import type { Message } from './types';

/**
 * Fixtures are anonymized. The wording of every automated one is the standard
 * formula of its class, taken from messages actually received; the names,
 * addresses and companies are invented, because this file is public and the
 * mailbox is not.
 *
 * The case that shapes the whole module is `desk` below: one address sending
 * an acknowledgement, a human reply, a nag and a survey. Any implementation
 * that keys on the sender fails it, and fails it silently.
 */
const desk = 'hello@northwind.example.net';

function inbound(subject: string, snippet: string, counterparty = desk): Message {
  return { direction: 'in', msg_date: '2026-07-21T12:00', subject, snippet, counterparty };
}

describe('isAutomated', () => {
  it('leaves our own mail alone, whatever it says', () => {
    const out: Message = {
      direction: 'out',
      msg_date: '2026-07-21T12:00',
      subject: 'We have received your request',
      snippet: 'Ticket number #44453',
      counterparty: desk,
    };
    expect(isAutomated(out)).toBe(false);
    expect(isAutomated({ ...out, direction: 'draft' })).toBe(false);
  });

  describe('the four messages of one support desk', () => {
    const ack = inbound(
      '[Northwind] We have received your request - Ticket number #44453',
      'Hi, Thank you for contacting the Northwind Customer Experience Team. We have received your message and will get back to you within 1 working day.',
    );
    const human = inbound(
      '[Northwind] Beneficiary IBAN checks as you scale EUR/SEPA payouts',
      'Hi, Thank you for reaching out, and we appreciate your kind words on the acquisition. Your solution sounds interesting, and we would like to understand the pricing.',
    );
    const nag = inbound(
      'Quick follow-up: Beneficiary IBAN checks as you scale EUR/SEPA payouts',
      'Hi, We are just checking in regarding your support request. We have not heard back from you yet, so we wanted to follow up and see if you still need any assistance from us.',
    );
    const survey = inbound(
      '[Beneficiary IBAN checks...] How was your Northwind Support experience?',
      'Hello, Thank you for reaching out to Northwind Support. Rate your support experience below regarding your request.',
    );

    it('catches the acknowledgement', () => expect(isAutomated(ack)).toBe(true));
    it('catches the nag', () => expect(isAutomated(nag)).toBe(true));
    it('catches the survey', () => expect(isAutomated(survey)).toBe(true));

    it('LETS THE HUMAN REPLY THROUGH, from the very same address', () => {
      // The regression this module exists to avoid creating. Classing this one
      // as a robot would silently move a company that answered into the
      // follow-up queue, which is worse than the bug being fixed.
      expect(isAutomated(human)).toBe(false);
    });

    it('keeps exactly the human one', () => {
      expect(humanOnly([ack, human, nag, survey])).toEqual([human]);
    });
  });

  it('catches a French ticket acknowledgement', () => {
    const m = inbound(
      'Valider IBAN du bénéficiaire sur votre cash-out SEPA',
      'Bonjour, Merci de nous avoir contactés ! Nous avons bien reçu votre message et un ticket a été créé dans notre système.',
      'hello@alpenbank.example.net',
    );
    expect(isAutomated(m)).toBe(true);
  });

  it('catches a bare request receipt whose subject carries no clue', () => {
    const m = inbound(
      '[Request received]',
      'Your request (105235) has been received and is being reviewed by our support staff.',
      'customersuccess@fabrikam.example.net',
    );
    expect(isAutomated(m)).toBe(true);
  });

  it('catches an out of office and a bounce', () => {
    expect(isAutomated(inbound('Re: your mail', 'I am out of office until 12 August.'))).toBe(true);
    expect(isAutomated(inbound('Undeliverable: your mail', 'Mail delivery failed.'))).toBe(true);
  });

  it('catches a sender that is never a person', () => {
    // No marker in the text at all: the address alone carries it.
    const m = inbound('Your invoice', 'Please find the document attached.', 'no-reply@fabrikam.example.net');
    expect(isAutomated(m)).toBe(true);
  });

  it('does not treat a desk address as proof on its own', () => {
    const m = inbound('Re: your question', 'Hi, yes we do that today, happy to talk next week.', 'support@fabrikam.example.net');
    expect(isAutomated(m)).toBe(false);
  });

  describe('ordinary human replies stay human', () => {
    const cases: Array<[string, string, string]> = [
      ['short and enthusiastic', 'Re: Quick question', 'Hi! We need auto filling for our CRM system. Everything works fine.'],
      ['not in a latin script', 'Re: Thank you', '你好： 返回的银行地址不准确。 我们需要详细的地址，但是并没有获取到。'],
      ['thanking us without a formula', 'Re: The payee half', 'Hi, Received, thank you - the countersigned copy is filed on our side, so we are all set.'],
      ['a reply that quotes us', 'Re: Two things', '> > Hi, > > Two things done on my side: the document is signed and the batch is run.'],
      ['opening with thanks for reaching out', 'Re: your MCP', 'Hi, thanks for reaching out, and for actually looking at what we do before writing.'],
    ];
    for (const [name, subject, snippet] of cases) {
      it(name, () => expect(isAutomated(inbound(subject, snippet))).toBe(false));
    }
  });

  it('reads the body when there is one, and the snippet otherwise', () => {
    const bodyOnly: Message = {
      direction: 'in',
      msg_date: '2026-07-21T12:00',
      subject: 'Re: hello',
      snippet: null,
      body: 'Your ticket number #99 has been created.',
      counterparty: desk,
    };
    expect(isAutomated(bodyOnly)).toBe(true);
  });

  it('ignores a robot formula buried deep in a quoted history', () => {
    // A human replying under a quoted acknowledgement must stay human. The
    // scan is capped, so the formula below the fold never decides.
    const m: Message = {
      direction: 'in',
      msg_date: '2026-07-21T12:00',
      subject: 'Re: your request',
      snippet: null,
      body: `Hi, sorry for the delay, yes let us set up a call next week.\n\n${'> quoted line\n'.repeat(40)}> We have received your message and a ticket has been created.`,
      counterparty: desk,
    };
    expect(isAutomated(m)).toBe(false);
  });

  it('survives empty and missing fields', () => {
    const bare: Message = { direction: 'in', msg_date: null, subject: null, snippet: null, counterparty: null };
    expect(isAutomated(bare)).toBe(false);
  });
});

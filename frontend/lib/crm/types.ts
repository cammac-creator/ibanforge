/** One row of email_messages. 'draft' rows are CRM-native drafts, never correspondence. */
export interface Message {
  id?: string;
  direction: 'in' | 'out' | 'draft';
  msg_date: string | null;
  subject: string | null;
  snippet: string | null;
  snippet_fr?: string | null;
  lang?: string | null;
  body?: string | null;
  counterparty: string | null;
}

export interface ClientKeyInfo {
  keyPrefix: string;
  paid: boolean;
  creditsTotal: number | null;
  creditsRemaining: number | null;
  monthlyLimit: number | null;
  usedAllTime: number;
  lastActiveMonth: string | null;
  /** When the key was minted, as stored. */
  createdAt: string | null;
  /**
   * Whether that is recent enough to still be a new customer. Decided once,
   * server-side, against one clock: see lib/crm/new-signup.ts. A boolean rather
   * than a date so the client never re-derives it and disagrees with the server.
   */
  isNew: boolean;
}

export interface UsageSeries {
  series: number[];
  months: string[];
  days: Array<{ day: string; count: number }>;
  endpoints: Array<{ path: string; count: number }>;
}

/**
 * The four things learned about a contact that the sourcing state cannot say.
 * Deliberately short: a longer list is a list nobody fills in honestly.
 */
export type Outcome = 'en_discussion' | 'pas_maintenant' | 'pas_interesse' | 'mauvaise_personne';

export interface ProspectSourcing {
  prospectId: string;
  segment: string | null;
  whatTheyDo: string | null;
  fitReason: string | null;
  buyingSignal: string | null;
  signalSourceUrl: string | null;
  contactName: string | null;
  contactRole: string | null;
  emailSourceUrl: string | null;
  personalizationHook: string | null;
  confidence: string | null;
  /** Sourcing state: where finding and contacting them got to. */
  status: string;
  source: string | null;
  /** When the row entered the base — the reservoir gauge dates the last harvest with it. */
  createdAt: string | null;
  /**
   * Where the RELATIONSHIP got to, which no value of `status` can express.
   * Null means nothing has been recorded, which is not a negative outcome.
   */
  outcome: Outcome | null;
  /** The operator's own words on why. */
  outcomeNote: string | null;
  /** YYYY-MM-DD, only ever set with 'pas_maintenant'. */
  wakeUpAt: string | null;
  /** When the outcome was recorded, so a stale judgement shows as one. */
  outcomeAt: string | null;
}

export interface ReadyMail {
  subjectEn: string | null;
  bodyEn: string | null;
  subjectFr: string | null;
  bodyFr: string | null;
  recommendedLang: 'fr' | 'en';
}

/**
 * The API's per-email activation verdict, joined into the CRM so the list can
 * finally tell a paying customer from a cold prospect at a glance. Same
 * vocabulary as /v1/admin/activation — never recomputed here, because the
 * dashboard reads the same endpoint and two computations would disagree.
 */
export type BusinessStatus = 'new' | 'active' | 'at-limit' | 'paying' | 'dormant' | 'silent';

export interface BusinessInfo {
  status: BusinessStatus;
  /** Signup source recorded on key creation ('direct' when none). */
  source: string;
  creditsTotal: number;
  creditsRemaining: number;
  /** Paid credit keys owned by this address. */
  packs: number;
  firstCallAt: string | null;
  calls90d: number;
}

/**
 * An institutional correspondent: an authority, a central bank, a payment
 * scheme, a registry, a supplier. Somebody we send WRITTEN REQUESTS to (a data
 * permission, a regulatory question) and whose answers have to be findable
 * months later, next to the letter that provoked them.
 *
 * Nothing here is a sales field, and that is the point. There is no confidence
 * score, no buying signal and no segment, because none of those mean anything
 * about a supervisor: the file is `dossier`, one line saying what we are asking
 * them for, and it is what the answer generator is grounded in.
 *
 * `category` is free TEXT on the wire, exactly as the API stores it. The usual
 * values (autorite, banque_centrale, reseau_paiement, registre, fournisseur,
 * autre) are the ones the UI knows how to name; anything else displays as
 * itself rather than being rejected, so the operator can file a correspondent
 * the vocabulary did not foresee instead of being stopped by a dropdown.
 */
export interface InstitutionInfo {
  /** The organisation, as it should be written to. Never empty. */
  org: string;
  /** Free TEXT. See the note above on why this is not an enum. */
  category: string;
  country: string | null;
  /** The desk or job title on the other end, when we know one. */
  role: string | null;
  website: string | null;
  /** What we are asking them for, in one line. The generator's ground truth. */
  dossier: string | null;
}

export interface ContactBase {
  /** Lowercased email — the join key for messages and read state. */
  id: string;
  email: string;
  company: string | null;
  country: string | null;
  website: string | null;
  /** Correspondence only, sorted by msg_date ascending. Never contains drafts. */
  messages: Message[];
  /** At most one CRM-native draft. */
  draft: Message | null;
  unread: boolean;
  /** Mailbox to send from for this contact. */
  account: string;
  /** Absent on prospects without a key, and when the activation fetch failed. */
  business?: BusinessInfo;
}

export type Contact =
  | (ContactBase & {
      kind: 'client';
      apiKey: ClientKeyInfo;
      usage: UsageSeries;
      /** Present when this client came from the prospect list. */
      sourcing?: ProspectSourcing;
    })
  | (ContactBase & {
      kind: 'prospect';
      sourcing: ProspectSourcing;
      readyMail: ReadyMail | null;
    })
  | (ContactBase & {
      kind: 'institution';
      institution: InstitutionInfo;
      /**
       * Declared, always undefined, and load-bearing rather than tidy-up bait.
       *
       * `sourcing` is optional on the client member and required on the
       * prospect one, so `c.sourcing` reads off the union as
       * `ProspectSourcing | undefined` and half a dozen call sites do exactly
       * that (funnel.ts, mail-rows.ts, priority.ts, snooze.ts, the header, the
       * reply sheet). A third member that simply omitted the property would
       * make every one of those a type error, and the fix each time would be a
       * `kind` test that says nothing — an institution has no sourcing because
       * nobody sourced it, which is precisely what `undefined` means here.
       *
       * Deleting this line does not simplify anything; it moves the same fact
       * into six narrowings.
       */
      sourcing?: undefined;
    });

export type NextAction = 'first_mail' | 'reply' | 'followup' | 'firm_offer' | 'wait';

export interface Situation {
  ballInCourt: 'us' | 'them' | 'none';
  silenceDays: number | null;
  followupDue: boolean;
  firstContactAt: string | null;
  hasEverReplied: boolean;
  /**
   * Datable correspondence only. Drafts never count, and neither do messages
   * whose msg_date cannot be read, since a message that cannot be placed in
   * time cannot take part in a thread shown next to a silence duration.
   */
  messageCount: number;
  nextAction: NextAction;
}

export interface GuardrailIssue {
  code:
    | 'em_dash'
    | 'empty_body'
    | 'daily_cap'
    | 'daily_high'
    | 'length'
    | 'too_many_links'
    | 'no_optout'
    | 'spam_word'
    | 'repeat_previous'
    | 'same_subject';
  level: 'blocking' | 'warning';
  message: string;
}

export interface GuardrailReport {
  issues: GuardrailIssue[];
  blocking: boolean;
}

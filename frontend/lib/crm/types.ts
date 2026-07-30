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

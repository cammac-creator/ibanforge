import type { CalendarCopy } from './copy';

export const COPY_EN: CalendarCopy = {
  meta: {
    title: 'TARGET (T2) and SIC closing days {year}: euro and franc',
    description:
      'The days in {year} when TARGET (T2, formerly TARGET2), SIC and euroSIC are closed, in one calendar, with the dates from SIX and the ECB and their sources.',
    ogLocale: 'en_US',
  },
  breadcrumbHome: 'Home',
  hero: {
    eyebrow: 'Payment calendar {year}',
    h1: 'SIC, euroSIC and TARGET (T2) closing days in {year}',
    answer: {
      sic: 'SIC, the Swiss franc system of SIX Interbank Clearing, has no clearing day on {count} weekdays in {year}: {days}.',
      eurosic: 'euroSIC, its system for euro, has no clearing day on {count} weekdays: {days}.',
      target: 'T2, which settles large-value payments in euro, is closed on {count} weekdays: {days}.',
    },
    weekends: 'On Saturdays and Sundays, all three are closed.',
    meaning:
      'On this page, closed means a weekday that SIX does not list as a clearing day of SIC or euroSIC, or a TARGET closing day of the European Central Bank for T2.',
    fileLine:
      'Swiss dates read from the clearing day calendar of SIX, file generated on {date} at {time} (UTC{offset}). T2 dates from the rule of the ECB.',
  },
  systems: { sic: 'SIC', eurosic: 'euroSIC', target: 'T2' },
  differ: {
    heading: 'Where they differ in {year}',
    intro: 'On these weekdays the Swiss franc and the euro do not follow the same calendar.',
    item: '{day}, {holiday}: {closed} closed, {open} open.',
  },
  glance: {
    heading: '{year} at a glance',
    intro: 'One square per day, weeks starting on Monday. The list below gives every date in words.',
    weekdays: ['M', 'T', 'W', 'T', 'F', 'S', 'S'],
    legend: {
      all: 'Closed in all three',
      partial: '{closed} closed, {open} open',
      weekend: 'Weekend: closed in all three',
      weekendHoliday: 'Holiday falling on a weekend',
      open: 'Open in all three',
    },
  },
  dates: {
    heading: 'The dates, system by system',
    intro:
      'Every weekday of {year} on which at least one system is closed, and the eves that SIX lists as clearing days.',
    colDay: 'Day',
    closed: 'closed',
    open: 'open',
    weekendLine: 'Falling on a weekend in {year}: {days}.',
  },
  holidays: {
    newYear: "New Year's Day",
    berchtold: "Berchtold's Day",
    goodFriday: 'Good Friday',
    easterMonday: 'Easter Monday',
    labourDay: 'Labour Day',
    ascension: 'Ascension Day',
    whitMonday: 'Whit Monday',
    nationalDay: 'Swiss National Day',
    christmasEve: 'Christmas Eve',
    christmas: 'Christmas Day',
    stStephen: "St Stephen's Day",
    newYearsEve: "New Year's Eve",
  },
  cards: {
    heading: 'The three systems',
    about: {
      sic: 'Swiss francs, run by SIX Interbank Clearing.',
      eurosic: 'Euro, run by SIX Interbank Clearing.',
      target:
        'Euro, large-value payments in central bank money. The ECB says T2 replaced TARGET2 in March 2023.',
    },
    closedCount: '{count} weekdays closed in {year}',
    service: 'In the SIX file: service {code}',
    rule: 'Closed on 1 January, Good Friday, Easter Monday, 1 May, 25 and 26 December, and at weekends.',
    eurosicEnd:
      'SIX states that the euroSIC payment system will be discontinued effective 31 December 2027. Its schedule for 2027 still lists that day as a clearing day.',
  },
  transfer: {
    heading: 'What a closed day means for a transfer',
    t2: 'The ECB states that T2 is closed for euro settlement on Saturdays, Sundays and the six TARGET closing days.',
    psd2:
      "For a customer's transfer in the EU, the days that count are those of the banks. The Payment Services Directive (EU) 2015/2366 defines a business day as a day on which the payer's or the payee's payment service provider is open for business as required for the execution of a payment (Article 4(37)). A payment order received on a day that is not a business day for the payer's provider is deemed received on the following business day (Article 78(1)).",
    cutOff:
      'The same article lets the provider set a cut-off time near the end of a business day, after which an order counts as received on the following business day.',
  },
  sources: {
    heading: 'Sources',
    sixFile: 'SIX Interbank Clearing, Clearing Day Calendar (CSV file), generated on {date} at {time} (UTC{offset})',
    specification: 'Specification of the file, version 1.0',
    sixSchedule: 'SIX Interbank Clearing, Schedule of clearing days 2027 (PDF), against which every date is checked',
    sixChanges:
      'SIX updates its calendar every day at around 16:30. The dates are planned events and may change; postponements at short notice are not in the file but are sent by the service itself, as ISO 20022 messages.',
    sixPage: 'SIX, the clearing day calendar page',
    eurosicPage: 'SIX, the euroSIC page (discontinuation on 31 December 2027)',
    ecbRule: 'ECB, What is T2? (the days T2 is closed)',
    ecbHolidays: 'ECB, public holidays, with the days marked TARGET closing day',
    psd2: 'Directive (EU) 2015/2366 on payment services, on EUR-Lex',
    readOn: 'read on {date}',
  },
  next: {
    heading: 'Read on',
    iid: 'Swiss clearing numbers (IID), from the SIX bank master',
    country: 'The Swiss IBAN, field by field',
    tools: 'Free tools, no key needed',
  },
  and: 'and',
  listSeparator: ', ',
};

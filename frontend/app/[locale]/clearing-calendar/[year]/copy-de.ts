import type { CalendarCopy } from './copy';

export const COPY_DE: CalendarCopy = {
  meta: {
    title: 'TARGET- und SIC-Feiertage {year}: Euro und Franken',
    description:
      'Wann TARGET (T2, früher TARGET2), SIC und euroSIC {year} geschlossen sind: alle Tage in einem Kalender, mit den Daten von SIX und der EZB und ihren Quellen.',
    ogLocale: 'de_DE',
  },
  breadcrumbHome: 'Startseite',
  hero: {
    eyebrow: 'Zahlungskalender {year}',
    h1: 'Schließtage von SIC, euroSIC und TARGET (T2) {year}',
    answer: {
      sic: 'SIC, das Franken-System von SIX Interbank Clearing, hat {year} an {count} Tagen von Montag bis Freitag keinen Clearingtag: {days}.',
      eurosic: 'euroSIC, das Euro-System von SIX Interbank Clearing, hat an {count} Tagen von Montag bis Freitag keinen Clearingtag: {days}.',
      target: 'T2, über das Großbetragszahlungen in Euro abgewickelt werden, ist an {count} Tagen von Montag bis Freitag geschlossen: {days}.',
    },
    weekends: 'Samstags und sonntags sind alle drei geschlossen.',
    meaning:
      'Geschlossen heißt auf dieser Seite: ein Tag von Montag bis Freitag, den SIX für SIC oder euroSIC nicht als Clearingtag führt, oder für T2 ein TARGET-Schließtag der Europäischen Zentralbank.',
    fileLine:
      'Schweizer Daten aus dem Clearingtag-Kalender von SIX, Datei erzeugt am {date} um {time} Uhr (UTC{offset}). Daten von T2 nach der Regel der EZB.',
  },
  systems: { sic: 'SIC', eurosic: 'euroSIC', target: 'T2' },
  differ: {
    heading: 'Wo sie {year} auseinandergehen',
    intro: 'An diesen Tagen folgen Franken und Euro nicht demselben Kalender.',
    item: '{day}, {holiday}: {closed} geschlossen, {open} offen.',
  },
  glance: {
    heading: '{year} auf einen Blick',
    intro: 'Ein Feld pro Tag, die Woche beginnt am Montag. Die Liste darunter nennt jedes Datum in Worten.',
    weekdays: ['M', 'D', 'M', 'D', 'F', 'S', 'S'],
    legend: {
      all: 'In allen drei geschlossen',
      partial: '{closed} geschlossen, {open} offen',
      weekend: 'Wochenende: in allen drei geschlossen',
      weekendHoliday: 'Feiertag am Wochenende',
      open: 'In allen drei offen',
    },
  },
  dates: {
    heading: 'Die Daten, System für System',
    intro:
      'Jeder Tag von Montag bis Freitag im Jahr {year}, an dem mindestens ein System geschlossen ist, sowie die Tage vor Weihnachten und Neujahr, die SIX als Clearingtage führt.',
    colDay: 'Tag',
    closed: 'geschlossen',
    open: 'offen',
    weekendLine: 'Auf ein Wochenende fallen {year}: {days}.',
  },
  holidays: {
    newYear: 'Neujahr',
    berchtold: 'Berchtoldstag',
    goodFriday: 'Karfreitag',
    easterMonday: 'Ostermontag',
    labourDay: 'Tag der Arbeit',
    ascension: 'Auffahrt (Christi Himmelfahrt)',
    whitMonday: 'Pfingstmontag',
    nationalDay: 'Bundesfeiertag',
    christmasEve: 'Heiligabend',
    christmas: 'Weihnachtstag',
    stStephen: 'Stephanstag',
    newYearsEve: 'Silvester',
  },
  cards: {
    heading: 'Die drei Systeme',
    about: {
      sic: 'Schweizer Franken, betrieben von SIX Interbank Clearing.',
      eurosic: 'Euro, betrieben von SIX Interbank Clearing.',
      target: 'Euro, Großbetragszahlungen in Zentralbankgeld. Laut EZB hat T2 im März 2023 TARGET2 abgelöst.',
    },
    closedCount: '{year} an {count} Tagen von Montag bis Freitag geschlossen',
    service: 'In der Datei von SIX: Dienst {code}',
    rule: 'Geschlossen am 1. Januar, Karfreitag, Ostermontag, 1. Mai, 25. und 26. Dezember sowie am Wochenende.',
    eurosicEnd:
      'Laut SIX wird das Zahlungssystem euroSIC per 31. Dezember 2027 eingestellt. Sein Kalender für 2027 führt diesen Tag noch als Clearingtag.',
  },
  transfer: {
    heading: 'Was ein geschlossener Tag für eine Überweisung bedeutet',
    t2: 'Laut EZB ist T2 für die Abwicklung in Euro samstags, sonntags und an den sechs TARGET-Schließtagen geschlossen.',
    psd2:
      'Für die Überweisung eines Kunden in der EU zählen die Geschäftstage der Banken. Die Zahlungsdiensterichtlinie (EU) 2015/2366 versteht unter einem Geschäftstag einen Tag, an dem der Zahlungsdienstleister des Zahlers oder des Zahlungsempfängers den für die Ausführung eines Zahlungsvorgangs erforderlichen Geschäftsbetrieb unterhält (Artikel 4 Nummer 37). Ein Zahlungsauftrag, der an einem Tag eingeht, der für den Zahlungsdienstleister des Zahlers kein Geschäftstag ist, gilt als am folgenden Geschäftstag eingegangen (Artikel 78 Absatz 1).',
    cutOff:
      'Derselbe Artikel erlaubt dem Zahlungsdienstleister einen Annahmeschluss gegen Ende eines Geschäftstags. Ein Auftrag, der danach eingeht, gilt als am folgenden Geschäftstag eingegangen.',
  },
  sources: {
    heading: 'Quellen',
    sixFile: 'SIX Interbank Clearing, Clearing Day Calendar (CSV-Datei), erzeugt am {date} um {time} Uhr (UTC{offset})',
    specification: 'Spezifikation der Datei, Version 1.0',
    sixSchedule: 'SIX Interbank Clearing, Schedule of clearing days 2027 (PDF), mit dem jedes Datum abgeglichen ist',
    sixChanges:
      'SIX aktualisiert den Kalender jeden Tag gegen 16.30 Uhr. Die Daten sind geplante Ereignisse und können sich ändern. Kurzfristige Verschiebungen stehen nicht in der Datei: Der jeweilige Dienst teilt sie direkt mit, als Meldungen nach ISO 20022.',
    sixPage: 'SIX, Seite des Clearingtag-Kalenders',
    eurosicPage: 'SIX, Seite zu euroSIC (Einstellung per 31. Dezember 2027)',
    ecbRule: 'EZB, What is T2? (die Tage, an denen T2 geschlossen ist)',
    ecbHolidays: 'EZB, Feiertage, mit den als TARGET closing day markierten Tagen',
    psd2: 'Richtlinie (EU) 2015/2366 über Zahlungsdienste, auf EUR-Lex',
    readOn: 'gelesen am {date}',
  },
  next: {
    heading: 'Weiterlesen',
    iid: 'Schweizer Clearingnummern (IID) aus dem Bank Master von SIX',
    country: 'Die Schweizer IBAN, Feld für Feld',
    tools: 'Kostenlose Werkzeuge, ohne Schlüssel',
  },
  and: 'und',
  listSeparator: '; ',
};

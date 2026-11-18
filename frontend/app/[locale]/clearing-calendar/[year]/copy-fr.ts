import type { CalendarCopy } from './copy';

export const COPY_FR: CalendarCopy = {
  meta: {
    title: 'Jours de fermeture TARGET et SIC en {year} : euro et franc',
    description:
      'Les jours de {year} où TARGET (T2, anciennement TARGET2), SIC et euroSIC sont fermés, dans un calendrier, avec les dates de SIX et de la BCE et leurs sources.',
    ogLocale: 'fr_FR',
  },
  breadcrumbHome: 'Accueil',
  hero: {
    eyebrow: 'Calendrier des paiements {year}',
    h1: 'Jours de fermeture de SIC, euroSIC et TARGET (T2) en {year}',
    answer: {
      sic: 'En {year}, {count} jours de semaine ne sont pas des jours de clearing de SIC, le système en francs suisses de SIX Interbank Clearing : {days}.',
      eurosic: 'Pour euroSIC, son système en euros, {count} jours de semaine ne sont pas des jours de clearing : {days}.',
      target: 'T2, par lequel se règlent les gros paiements en euros, est fermé {count} jours de semaine : {days}.',
    },
    weekends: 'Le samedi et le dimanche, les trois sont fermés.',
    meaning:
      "Sur cette page, fermé veut dire un jour de semaine que SIX ne compte pas comme jour de clearing de SIC ou d'euroSIC, ou, pour T2, un jour de fermeture de TARGET selon la Banque centrale européenne.",
    fileLine:
      'Dates suisses tirées du calendrier des jours de clearing de SIX, fichier produit le {date} à {time} (UTC{offset}). Dates de T2 selon la règle de la BCE.',
  },
  systems: { sic: 'SIC', eurosic: 'euroSIC', target: 'T2' },
  differ: {
    heading: 'Là où ils diffèrent en {year}',
    intro: "Ces jours-là, le franc et l'euro ne suivent pas le même calendrier.",
    item: '{day}, {holiday} : fermé pour {closed}, ouvert pour {open}.',
  },
  glance: {
    heading: "{year} en un coup d'œil",
    intro: 'Une case par jour, semaines commençant le lundi. La liste plus bas donne chaque date en toutes lettres.',
    weekdays: ['L', 'M', 'M', 'J', 'V', 'S', 'D'],
    legend: {
      all: 'Fermé dans les trois',
      partial: 'Fermé pour {closed}, ouvert pour {open}',
      weekend: 'Week-end : fermé dans les trois',
      weekendHoliday: 'Jour férié tombant un week-end',
      open: 'Ouvert dans les trois',
    },
  },
  dates: {
    heading: 'Les dates, système par système',
    intro:
      'Chaque jour de semaine de {year} où au moins un système est fermé, et les veilles que SIX compte comme jours de clearing.',
    colDay: 'Jour',
    closed: 'fermé',
    open: 'ouvert',
    weekendLine: 'Tombent un week-end en {year} : {days}.',
  },
  holidays: {
    newYear: 'Nouvel An',
    berchtold: 'Saint-Berthold',
    goodFriday: 'Vendredi saint',
    easterMonday: 'lundi de Pâques',
    labourDay: 'Fête du travail',
    ascension: 'Ascension',
    whitMonday: 'lundi de Pentecôte',
    nationalDay: 'Fête nationale suisse',
    christmasEve: 'Veille de Noël',
    christmas: 'Noël',
    stStephen: 'Saint-Étienne',
    newYearsEve: 'Saint-Sylvestre',
  },
  cards: {
    heading: 'Les trois systèmes',
    about: {
      sic: 'Francs suisses, exploité par SIX Interbank Clearing.',
      eurosic: 'Euros, exploité par SIX Interbank Clearing.',
      target: 'Euros, gros paiements en monnaie de banque centrale. Selon la BCE, T2 a remplacé TARGET2 en mars 2023.',
    },
    closedCount: 'Fermé {count} jours de semaine en {year}',
    service: 'Dans le fichier de SIX : service {code}',
    rule: 'Fermé le 1er janvier, le Vendredi saint, le lundi de Pâques, le 1er mai, les 25 et 26 décembre, et le week-end.',
    eurosicEnd:
      "SIX indique que le système de paiement euroSIC sera arrêté avec effet au 31 décembre 2027. Son calendrier de 2027 compte encore ce jour comme jour de clearing.",
  },
  transfer: {
    heading: "Ce qu'un jour fermé change pour un virement",
    t2: 'Selon la BCE, T2 est fermé pour le règlement en euros le samedi, le dimanche et les six jours de fermeture de TARGET.',
    psd2:
      "Pour le virement d'un client dans l'UE, ce sont les jours des banques qui comptent. La directive (UE) 2015/2366 concernant les services de paiement appelle jour ouvrable un jour où le prestataire du payeur ou celui du bénéficiaire exerce l'activité permettant d'exécuter une opération de paiement (article 4, point 37). Un ordre reçu un jour qui n'est pas ouvrable pour le prestataire du payeur est réputé reçu le jour ouvrable suivant (article 78, paragraphe 1).",
    cutOff:
      "Le même article permet au prestataire de fixer une heure limite proche de la fin d'un jour ouvrable, après laquelle un ordre est réputé reçu le jour ouvrable suivant.",
  },
  sources: {
    heading: 'Sources',
    sixFile: 'SIX Interbank Clearing, Clearing Day Calendar (fichier CSV), produit le {date} à {time} (UTC{offset})',
    specification: 'Spécification du fichier, version 1.0',
    sixSchedule: 'SIX Interbank Clearing, Schedule of clearing days 2027 (PDF), avec lequel chaque date est contrôlée',
    sixChanges:
      "SIX met son calendrier à jour chaque jour vers 16 h 30. Les dates sont des événements planifiés et peuvent changer. Un report à court terme n'est pas dans le fichier : le service l'annonce directement, par des messages ISO 20022.",
    sixPage: 'SIX, la page du calendrier des jours de clearing',
    eurosicPage: "SIX, la page d'euroSIC (arrêt au 31 décembre 2027)",
    ecbRule: 'BCE, What is T2? (les jours où T2 est fermé)',
    ecbHolidays: 'BCE, jours fériés, avec les jours marqués TARGET closing day',
    psd2: 'Directive (UE) 2015/2366 concernant les services de paiement, sur EUR-Lex',
    readOn: 'lu le {date}',
  },
  next: {
    heading: 'Pour aller plus loin',
    iid: 'Les numéros de clearing suisses (IID), tirés du Bank Master de SIX',
    country: "L'IBAN suisse, champ par champ",
    tools: 'Outils gratuits, sans clé',
  },
  and: 'et',
  listSeparator: ', ',
};

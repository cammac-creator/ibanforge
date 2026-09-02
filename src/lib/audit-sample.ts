/**
 * A small synthetic creditor file, one finding of each kind, real bank codes,
 * invented accounts. Serves the sample report; frontend/components/audit-client.tsx
 * carries the same rows for the "try with a sample" button.
 */
export const SAMPLE_CREDITOR_CSV = [
  'Nom;IBAN;BIC;Adresse;NPA;Ville;Pays',
  'Alpha Menuiserie SA;CH10 0023 0000 0000 1234 5;;Rue du Lac 12;1003;Lausanne;CH',
  'Beta Elektro GmbH;DE89 3704 0044 0532 0130 00;COBADEFFXXX;Hauptstrasse 1;10115;Berlin;DE',
  'Gamma Transports Sàrl;CH10 0023 0000 0000 1234 6;;Case postale;;;CH',
  'Delta Consulting;CH93 0076 2011 6238 5295 7;;Chemin des Fleurs 3;1200;Geneve;CH',
  'Alpha Menuiserie SA;CH10 0023 0000 0000 1234 5;;Rue du Lac 12;1003;Lausanne;CH',
  'Epsilon Import AG;DE89 3704 0044 0532 0130 00;DEUTDEFFXXX;Ringstrasse 8;60311;Frankfurt;Suisse',
  'Zeta Boulangerie;;;Grand-Rue 4;1700;Fribourg;CH',
  'Eta Services;GB29 NWBK 6016 1331 9268 19;;10 Downing Street;SW1A 2AA;London;GB',
].join('\n');

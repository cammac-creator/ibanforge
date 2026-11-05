# Descriptions proposées pour une éventuelle fiche Marketplace

Brouillons uniquement. Aucun référencement Google Workspace Marketplace n'est annoncé. Vérifier la version, les conditions de publication et les écrans réels avant toute soumission ; ces textes ne déclenchent aucune publication.

## English

**Name:** IBANforge
**Short description:** Review IBAN format and available bank references in Google Sheets.

Four functions return the IBAN validity result, an available bank name, a BIC, or a five-column summary including bank-code status and SEPA information. Blank or unknown results need review. Source dates and full provenance are available in the API response, not in the five-column summary.

An IBANforge key is required for uncached requests. Each transmitted IBAN consumes one unit, even if invalid. See the key's usage report and public pricing for its allowance and paid options. The cache may be cleared early, so recalculation can consume again. No automatic purchase is made.

Input strings and the key are sent from Google Apps Script to api.ibanforge.com. Review spreadsheet access before sharing: custom functions use the owner's properties, and editors can change the bound script. IBANforge does not confirm account existence, ownership or payment success.

## Français

**Nom :** IBANforge
**Description courte :** Examiner le format IBAN et les références bancaires dans Google Sheets.

Quatre fonctions donnent la validité de l'IBAN, le nom bancaire disponible, un BIC ou un résumé en cinq colonnes avec statut du code banque et information SEPA. Les résultats absents ou inconnus restent à revoir. Les dates et la provenance détaillée figurent dans la réponse API, pas dans ce résumé.

Une clé IBANforge est nécessaire pour les appels hors cache. Chaque IBAN transmis consomme une unité, même invalide. Le rapport d'usage de la clé et les tarifs publics décrivent le quota et les offres payantes. Le cache peut disparaître plus tôt ; un recalcul peut consommer à nouveau. Aucun achat automatique.

Les chaînes reçues et la clé sont transmises de Google Apps Script à api.ibanforge.com. Vérifiez les accès avant de partager : les fonctions lisent les propriétés du propriétaire et les éditeurs peuvent modifier le script. IBANforge ne confirme ni l'existence du compte, ni son titulaire, ni l'exécution d'un paiement.

## Deutsch

**Name:** IBANforge
**Kurzbeschreibung:** IBAN-Format und verfügbare Bankreferenzen in Google Sheets prüfen.

Vier Funktionen liefern das IBAN-Prüfergebnis, einen verfügbaren Banknamen, einen BIC oder fünf Spalten mit Bankcode-Status und SEPA-Informationen. Fehlende oder unbekannte Ergebnisse bleiben zur Durchsicht. Quelldaten und ausführliche Herkunftsangaben stehen in der API-Antwort, nicht in dieser Zusammenfassung.

Für Aufrufe ohne Cache-Treffer ist ein IBANforge-Schlüssel erforderlich. Jede gesendete IBAN verbraucht eine Einheit, auch eine ungültige. Nutzungsbericht und öffentliche Preise beschreiben Kontingent und kostenpflichtige Angebote. Cache-Einträge können früher verschwinden; eine Neuberechnung kann erneut Einheiten verbrauchen. Kein automatischer Kauf.

Eingabezeichenketten und Schlüssel werden von Google Apps Script an api.ibanforge.com gesendet. Prüfen Sie Freigaben: Funktionen lesen die Eigenschaften des Eigentümers, Bearbeiter können das Script ändern. IBANforge bestätigt weder das Bestehen eines Kontos noch dessen Inhaber oder die Ausführung einer Zahlung.

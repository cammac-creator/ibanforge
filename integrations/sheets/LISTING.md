# Marketplace listing texts (paste as is)

## English (default)

**Name:** IBANforge
**Short description (max 80 chars):** Check IBANs against bank registers, straight from a formula.
**Detailed description:**

IBANforge adds four functions to Google Sheets that check a column of IBANs against the national bank registers behind the IBANforge API: structure and check digits, the institution the register names for the bank code, the BIC it pairs with it, and SEPA reach.

=IBAN_VALID(A2:A200) returns TRUE or FALSE. =IBAN_BANK(A2:A200) returns the bank. =IBAN_BIC(A2:A200) returns the BIC. =IBAN_CHECK(A2:A200) returns five columns: valid, bank, BIC, bank-code verdict, SEPA. French and German aliases are included.

You bring your own IBANforge key: 200 checks a month are free, no card, then prepaid packs or a monthly plan. Results are cached six hours, so recalculating a sheet does not pay twice. The key stays in your own script properties; nothing leaves the sheet except the IBANs you check.

IBANforge is not a Verification of Payee service and never claims that an account belongs to a person: it tells you what the registers know about the bank behind the IBAN.

## Français

**Nom :** IBANforge
**Description courte :** Contrôlez des IBAN contre les registres bancaires, depuis une formule.
**Description détaillée :**

IBANforge ajoute quatre fonctions à Google Sheets qui contrôlent une colonne d'IBAN contre les registres bancaires nationaux derrière l'API IBANforge : structure et clé de contrôle, établissement que le registre nomme pour le code banque, BIC apparié, portée SEPA.

=IBAN_VALIDE(A2:A200) rend VRAI ou FAUX. =IBAN_BANQUE(A2:A200) rend la banque. =IBAN_BIC(A2:A200) rend le BIC. =IBAN_CONTROLE(A2:A200) rend cinq colonnes : valide, banque, BIC, verdict du code banque, SEPA.

Vous utilisez votre propre clé IBANforge : 200 contrôles par mois gratuits, sans carte, puis des packs prépayés ou un abonnement mensuel. Les résultats sont gardés six heures en cache, donc recalculer une feuille ne paie pas deux fois. La clé reste dans vos propres propriétés de script ; rien ne sort de la feuille sauf les IBAN que vous contrôlez.

IBANforge n'est pas un service de Verification of Payee et n'affirme jamais qu'un compte appartient à une personne : il vous dit ce que les registres savent de la banque derrière l'IBAN.

## Deutsch

**Name:** IBANforge
**Kurzbeschreibung:** IBANs gegen Bankregister prüfen, direkt aus einer Formel.
**Ausführliche Beschreibung:**

IBANforge fügt Google Sheets vier Funktionen hinzu, die eine Spalte IBANs gegen die nationalen Bankregister hinter der IBANforge-API prüfen: Struktur und Prüfziffern, das Institut, das das Register für den Bankcode nennt, den zugeordneten BIC und die SEPA-Erreichbarkeit.

=IBAN_GUELTIG(A2:A200) liefert WAHR oder FALSCH. =IBAN_BANKNAME(A2:A200) liefert die Bank. =IBAN_BIC(A2:A200) liefert den BIC. =IBAN_PRUEFUNG(A2:A200) liefert fünf Spalten: gültig, Bank, BIC, Bankcode-Urteil, SEPA.

Sie verwenden Ihren eigenen IBANforge-Schlüssel: 200 Prüfungen pro Monat sind kostenlos, ohne Karte, danach Prepaid-Pakete oder ein Monatsabonnement. Ergebnisse bleiben sechs Stunden im Cache, eine neu berechnete Tabelle zahlt also nicht zweimal. Der Schlüssel bleibt in Ihren eigenen Skripteigenschaften; nichts verlässt die Tabelle ausser den IBANs, die Sie prüfen.

IBANforge ist kein Verification-of-Payee-Dienst und behauptet nie, dass ein Konto einer Person gehört: Es sagt Ihnen, was die Register über die Bank hinter der IBAN wissen.

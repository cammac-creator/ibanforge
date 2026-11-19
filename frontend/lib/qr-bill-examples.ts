/**
 * The code samples of /tools/qr-bill. src/lib/swiss-qr-bill-guide.test.ts reads
 * this file as text and compares each sample with what the route really
 * answers, so a sample cannot drift from the tool.
 */

/** The payload of USAGE.example (src/routes/ch-qr-bill.ts), the example of the API's answer to an invalid request, with real line breaks escaped for JSON. */
export const REQUEST_EXAMPLE = `curl -s -X POST https://api.ibanforge.com/v1/ch/qr-bill/check \\
  -H "Content-Type: application/json" \\
  -d '{"payload":"SPC\\n0200\\n1\\nCH4431999123000889012\\nS\\nRobert Schneider AG\\nRue du Lac\\n1268\\n2501\\nBiel\\nCH\\n\\n\\n\\n\\n\\n\\n\\n1949.75\\nCHF\\nS\\nPia Rutschmann\\nMarktgasse\\n28\\n9400\\nRorschach\\nCH\\nQRR\\n210000000003139471430009017\\nOrder 15.06.2026\\nEPD"}'`;

/** A real answer of the route to that request, trimmed (local run of the same code). */
export const RESPONSE_EXAMPLE = `{
  "valid": true,
  "ready_for_2026_11_14": true,
  "version": "0200",
  "creditor_iban": { "value": "CH4431999123000889012", "valid": true, "country": "CH", "qr_iban": true, "iid": "31999" },
  "creditor": { "structured": true, "...": "..." },
  "reference": {
    "type": "QRR",
    "value": "210000000003139471430009017",
    "valid": true,
    "note": "Checked with modulo 10 recursive over the first 26 digits, using the carry table of Annex B."
  },
  "findings": [],
  "next_steps": [
    "Structure and checksums pass. To learn the bank behind the IBAN and its payment-rail participation, call POST /v1/iban/validate (paid)."
  ]
}`;

/**
 * An abridged VARIANT of the same request, not the same call: the creditor
 * address typed K (street and number in one line, postcode and town in the
 * next) and only the creditor part of the answer.
 */
export const COMBINED_EXAMPLE = `{
  "creditor": {
    "address": { "type": "K", "name": "Robert Schneider AG", "line1": "Rue du Lac 12", "line2": "2501 Biel", "country": "CH" },
    "structured": false,
    "proposed_structured": {
      "strt_nm": "Rue du Lac", "bldg_nb": "12", "pst_cd": "2501", "twn_nm": "Biel", "ctry": "CH",
      "confidence": "high",
      "note": "Derived from the combined lines: check the street and building number, then set AdrTp to S."
    }
  }
}`;

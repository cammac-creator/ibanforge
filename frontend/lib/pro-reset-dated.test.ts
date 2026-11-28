import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Décision de Claude-Alain du 28.11.2026 (option 1, date d'abonnement), en vigueur le
// 28.12.2026 avec le préavis des conditions (§9). Jusqu'à sa bascule, une clé Pro repart
// le 1er : chaque texte de prix qui promet la date de renouvellement doit dire la date de
// mise en vigueur, sinon il est faux pour un abonné actuel.
const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

const DATED = {
  en: "from the first renewal on or after December 28, 2026; on the 1st until then",
  fr: "à partir du premier renouvellement dès le 28 décembre 2026, le 1er jusque-là",
  de: "ab der ersten Erneuerung am oder nach dem 28. Dezember 2026, bis dahin am 1.",
};
const UNDATED = {
  en: /resets? on your monthly renewal date(?! \(from the first renewal on or after December 28, 2026)/,
  fr: /remise à zéro à la date de renouvellement mensuel(?! \(à partir du premier renouvellement dès le 28 décembre 2026)/i,
  de: /(?:Zurücksetzung|Reset) am monatlichen Erneuerungsdatum(?! \(ab der ersten Erneuerung am oder nach dem 28\. Dezember 2026)/,
};

describe("le jour de remise à zéro d'un abonnement, daté partout (28.12.2026)", () => {
  const files: Array<[string, keyof typeof DATED]> = [
    ["messages/en.json", "en"],
    ["messages/fr.json", "fr"],
    ["messages/de.json", "de"],
    ["public/llms.txt", "en"],
    ["public/llms-full.txt", "en"],
    ["app/[locale]/iban-validation-api/copy-en.ts", "en"],
    ["app/[locale]/iban-validation-api/copy-fr.ts", "fr"],
    ["app/[locale]/iban-validation-api/copy-de.ts", "de"],
    ["content/en/docs/api-keys.mdx", "en"],
    ["content/fr/docs/api-keys.mdx", "fr"],
    ["content/de/docs/api-keys.mdx", "de"],
  ];
  for (const [file, lang] of files) {
    it(`${file} : la date de renouvellement porte la mise en vigueur`, () => {
      const text = read(file);
      expect(text).toContain(DATED[lang]);
      expect(text).not.toMatch(UNDATED[lang]);
    });
  }
});

/**
 * GLEIF Level-1 address extraction.
 *
 * The seeder fetches GLEIF LEI records but historically kept only
 * legalAddress.{country, city}, discarding the street, postal code, region and
 * the romanized (Latin) variant of non-Latin-script addresses. This module
 * recovers the full registered/head-office address that IBANforge exposes as
 * the `address` object on /v1/bic.
 *
 * IMPORTANT: GLEIF addresses are LEGAL-ENTITY / head-office level. A
 * foreign-branch BIC must NOT inherit its parent entity's address — guard every
 * attach with addressMatchesBic().
 */

export interface GleifRawAddress {
  addressLines?: string[];
  city?: string | null;
  region?: string | null;
  country?: string | null;
  postalCode?: string | null;
  language?: string | null;
}

export interface GleifRawOtherAddress extends GleifRawAddress {
  type?: string;
}

export interface GleifEntityAddresses {
  legalAddress?: GleifRawAddress;
  headquartersAddress?: GleifRawAddress;
  otherAddresses?: GleifRawOtherAddress[];
}

export interface ExtractedAddress {
  street: string | null;
  post_code: string | null;
  region: string | null;
  city: string | null;
  country: string | null;
  language: string | null;
  /**
   * Latin-script street line: the legal address itself when it is already in a
   * Latin script, otherwise an English ALTERNATIVE_LANGUAGE address pulled from
   * otherAddresses[]. Null when the entity is non-Latin and GLEIF ships no
   * English variant — we never fabricate a transliteration.
   */
  romanized: string | null;
}

// ISO 639-1 codes whose addresses are written in a non-Latin script and thus
// benefit from a romanized (English) alternative when GLEIF provides one.
const NON_LATIN_LANGS = new Set([
  'zh', 'ja', 'ko', 'ru', 'ar', 'he', 'el', 'th', 'hi', 'bg',
  'uk', 'sr', 'mk', 'ka', 'hy', 'fa', 'ur', 'be', 'kk', 'mn',
]);

function lang2(lang: string | null | undefined): string {
  return (lang ?? '').trim().toLowerCase().slice(0, 2);
}

function joinLines(lines: string[] | undefined): string | null {
  const joined = (lines ?? []).map((l) => (l ?? '').trim()).filter(Boolean).join(', ');
  return joined || null;
}

/** Extract the registered/HQ address from a GLEIF entity, or null if absent. */
export function extractGleifAddress(entity: GleifEntityAddresses): ExtractedAddress | null {
  const la = entity.legalAddress;
  if (!la) return null;

  const street = joinLines(la.addressLines);
  const language = la.language ?? null;

  let romanized: string | null;
  if (NON_LATIN_LANGS.has(lang2(language))) {
    const alt = (entity.otherAddresses ?? []).find(
      (o) =>
        lang2(o.language) === 'en' &&
        /ADDRESS/i.test(o.type ?? '') &&
        (o.addressLines?.length ?? 0) > 0,
    );
    romanized = alt ? joinLines(alt.addressLines) : null;
  } else {
    romanized = street; // already Latin script
  }

  return {
    street,
    post_code: la.postalCode ?? null,
    region: la.region ?? null,
    city: la.city ?? null,
    country: la.country ?? null,
    language,
    romanized,
  };
}

/**
 * GLEIF addresses are entity-level. Only attach one to a BIC when the BIC's own
 * country (ISO 9362 chars 5-6) matches the entity's registered country —
 * otherwise the BIC is a foreign branch that would inherit the wrong (parent
 * head-office) address and city.
 */
export function addressMatchesBic(
  bic: string,
  entityCountry: string | null | undefined,
): boolean {
  if (!entityCountry || bic.length < 6) return false;
  return bic.slice(4, 6).toUpperCase() === entityCountry.trim().toUpperCase();
}

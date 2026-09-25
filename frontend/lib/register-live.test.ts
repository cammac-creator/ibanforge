import { afterEach, describe, expect, it, vi } from "vitest";
import {
  RegisterPageUnavailableError,
  computeCin,
  fetchLiveRegisterEntry,
  interpretLiveAnswer,
  liveExampleIban,
  normaliseLiveCode,
} from "./register-live";

/**
 * Les pages /at, /be et /sm, lues à l'API au moment de la requête. Toutes les
 * réponses ci-dessous sont INVENTÉES (codes 1998x, 990, 0999x ; noms
 * « Beispielbank », « Banque Exemple »…) : aucune ligne des registres sous
 * conditions n'entre dans ce dépôt public.
 */

/** ISO 13616 mod-97 d'un IBAN complet : 1 quand il est valide. */
function mod97(iban: string): number {
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let expanded = "";
  for (const ch of rearranged) expanded += /[A-Z]/.test(ch) ? String(ch.charCodeAt(0) - 55) : ch;
  let rem = 0;
  for (let i = 0; i < expanded.length; i += 7) rem = Number(`${rem}${expanded.slice(i, i + 7)}`) % 97;
  return rem;
}

const AT_REGISTER = "Oesterreichische Nationalbank SEPA-Zahlungsverkehrs-Verzeichnis";
const SM_REGISTER =
  "Central Bank of the Republic of San Marino, operating banks (banks only; the list does not publish the allocation of the ABI code space, so an absence is not a non-allocation)";

/** Une réponse de /v1/iban/validate inventée, de la forme que l'API sert. */
function answer(check: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return {
    valid: true,
    bic: {
      code: "XMPLATW1XXX",
      bic8: "XMPLATW1",
      bank_name: "Beispielbank Alpha AG",
      city: "Wien",
      source: AT_REGISTER,
      as_of: "2026-09",
      basis: "national_register",
      authoritative: true,
      lei: "XMPLAT000000000A0197",
      listed_in_current_source: true,
    },
    bank_code_check: check,
    sepa: {
      member: true,
      schemes: ["SCT", "SDD", "SCT_INST"],
      vop_required: true,
      vop_participant: true,
      basis: "epc_register",
      bank_reachability: "listed",
    },
    issuer: { type: "bank", name: "Beispielbank Alpha AG", classification: "default" },
    risk_indicators: { country_risk: "standard", sepa_reachable: true, vop_coverage: true, test_bic: false },
    ...extra,
  };
}

const VERIFIED_AT = {
  value: "19981",
  status: "verified",
  match: "register",
  register: AT_REGISTER,
  authoritative: true,
  institution: {
    name: "Beispielbank Alpha AG",
    street: "Musterweg 1",
    post_code: "1010",
    town: "Wien",
    country: "AT",
    lei: "XMPLAT000000000A0197",
  },
  as_of: "2026-09",
};

describe("the code a page accepts", () => {
  it("keeps each register's own width", () => {
    expect(normaliseLiveCode("AT", "19981")).toBe("19981");
    expect(normaliseLiveCode("AT", "019981")).toBeNull();
    expect(normaliseLiveCode("AT", "1998")).toBeNull();
    expect(normaliseLiveCode("BE", "990")).toBe("990");
    expect(normaliseLiveCode("BE", "99")).toBeNull();
    expect(normaliseLiveCode("SM", "9991")).toBe("09991");
    expect(normaliseLiveCode("SM", "123456")).toBeNull();
    expect(normaliseLiveCode("AT", "abcde")).toBeNull();
  });
});

describe("the synthetic IBAN of a page", () => {
  it.each([
    ["AT", "19981", 20],
    ["BE", "990", 16],
    ["SM", "09991", 27],
  ] as const)("%s %s is a valid IBAN of the right length", (cc, code, length) => {
    const iban = liveExampleIban(cc, code);
    expect(iban.startsWith(cc)).toBe(true);
    expect(iban).toHaveLength(length);
    expect(mod97(iban)).toBe(1);
  });

  it("puts the Belgian national check digits where the API reads them", () => {
    const iban = liveExampleIban("BE", "990");
    const first10 = iban.slice(4, 14);
    // Dix chiffres tiennent dans un Number sans perte.
    expect(Number(iban.slice(14))).toBe(Number(first10) % 97 || 97);
  });

  it("computes the San Marino CIN the way the API checks it", () => {
    // Vecteurs calculés avec src/lib/national-check/it-cin.ts de l'API, sur des
    // ABI inventés.
    expect(computeCin("09991", "09800", "000000270100")).toBe("K");
    expect(computeCin("09992", "09800", "000000270100")).toBe("P");
    expect(computeCin("12345", "09800", "000000270100")).toBe("W");
    expect(liveExampleIban("SM", "09991").slice(4, 5)).toBe("K");
  });
});

describe("reading the API's answer", () => {
  it("builds the page from the register's verdict, and the BIC only when the register gave it", () => {
    const entry = interpretLiveAnswer("AT", "19981", "AT000000000000000001", answer(VERIFIED_AT))!;
    expect(entry).toMatchObject({
      country: "AT",
      code: "19981",
      name: "Beispielbank Alpha AG",
      bic: "XMPLATW1XXX",
      street: "Musterweg 1",
      post_code: "1010",
      town: "Wien",
      lei: "XMPLAT000000000A0197",
      as_of: "2026-09",
      register: AT_REGISTER,
      source: AT_REGISTER,
    });
    const composite = answer(VERIFIED_AT, {
      bic: { code: "XMPLATW9XXX", basis: "curated_map", source: "IBANforge curated bank-code map" },
    });
    const withoutRegisterBic = interpretLiveAnswer("AT", "19981", "AT000000000000000001", composite)!;
    expect(withoutRegisterBic.bic).toBeNull();
    expect(withoutRegisterBic.source).toBeNull();
  });

  it("prints no EPC-derived field, only the country's SEPA facts", () => {
    const entry = interpretLiveAnswer("AT", "19981", "AT000000000000000001", answer(VERIFIED_AT))!;
    expect(entry.api.sepa).toEqual({ member: true, vop_required: true });
    expect(entry.api).not.toHaveProperty("checks");
    expect(JSON.stringify(entry.api)).not.toMatch(/epc_register|vop_participant|listed_in_current_source/);
  });

  it("answers no page for a code the register allocates to nobody", () => {
    const check = { value: "19989", status: "not_in_register", reason: "not_allocated", register: AT_REGISTER, authoritative: true };
    expect(interpretLiveAnswer("AT", "19989", "x", answer(check))).toBeNull();
    expect(interpretLiveAnswer("BE", "999", "x", answer({ ...check, value: "999" }))).toBeNull();
  });

  it("answers no page for a San Marino code the list does not carry", () => {
    const miss = { value: "09999", status: "not_in_register", reason: "absent_from_reference_data", register: "IBANforge composite bank-code map", authoritative: false };
    expect(interpretLiveAnswer("SM", "09999", "x", answer(miss))).toBeNull();
    const composite = { value: "09999", status: "verified", match: "register", register: "IBANforge composite bank-code map", authoritative: false };
    expect(interpretLiveAnswer("SM", "09999", "x", answer(composite))).toBeNull();
    const listed = { ...VERIFIED_AT, value: "09991", register: SM_REGISTER, authoritative: false, institution: { name: "Banca di Esempio", street: null, post_code: null, town: "San Marino", country: "SM" } };
    expect(interpretLiveAnswer("SM", "09991", "x", answer(listed))?.name).toBe("Banca di Esempio");
  });

  it("refuses to draw a page when the register was not consulted", () => {
    // Le registre privé n'est pas chargé en production : ni 404 (le code existe
    // peut-être), ni une page vide ; une erreur, et le cache garde l'ancienne page.
    const down = { value: "19981", status: "unavailable", reason: "national_register_unavailable", register: null, authoritative: false };
    expect(() => interpretLiveAnswer("AT", "19981", "x", answer(down))).toThrow(RegisterPageUnavailableError);
    const smDown = { ...down, value: "09991" };
    expect(() => interpretLiveAnswer("SM", "09991", "x", answer(smDown))).toThrow(RegisterPageUnavailableError);
    // Une réponse qui viendrait d'une autre source que le registre du pays.
    const composite = { ...VERIFIED_AT, register: "IBANforge composite bank-code map", authoritative: false };
    expect(() => interpretLiveAnswer("AT", "19981", "x", answer(composite))).toThrow(RegisterPageUnavailableError);
  });
});

describe("asking the API", () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
    vi.unstubAllGlobals();
  });

  it("posts the synthetic IBAN with the server key, cached for a day, never the key in the body", async () => {
    process.env.API_URL = "https://api.example.test";
    process.env.PLAYGROUND_API_KEY = "ifk_test_invented";
    const calls: Array<[string, RequestInit]> = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      calls.push([url, init]);
      return new Response(JSON.stringify(answer(VERIFIED_AT)), { status: 200 });
    });
    const entry = await fetchLiveRegisterEntry("AT", "19981");
    expect(entry?.name).toBe("Beispielbank Alpha AG");
    const [url, init] = calls[0]!;
    expect(url).toBe("https://api.example.test/v1/iban/validate");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer ifk_test_invented");
    expect(String(init.body)).toBe(JSON.stringify({ iban: liveExampleIban("AT", "19981") }));
    expect(String(init.body)).not.toContain("ifk_");
    expect((init as { next?: { revalidate?: number | false } }).next?.revalidate).toBe(86_400);
  });

  it("never asks the API about a code of the wrong shape", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    expect(await fetchLiveRegisterEntry("AT", "1234")).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("turns an API failure into an error, never into a page or a 404", async () => {
    vi.stubGlobal("fetch", async () => new Response("{}", { status: 402 }));
    await expect(fetchLiveRegisterEntry("BE", "990")).rejects.toThrow(RegisterPageUnavailableError);
  });
});

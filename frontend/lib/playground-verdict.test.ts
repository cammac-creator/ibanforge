import { describe, expect, it } from "vitest";
import { playgroundVerdict as verdict } from "./playground-verdict";

describe("Portée des verdicts visibles", () => {
  it("ne transforme pas un IBAN structurellement valide en banque confirmée", () => {
    expect(verdict({ valid: true }, "iban")).toMatchObject({ structure: "valid", bankStatus: "unknown", sanctions: "notChecked" });
  });
  it.each([
    [{ status: "not_in_register", authoritative: false, reason: "absent_from_reference_data" }, "unknown"],
    [{ status: "not_in_register", authoritative: true, reason: "not_allocated" }, "notAllocated"],
    [{ status: "unavailable", authoritative: true, reason: "lookup_failed" }, "unknown"],
    [{ status: "verified", authoritative: true }, "verified"],
    [{ status: "verified", authoritative: false }, "matched"],
    [{ status: "verified", authoritative: true, retired: true }, "retired"],
    [{ status: "verified", authoritative: true, candidates: 2 }, "ambiguous"],
  ])("respecte le sens du registre : %j", (bank, expected) => {
    expect(verdict({ valid: true, bank_code_check: bank }, "iban").bankStatus).toBe(expected);
  });
  it("ne certifie pas une réponse absente ou une structure invalide", () => {
    expect(verdict({}, "iban")).toMatchObject({ structure: "notChecked", next: "retry" });
    expect(verdict({ valid: false, bank_code_check: { status: "verified" } }, "iban")).toMatchObject({ bankStatus: "notChecked", next: "fixStructure" });
  });
  it.each([undefined, null, "unassessable"])("sans évaluation %s, false ne devient pas une preuve", (risk_level) => {
    expect(verdict({ valid: true, compliance: { risk_level, sanctions: { bank_sanctioned: false } } }, "compliance").sanctions).toBe("notChecked");
  });
  it("sépare résultat sanctions et absence de contrôle", () => {
    const data = { valid: true, compliance: { risk_level: "low", sanctions: { bank_sanctioned: false } } };
    expect(verdict(data, "compliance").sanctions).toBe("noMatch");
    expect(verdict(data, "iban").sanctions).toBe("notChecked");
    expect(verdict({ ...data, compliance: { risk_level: "critical", sanctions: { bank_sanctioned: true } } }, "compliance").sanctions).toBe("matchedSanctions");
  });
  it("remonte les échecs nationaux même si la structure IBAN passe", () => {
    for (const extra of [{ bank_code_check: { check_digit: { valid: false } } }, { modulus_check: { checked: true, passed: false } }]) {
      expect(verdict({ valid: true, ...extra }, "iban")).toMatchObject({ localCheckInvalid: true, next: "confirmDetails" });
    }
    expect(verdict({ valid: true, modulus_check: { checked: false, passed: null } }, "iban").localCheckInvalid).toBe(false);
  });
  it("remonte une clé nationale fausse (checks.national_check_digits), sans toucher à la structure", () => {
    const fail = verdict({ valid: true, checks: { national_check_digits: "fail" }, national_check_digits: { country: "FR", scheme: "fr_rib_key", status: "fail" } }, "iban");
    expect(fail).toMatchObject({ structure: "valid", localCheckInvalid: true, next: "confirmDetails" });
    for (const status of ["pass", "not_checked", "not_applicable", undefined]) {
      expect(verdict({ valid: true, checks: { national_check_digits: status } }, "iban").localCheckInvalid, String(status)).toBe(false);
    }
  });
  it("une clé allemande fausse sur une méthode publiée sans numéro de test avertit, sans arrêter (06.10.2026)", () => {
    const suspect = verdict({ valid: true, checks: { national_check_digits: "fail" }, national_check_digits: { country: "DE", scheme: "de_pruefziffer", status: "fail", method: "13", verified_by: "independent_implementation" } }, "iban");
    expect(suspect).toMatchObject({ structure: "valid", localCheckInvalid: false, localCheckSuspect: true, next: "confirmDetails" });
    const blocking = verdict({ valid: true, checks: { national_check_digits: "fail" }, national_check_digits: { country: "DE", scheme: "de_pruefziffer", status: "fail", method: "63", verified_by: "bundesbank_test_numbers" } }, "iban");
    expect(blocking).toMatchObject({ localCheckInvalid: true, localCheckSuspect: false, next: "confirmDetails" });
  });
  it("préserve la provenance distincte du code banque et du BIC", () => {
    expect(verdict({ valid: true, bank_code_check: { register: "Registre fictif", as_of: "2026-01-01" }, bic: { source: "Annuaire fictif", as_of: "2025-12-01" } }, "iban")).toMatchObject({ source: "Registre fictif", asOf: "2026-01-01", bicSource: "Annuaire fictif", bicAsOf: "2025-12-01" });
  });
});

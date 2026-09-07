import { describe, it, expect } from "vitest";
import { iidIdentity, type IidEntry } from "./registers";

/**
 * Twenty-six IIDs of the SIX BankMaster (2026-09-01 file) are merged numbers
 * with no name of their own. Their pages used to interpolate the empty fields
 * into the title. The identity helper is where that stops.
 */
function entry(register: Partial<IidEntry["register"]>, api: Record<string, unknown> = {}): IidEntry {
  return {
    register: {
      iid: "04835", name: "", town: null, post_code: null, iid_type: null, headquarters_iid: null,
      redirect_iid: null, qr_iid: null, bic: null, valid_on: "2026-09-01", ...register,
    },
    example_iban: "CH8304835000000000001",
    api,
    related: [],
  };
}

describe("iidIdentity", () => {
  it("keeps the register's own identity when it names an institution", () => {
    const id = iidIdentity(entry({ iid: "00230", name: "Alpha Bank AG", town: "Zürich", bic: "ALPHCHZZ" }));
    expect(id).toEqual({ name: "Alpha Bank AG", town: "Zürich", bic: "ALPHCHZZ", redirectedTo: null });
  });

  it("carries the successor's identity for a merged number, and says where it goes", () => {
    const id = iidIdentity(
      entry(
        { redirect_iid: "00230" },
        { institution: { name: "Alpha Bank AG" }, address: { town: "Zürich" }, bic: "ALPHCHZZ", redirected_from: "04835" },
      ),
    );
    expect(id).toEqual({ name: "Alpha Bank AG", town: "Zürich", bic: "ALPHCHZZ", redirectedTo: "00230" });
  });

  it("never invents a name for a nameless number that redirects nowhere", () => {
    expect(iidIdentity(entry({}))).toEqual({ name: "", town: "", bic: "", redirectedTo: null });
  });
});

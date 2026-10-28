import { Children, isValidElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuditClient, sampleCsv } from "./audit-client";
import { SAMPLE_CREDITOR_CSV } from "../../src/lib/audit-sample";

// Petit hôte de hooks pour appeler les vrais gestionnaires du composant sans DOM.
// Les états et références survivent au rendu suivant, notamment après un exemple.
const hooks = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0 }));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useState: (initial: unknown) => {
    const index = hooks.cursor++;
    if (!(index in hooks.slots)) hooks.slots[index] = initial;
    return [hooks.slots[index], (value: unknown) => { hooks.slots[index] = value; }];
  },
  useRef: (initial: unknown) => {
    const index = hooks.cursor++;
    if (!(index in hooks.slots)) hooks.slots[index] = { current: initial };
    return hooks.slots[index];
  },
  useCallback: (callback: unknown) => callback,
  useEffect: () => undefined,
}));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));

function elements(node: ReactNode): Record<string, unknown>[] {
  return Children.toArray(node).flatMap((child) => {
    if (!isValidElement<{ children?: ReactNode }>(child)) return [];
    return [child.props, ...elements(child.props.children)];
  });
}
function render() {
  hooks.cursor = 0;
  return elements(AuditClient({ locale: "fr" }));
}

beforeEach(() => { hooks.slots = []; hooks.cursor = 0; });
afterEach(() => vi.unstubAllGlobals());

describe("la provenance de l'exemple d'audit", () => {
  it("envoie exactement les mêmes octets que l'exemple de l'API", () => {
    expect(Buffer.from(sampleCsv(), "utf8")).toEqual(Buffer.from(SAMPLE_CREDITOR_CSV, "utf8"));
  });

  it("réserve sample=1 au bouton d'exemple, même si le fichier choisi ou glissé a le même contenu", async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ job: "audit-fictif", paid: false }) });
    vi.stubGlobal("fetch", fetch);
    const sample = () => (render().find((props) => props["data-evt"] === "cta:audit-sample")!.onClick as () => void)();
    const uploaded = async (index: number, demonstration: boolean) => {
      await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(index + 1));
      const [url, init] = fetch.mock.calls[index];
      expect(url).toMatch(/\/v1\/audit\/upload$/);
      expect(init.method).toBe("POST");
      const form = init.body as FormData;
      expect(form.get("sample")).toBe(demonstration ? "1" : null);
      expect(form.get("lang")).toBe("fr");
      expect(await (form.get("file") as File).text()).toBe(SAMPLE_CREDITOR_CSV);
    };
    sample();
    await uploaded(0, true);

    const file = new File([SAMPLE_CREDITOR_CSV], "fichier-choisi.csv", { type: "text/csv" });
    const target = { files: [file], value: "fichier-choisi.csv" };
    (render().find((props) => props.type === "file")!.onChange as (event: unknown) => void)({ target });
    await uploaded(1, false);
    expect(target.value).toBe("");

    sample();
    await uploaded(2, true);
    const preventDefault = vi.fn();
    (render().find((props) => props.onDrop)!.onDrop as (event: unknown) => void)({ preventDefault, dataTransfer: { files: [file] } });
    await uploaded(3, false);
    expect(preventDefault).toHaveBeenCalledOnce();
  });
});

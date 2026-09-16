import { describe, expect, it } from "vitest";
import catalogue from "@/data/onboarding.json";
import fr from "@/messages/fr.json";
import en from "@/messages/en.json";
import de from "@/messages/de.json";

describe("Catalogue MCP public", () => {
  it.each([fr, en, de])("décrit chaque outil installé dans chaque langue", (messages) => {
    expect(Object.keys(messages.agents.toolDescriptions).sort()).toEqual([...catalogue.installed].sort());
    expect(messages.agents.mcp.description).toContain("{remote}");
    expect(messages.agents.mcp.description).toContain("{installed}");
  });
});

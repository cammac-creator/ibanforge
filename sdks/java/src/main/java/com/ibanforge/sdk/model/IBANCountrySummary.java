package com.ibanforge.sdk.model;

/** One entry of {@link IBANStructureList#countries()}. */
public record IBANCountrySummary(
    String code,
    String name,
    int ibanLength,
    boolean sepaMember,
    boolean hasBbanStructure,
    boolean hasExample
) {
}

package com.ibanforge.sdk.model;

/** Institution row nested inside a {@link CHClearingResult}. */
public record CHInstitution(
    String name,
    String type,
    /** One of "headquarters", "branch", "other". */
    String iidType,
    String headquartersIid
) {
}

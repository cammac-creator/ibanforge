package com.ibanforge.sdk.model;

import java.util.List;

/** SEPA membership and reachability for the IBAN's institution. */
public record SEPA(
    boolean member,
    /** Subset of "SCT", "SDD", "SCT_INST". */
    List<String> schemes,
    boolean vopRequired,
    /** Null when the institution is unknown -- absence of data, not a "no". */
    Boolean vopParticipant
) {
}

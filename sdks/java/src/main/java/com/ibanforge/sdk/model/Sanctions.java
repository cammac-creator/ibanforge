package com.ibanforge.sdk.model;

import java.util.List;

/**
 * Sanctions screening nested inside {@link Compliance}.
 *
 * <p>{@code bankScreened == false} means the screening did not run (no bank could be
 * identified), never that the bank came back clean.
 */
public record Sanctions(
    boolean countrySanctioned,
    boolean bankSanctioned,
    List<String> matchedLists,
    /** One of "member", "grey_list", "black_list", "suspended", "non_member". */
    String fatfStatus,
    Boolean bankScreened
) {
}

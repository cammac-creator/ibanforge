package com.ibanforge.sdk.model;

/** SEPA reachability nested inside {@link Compliance}. Absence of a verdict when unscreened. */
public record Reachability(boolean sepaInstant, boolean sct, boolean sdd, Boolean screened) {
}

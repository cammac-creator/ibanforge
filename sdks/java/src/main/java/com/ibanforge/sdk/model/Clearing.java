package com.ibanforge.sdk.model;

import java.util.List;

/** Swiss/Liechtenstein clearing enrichment, present on validate for CH/LI IBANs only. */
public record Clearing(
    String iid,
    String name,
    /** e.g. "bank", "cantonal_bank", "postfinance", "raiffeisen", "central_bank", "foreign_participant". */
    String type,
    String town,
    boolean sic,
    boolean instantPaymentsChf,
    boolean eurosic,
    String qrIid,
    String qrIidSource,
    /** An institution can hold several QR-IIDs; {@link #qrIid()} is the first. */
    List<String> qrIids
) {
}

package com.ibanforge.sdk.model;

import java.util.List;

/** Result of the FREE {@code GET /v1/iban/structure} -- every country the API can parse. */
public record IBANStructureList(
    int total,
    List<IBANCountrySummary> countries,
    String endpointPerCountry,
    Double costUsdc
) {
}

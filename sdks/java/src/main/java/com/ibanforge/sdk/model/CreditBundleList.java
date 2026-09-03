package com.ibanforge.sdk.model;

import java.util.List;

/** Result of the FREE {@code GET /v1/credits/bundles} -- prepaid packs and their per-call price. */
public record CreditBundleList(
    List<CreditBundle> bundles,
    String paymentMethod,
    String documentation
) {
}

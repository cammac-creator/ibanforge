package com.ibanforge.sdk.model;

/** One entry of {@link CreditBundleList#bundles()} -- a prepaid credit pack. */
public record CreditBundle(
    String slug,
    int credits,
    double priceUsdc,
    double pricePerCallUsdc,
    String buyEndpoint
) {
}

package com.ibanforge.sdk.model;

/** The register row backing a {@link TestIbanEntry}, so a reviewer can check the claim. */
public record TestIbanProof(BankCodeCheck bankCodeCheck, BIC bic) {
}

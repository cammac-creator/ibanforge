package com.ibanforge.sdk.model;

/** The Basic Bank Account Number decoded out of an IBAN. */
public record BBAN(String bankCode, String branchCode, String accountNumber) {
}

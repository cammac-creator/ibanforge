package com.ibanforge.sdk.model;

/** Field offset/length/charset entry of {@link IBANStructure#bban()}. */
public record BBANFieldSpec(int start, int length, String charset) {
}

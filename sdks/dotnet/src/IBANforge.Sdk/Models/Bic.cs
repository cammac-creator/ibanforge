using System.Text.Json.Serialization;

namespace IBANforge.Sdk.Models;

/// <summary>A resolved BIC/SWIFT code, as embedded in an IBAN validation result.</summary>
public sealed record Bic
{
    /// <summary>The BIC/SWIFT code.</summary>
    [JsonPropertyName("code")]
    public string Code { get; init; } = string.Empty;

    /// <summary>Bank name, or null.</summary>
    [JsonPropertyName("bank_name")]
    public string? BankName { get; init; }

    /// <summary>
    /// Where the consulted register places THIS bank code. May legitimately differ
    /// from the registered address' city, which is the legal seat: German BLZ
    /// 37040044 resolves to Commerzbank in Köln while the entity is registered in
    /// Frankfurt. Both true, different questions.
    /// </summary>
    [JsonPropertyName("city")]
    public string? City { get; init; }

    /// <summary>Which directory this row came from (GLEIF, SIX, a curated map, …).</summary>
    [JsonPropertyName("source")]
    public string? Source { get; init; }

    /// <summary>Month the source was last refreshed.</summary>
    [JsonPropertyName("as_of")]
    public string? AsOf { get; init; }

    /// <summary>
    /// Where the bank code to BIC pairing came from: <c>"national_register"</c>,
    /// <c>"curated_map"</c>, or <c>"directory_prefix"</c>. Only
    /// <c>"national_register"</c> is settlement-grade.
    /// </summary>
    [JsonPropertyName("basis")]
    public string? Basis { get; init; }

    /// <summary>
    /// Whether this BIC may be stored and settled against. Derived from
    /// <see cref="Basis"/>. NOT the same question as
    /// <see cref="BankCodeCheck.Authoritative"/>, which answers whether a register
    /// was consulted about the BANK CODE: in Switzerland it confirms the code
    /// while this BIC still comes from the curated map.
    /// </summary>
    [JsonPropertyName("authoritative")]
    public bool? Authoritative { get; init; }

    /// <summary>
    /// Legal Entity Identifier of the resolved institution. Null means GLEIF
    /// publishes no LEI for this BIC, never that the institution has none.
    /// </summary>
    [JsonPropertyName("lei")]
    public string? Lei { get; init; }

    /// <summary>LEI registration status (e.g. <c>"ACTIVE"</c>), or null.</summary>
    [JsonPropertyName("lei_status")]
    public string? LeiStatus { get; init; }

    /// <summary>Null for a branch BIC: only head-office rows carry a registered address.</summary>
    [JsonPropertyName("address")]
    public RegisteredAddress? Address { get; init; }
}

/// <summary>Issuer / institution classification (bank, digital bank, EMI, payment institution).</summary>
public sealed record Issuer
{
    /// <summary>One of <c>"bank"</c>, <c>"digital_bank"</c>, <c>"emi"</c>, <c>"payment_institution"</c>.</summary>
    [JsonPropertyName("type")]
    public string Type { get; init; } = string.Empty;

    /// <summary>Institution name.</summary>
    [JsonPropertyName("name")]
    public string Name { get; init; } = string.Empty;

    /// <summary>Finer-grained classification, when available.</summary>
    [JsonPropertyName("classification")]
    public string? Classification { get; init; }
}

/// <summary>SEPA membership and reachability for the IBAN's country / institution.</summary>
public sealed record Sepa
{
    /// <summary>Whether the country is a SEPA member.</summary>
    [JsonPropertyName("member")]
    public bool Member { get; init; }

    /// <summary>SEPA schemes reachable, from <c>"SCT"</c>, <c>"SDD"</c>, <c>"SCT_INST"</c>.</summary>
    [JsonPropertyName("schemes")]
    public List<string> Schemes { get; init; } = new();

    /// <summary>Whether Verification of Payee is required before this transfer.</summary>
    [JsonPropertyName("vop_required")]
    public bool VopRequired { get; init; }

    /// <summary>Null when the institution's VoP participation is unknown: absence of data, not a "no".</summary>
    [JsonPropertyName("vop_participant")]
    public bool? VopParticipant { get; init; }
}

/// <summary>Risk indicators computed for a validated IBAN.</summary>
public sealed record RiskIndicators
{
    /// <summary>Issuer type, or null when unknown.</summary>
    [JsonPropertyName("issuer_type")]
    public string? IssuerType { get; init; }

    /// <summary>One of <c>"standard"</c>, <c>"elevated"</c>, <c>"high"</c>.</summary>
    [JsonPropertyName("country_risk")]
    public string CountryRisk { get; init; } = string.Empty;

    /// <summary>Whether the bank code belongs to a documentation/test BIC.</summary>
    [JsonPropertyName("test_bic")]
    public bool TestBic { get; init; }

    /// <summary>Whether the account is reachable over SEPA.</summary>
    [JsonPropertyName("sepa_reachable")]
    public bool SepaReachable { get; init; }

    /// <summary><c>"country"</c> when reachability is inferred from the zone, not the institution.</summary>
    [JsonPropertyName("sepa_reachable_scope")]
    public string? SepaReachableScope { get; init; }

    /// <summary>Whether Verification of Payee coverage applies.</summary>
    [JsonPropertyName("vop_coverage")]
    public bool VopCoverage { get; init; }
}

/// <summary>
/// Is this bank code actually allocated in the national register?
///
/// The sharpest answer this API gives: an IBAN can pass mod-97 and still name a
/// bank that does not exist. <c>Status == "not_in_register"</c> with
/// <c>Authoritative == true</c> means do not send.
/// </summary>
public sealed record BankCodeCheck
{
    /// <summary>The bank code that was checked.</summary>
    [JsonPropertyName("value")]
    public string Value { get; init; } = string.Empty;

    /// <summary>One of <c>"verified"</c>, <c>"not_in_register"</c>, <c>"unavailable"</c>.</summary>
    [JsonPropertyName("status")]
    public string Status { get; init; } = string.Empty;

    /// <summary>
    /// Why the verdict is not <c>"verified"</c>, present on every other status.
    /// The one value that licenses stopping a payment is <c>"not_allocated"</c>,
    /// and it only ever comes with <see cref="Authoritative"/> true.
    /// Known values: <c>"not_allocated"</c>, <c>"absent_from_reference_data"</c>,
    /// <c>"no_reference_data_for_country"</c>, <c>"register_names_no_holder"</c>,
    /// <c>"national_register_unavailable"</c>, <c>"lookup_failed"</c>.
    /// </summary>
    [JsonPropertyName("reason")]
    public string? Reason { get; init; }

    /// <summary>What matched in the register, or null.</summary>
    [JsonPropertyName("match")]
    public string? Match { get; init; }

    /// <summary>Which register was consulted, or null.</summary>
    [JsonPropertyName("register")]
    public string? Register { get; init; }

    /// <summary>True only when the register is the country's official one.</summary>
    [JsonPropertyName("authoritative")]
    public bool Authoritative { get; init; }

    /// <summary>Institution fields the register carries for this bank code, when matched.</summary>
    [JsonPropertyName("institution")]
    public Dictionary<string, string?>? Institution { get; init; }

    /// <summary>When this register row was last refreshed.</summary>
    [JsonPropertyName("as_of")]
    public string? AsOf { get; init; }
}

/// <summary>Swiss / Liechtenstein clearing data (BC-Nummer / IID), embedded in an IBAN validation result.</summary>
public sealed record Clearing
{
    /// <summary>The Swiss IID / BC-Nummer.</summary>
    [JsonPropertyName("iid")]
    public string Iid { get; init; } = string.Empty;

    /// <summary>Institution name.</summary>
    [JsonPropertyName("name")]
    public string Name { get; init; } = string.Empty;

    /// <summary>Institution type.</summary>
    [JsonPropertyName("type")]
    public string Type { get; init; } = string.Empty;

    /// <summary>Town, or null.</summary>
    [JsonPropertyName("town")]
    public string? Town { get; init; }

    /// <summary>Whether the institution participates in SIC.</summary>
    [JsonPropertyName("sic")]
    public bool Sic { get; init; }

    /// <summary>Whether the institution supports CHF instant payments.</summary>
    [JsonPropertyName("instant_payments_chf")]
    public bool InstantPaymentsChf { get; init; }

    /// <summary>Whether the institution participates in euroSIC.</summary>
    [JsonPropertyName("eurosic")]
    public bool Eurosic { get; init; }

    /// <summary>First QR-IID allocated to the institution, or null when none.</summary>
    [JsonPropertyName("qr_iid")]
    public string? QrIid { get; init; }

    /// <summary>Source of the QR-IID allocation.</summary>
    [JsonPropertyName("qr_iid_source")]
    public string? QrIidSource { get; init; }

    /// <summary>An institution can hold several QR-IIDs; <see cref="QrIid"/> is the first.</summary>
    [JsonPropertyName("qr_iids")]
    public List<string>? QrIids { get; init; }
}

/// <summary>Result of <see cref="IBANforgeClient.LookupBicAsync"/>.</summary>
public sealed record BicLookupResult
{
    /// <summary>The BIC/SWIFT code as looked up.</summary>
    [JsonPropertyName("bic")]
    public string BicCode { get; init; } = string.Empty;

    /// <summary>The 8-character (head office) form.</summary>
    [JsonPropertyName("bic8")]
    public string? Bic8 { get; init; }

    /// <summary>The 11-character (branch) form.</summary>
    [JsonPropertyName("bic11")]
    public string? Bic11 { get; init; }

    /// <summary>Whether the code was found in the BIC database.</summary>
    [JsonPropertyName("found")]
    public bool Found { get; init; }

    /// <summary>Whether the code is a structurally valid BIC (ISO 9362), independent of whether it was found.</summary>
    [JsonPropertyName("valid_format")]
    public bool ValidFormat { get; init; }

    /// <summary>The bank's name. Named <c>institution</c> on the wire, <c>bank_name</c> on <see cref="Bic"/>.</summary>
    [JsonPropertyName("institution")]
    public string? Institution { get; init; }

    /// <summary>Country of the institution.</summary>
    [JsonPropertyName("country")]
    public Country? Country { get; init; }

    /// <summary>City, or null.</summary>
    [JsonPropertyName("city")]
    public string? City { get; init; }

    /// <summary>Registered address, when GLEIF carries one.</summary>
    [JsonPropertyName("address")]
    public RegisteredAddress? Address { get; init; }

    /// <summary>Whether a registered address is available for this BIC.</summary>
    [JsonPropertyName("address_available")]
    public bool? AddressAvailable { get; init; }

    /// <summary>The 3-character branch code, when the BIC is an 11-character branch code.</summary>
    [JsonPropertyName("branch_code")]
    public string? BranchCode { get; init; }

    /// <summary>Free-text branch description, or null.</summary>
    [JsonPropertyName("branch_info")]
    public string? BranchInfo { get; init; }

    /// <summary>Legal Entity Identifier, or null.</summary>
    [JsonPropertyName("lei")]
    public string? Lei { get; init; }

    /// <summary>LEI registration status, or null.</summary>
    [JsonPropertyName("lei_status")]
    public string? LeiStatus { get; init; }

    /// <summary>Whether this is a documentation/test BIC rather than a live one.</summary>
    [JsonPropertyName("is_test_bic")]
    public bool? IsTestBic { get; init; }

    /// <summary>Which directory this row came from.</summary>
    [JsonPropertyName("source")]
    public string? Source { get; init; }

    /// <summary>Cost of this call in USDC, when made with an API key.</summary>
    [JsonPropertyName("cost_usdc")]
    public double? CostUsdc { get; init; }

    /// <summary>Server-side processing time in milliseconds.</summary>
    [JsonPropertyName("processing_ms")]
    public double? ProcessingMs { get; init; }
}

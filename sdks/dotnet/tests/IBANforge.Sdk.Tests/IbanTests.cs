using System.Net;
using IBANforge.Sdk;
using Xunit;

namespace IBANforge.Sdk.Tests;

/// <summary>
/// Covers <c>FormatIbanAsync</c>, <c>ValidateIbanAsync</c>, <c>ValidateBatchAsync</c>
/// and <c>CheckComplianceAsync</c>. Response bodies are copied verbatim from
/// <c>sdks/fixtures/quickstart-api.json</c> (real recorded API responses), per
/// the brief: reuse a fixture body wherever one exists.
/// </summary>
public sealed class IbanTests
{
    // sdks/fixtures/quickstart-api.json -> "format-ok"
    private const string FormatOkBody = """
        {"iban":"CH1000230000000012345","formatted":"CH10 0023 0000 0000 1234 5","valid":true,"country":{"code":"CH","name":"Switzerland"},"check_digits":"10","bban":{"bank_code":"00230","account_number":"000000012345"},"upgrade_to_full_validation":"POST /v1/iban/validate ($0.005) — adds BIC, SEPA, VoP, sanctions, Swiss BC-Nummer."}
        """;

    // sdks/fixtures/quickstart-api.json -> "format-checksum-failed"
    private const string FormatChecksumFailedBody = """
        {"iban":"CH93007620116238529XX","valid":false,"error":"checksum_failed","error_detail":"Modulo 97 check returned 95, expected 1.","upgrade_to_full_validation":"POST /v1/iban/validate ($0.005) — adds BIC, SEPA, VoP, sanctions, Swiss BC-Nummer."}
        """;

    // sdks/fixtures/quickstart-api.json -> "validate-verified"
    private const string ValidateVerifiedBody = """
        {"iban":"CH1000230000000012345","valid":true,"country":{"code":"CH","name":"Switzerland"},"check_digits":"10","bban":{"bank_code":"00230","account_number":"000000012345"},"sepa":{"member":true,"schemes":["SCT","SDD"],"vop_required":false,"vop_participant":false},"formatted":"CH10 0023 0000 0000 1234 5","cost_usdc":0,"bic":{"code":"UBSWCHZH","bank_name":"UBS Switzerland AG","city":"Zürich","source":"IBANforge curated bank-code map","as_of":"2026-08"},"issuer":{"type":"bank","name":"UBS Switzerland AG","classification":"default"},"risk_indicators":{"issuer_type":"bank","country_risk":"standard","test_bic":false,"sepa_reachable":true,"sepa_reachable_scope":"country","vop_coverage":false},"bank_code_check":{"value":"00230","status":"verified","match":"register","register":"SIX BankMaster (Swiss IID / BC-Nummer register)","authoritative":true,"institution":{"name":"UBS Switzerland AG","street":"Bahnhofstrasse 45","post_code":"8098","town":"Zürich","country":"CH"},"as_of":"2026-08"},"clearing":{"iid":"00230","name":"UBS Switzerland AG","type":"bank","town":"Zürich","sic":true,"instant_payments_chf":true,"eurosic":true,"qr_iid":"30005","qr_iid_source":"register","qr_iids":["30005","30308"]},"next_steps":[{"code":"screen_compliance","do":"Screen the institution against sanctions, FATF status and VoP reachability before the transfer. That endpoint reads the same bank-code verdict as this one, so it will not score an unconfirmed code as an ordinary bank.","because":"bank_code_check.status is verified, so there is an institution to screen","action":"POST /v1/iban/compliance"}],"processing_ms":125.76}
        """;

    // sdks/fixtures/quickstart-api.json -> "batch"
    private const string BatchBody = """
        {"results":[{"iban":"CH1000230000000012345","valid":true,"country":{"code":"CH","name":"Switzerland"},"check_digits":"10","bban":{"bank_code":"00230","account_number":"000000012345"},"sepa":{"member":true,"schemes":["SCT","SDD"],"vop_required":false,"vop_participant":false},"formatted":"CH10 0023 0000 0000 1234 5","cost_usdc":0,"bic":{"code":"UBSWCHZH","bank_name":"UBS Switzerland AG","city":"Zürich","source":"IBANforge curated bank-code map","as_of":"2026-08"},"issuer":{"type":"bank","name":"UBS Switzerland AG","classification":"default"},"risk_indicators":{"issuer_type":"bank","country_risk":"standard","test_bic":false,"sepa_reachable":true,"sepa_reachable_scope":"country","vop_coverage":false},"bank_code_check":{"value":"00230","status":"verified","match":"register","register":"SIX BankMaster (Swiss IID / BC-Nummer register)","authoritative":true,"institution":{"name":"UBS Switzerland AG","street":"Bahnhofstrasse 45","post_code":"8098","town":"Zürich","country":"CH"},"as_of":"2026-08"},"clearing":{"iid":"00230","name":"UBS Switzerland AG","type":"bank","town":"Zürich","sic":true,"instant_payments_chf":true,"eurosic":true,"qr_iid":"30005","qr_iid_source":"register","qr_iids":["30005","30308"]},"next_steps":[{"code":"screen_compliance","do":"Screen the institution against sanctions, FATF status and VoP reachability before the transfer. That endpoint reads the same bank-code verdict as this one, so it will not score an unconfirmed code as an ordinary bank.","because":"bank_code_check.status is verified, so there is an institution to screen","action":"POST /v1/iban/compliance"}]},{"iban":"DE89370400440532013000","valid":true,"country":{"code":"DE","name":"Germany"},"check_digits":"89","bban":{"bank_code":"37040044","account_number":"0532013000"},"sepa":{"member":true,"schemes":["SCT","SDD","SCT_INST"],"vop_required":true,"vop_participant":true},"formatted":"DE89 3704 0044 0532 0130 00","cost_usdc":0,"bic":{"code":"COBADEFFXXX","bank_name":"Commerzbank","city":"Köln","source":"Deutsche Bundesbank Bankleitzahlendatei","as_of":"2026-08"},"issuer":{"type":"bank","name":"Commerzbank","classification":"default"},"risk_indicators":{"issuer_type":"bank","country_risk":"standard","test_bic":false,"sepa_reachable":true,"sepa_reachable_scope":"country","vop_coverage":true},"bank_code_check":{"value":"37040044","status":"verified","match":"register","register":"Deutsche Bundesbank Bankleitzahlendatei","authoritative":true,"institution":{"name":"Commerzbank","street":null,"post_code":"50447","town":"Köln","country":"DE"},"as_of":"2026-08"},"next_steps":[{"code":"screen_compliance","do":"Screen the institution against sanctions, FATF status and VoP reachability before the transfer. That endpoint reads the same bank-code verdict as this one, so it will not score an unconfirmed code as an ordinary bank.","because":"bank_code_check.status is verified, so there is an institution to screen","action":"POST /v1/iban/compliance"}]}],"count":2,"valid_count":2,"cost_usdc":0,"processing_ms":77.63}
        """;

    // sdks/fixtures/quickstart-api.json -> "compliance"
    private const string ComplianceBody = """
        {"iban":"GB29NWBK60161331926819","valid":true,"country":{"code":"GB","name":"United Kingdom"},"check_digits":"29","bban":{"bank_code":"NWBK","account_number":"31926819","branch_code":"601613"},"sepa":{"member":true,"schemes":["SCT","SDD"],"vop_required":false,"vop_participant":false},"formatted":"GB29 NWBK 6016 1331 9268 19","cost_usdc":0,"bic":{"code":"NWBKGB2L","bank_name":"NatWest","city":"London","source":"IBANforge curated bank-code map","as_of":"2026-08"},"issuer":{"type":"bank","name":"NatWest","classification":"default"},"risk_indicators":{"issuer_type":"bank","country_risk":"standard","test_bic":false,"sepa_reachable":true,"sepa_reachable_scope":"country","vop_coverage":false},"bank_code_check":{"value":"NWBK","status":"verified","match":"register","register":"IBANforge composite bank-code map (assembled from BIC directories, not a national bank-code register)","authoritative":false,"as_of":"2026-08"},"modulus_check":{"checked":true,"passed":true,"source":"Vocalink modulus weight table (published for Pay.UK)","table_fetched_on":"2026-08-14"},"next_steps":[{"code":"screen_compliance","do":"Screen the institution against sanctions, FATF status and VoP reachability before the transfer. That endpoint reads the same bank-code verdict as this one, so it will not score an unconfirmed code as an ordinary bank.","because":"bank_code_check.status is verified, so there is an institution to screen","action":"POST /v1/iban/compliance"}],"compliance":{"sanctions":{"country_sanctioned":false,"bank_sanctioned":false,"matched_lists":[],"fatf_status":"member","bank_screened":true},"reachability":{"sepa_instant":false,"sct":true,"sdd":true,"screened":true},"vop":{"participant":false,"status":"not_found","screened":true},"risk_score":10,"risk_level":"low","flags":["no_sepa_instant","no_vop"]},"meta":{"scope":"bank_bic_only","disclaimer":"Informational triage only — NOT a regulated AML/CFT product. Sanctions screening is performed at the BANK (BIC8) level: it flags the holding institution, NOT the beneficiary / account-holder name. Most sanctions designations target persons and companies, which this does not screen. Use a regulated provider (Refinitiv, ComplyAdvantage, etc.) for name-level KYC/AML obligations.","sanctions_as_of":"2026-08-21T04:57:05.198Z","fatf_as_of":"2026-06","sources":"EU,OFAC,UN,FATF,EPC-SCT,EPC-SCT_INST,EPC-SDD","country_risk_as_of":"2026-07","country_risk_scope":"risk_indicators.country_risk is a separate editorial AML axis (offshore centres, conflict zones, EBA-flagged jurisdictions) layered ON TOP of compliance.sanctions.fatf_status, not a restatement of it. The two can disagree on a country by design; each carries its own review date."},"processing_ms":30.36}
        """;

    [Fact]
    public async Task FormatIbanAsync_SendsFreeGetRequest_AndDeserializesValid()
    {
        var handler = new FakeHttpMessageHandler(HttpStatusCode.OK, FormatOkBody);
        using var client = TestClients.Create(handler, apiKey: null);

        var result = await client.FormatIbanAsync("CH1000230000000012345");

        var request = handler.SingleRequest;
        Assert.Equal(HttpMethod.Get, request.Method);
        Assert.Equal("/v1/iban/format", request.RequestUri!.AbsolutePath);
        Assert.Equal("iban=CH1000230000000012345", request.RequestUri!.Query.TrimStart('?'));
        Assert.Null(request.Headers.Authorization);
        Assert.Contains("ibanforge-dotnet/1.5.0", request.Headers.UserAgent.ToString());

        Assert.True(result.Valid);
        Assert.Equal("CH10 0023 0000 0000 1234 5", result.Formatted);
        Assert.Equal("CH", result.Country!.Code);
        Assert.Equal("00230", result.Bban!.BankCode);
        Assert.Null(result.Error);
    }

    [Fact]
    public async Task FormatIbanAsync_ChecksumFailure_IsNotAnException()
    {
        var handler = new FakeHttpMessageHandler(HttpStatusCode.OK, FormatChecksumFailedBody);
        using var client = TestClients.Create(handler);

        var result = await client.FormatIbanAsync("CH93007620116238529XX");

        Assert.False(result.Valid);
        Assert.Equal("checksum_failed", result.Error);
        Assert.Equal("Modulo 97 check returned 95, expected 1.", result.ErrorDetail);
        Assert.Null(result.Bban);
    }

    [Fact]
    public async Task FormatIbanAsync_EscapesQueryValue()
    {
        var handler = new FakeHttpMessageHandler(HttpStatusCode.OK, FormatOkBody);
        using var client = TestClients.Create(handler);

        await client.FormatIbanAsync("CH10 0023 0000 0000 1234 5");

        Assert.Equal("iban=CH10%200023%200000%200000%201234%205", handler.SingleRequest.RequestUri!.Query.TrimStart('?'));
    }

    [Fact]
    public async Task ValidateIbanAsync_PostsIbanBody_AndDeserializesFullEnrichment()
    {
        var handler = new FakeHttpMessageHandler(HttpStatusCode.OK, ValidateVerifiedBody);
        using var client = TestClients.Create(handler, apiKey: "ifk_live_key");

        var result = await client.ValidateIbanAsync("CH1000230000000012345");

        var request = handler.SingleRequest;
        Assert.Equal(HttpMethod.Post, request.Method);
        Assert.Equal("/v1/iban/validate", request.RequestUri!.AbsolutePath);
        Assert.Equal("Bearer ifk_live_key", request.Headers.Authorization!.ToString());
        Assert.Equal("""{"iban":"CH1000230000000012345"}""", handler.RequestBodies.Single());

        Assert.True(result.Valid);
        Assert.Equal(0, result.CostUsdc);
        Assert.Equal("UBSWCHZH", result.Bic!.Code);
        Assert.Equal("UBS Switzerland AG", result.Bic.BankName);
        // This fixture's `bic` block carries no `basis`/`authoritative` classification
        // (only bank_code_check does); must deserialize to null, not false or throw.
        Assert.Null(result.Bic.Authoritative);
        Assert.Equal("verified", result.BankCodeCheck!.Status);
        Assert.True(result.BankCodeCheck.Authoritative);
        Assert.Equal("UBS Switzerland AG", result.BankCodeCheck.Institution!["name"]);
        Assert.Equal("00230", result.Clearing!.Iid);
        Assert.True(result.Clearing.Sic);
        Assert.Equal(new[] { "30005", "30308" }, result.Clearing.QrIids);
        Assert.Single(result.NextSteps!);
        Assert.Equal("POST /v1/iban/compliance", result.NextSteps![0].Action);
        Assert.False(result.Sepa!.VopParticipant);
    }

    [Fact]
    public async Task ValidateBatchAsync_PostsIbansArray_AndDeserializesResultsInOrder()
    {
        var handler = new FakeHttpMessageHandler(HttpStatusCode.OK, BatchBody);
        using var client = TestClients.Create(handler);

        var result = await client.ValidateBatchAsync(new[] { "CH1000230000000012345", "DE89370400440532013000" });

        Assert.Equal("""{"ibans":["CH1000230000000012345","DE89370400440532013000"]}""", handler.RequestBodies.Single());
        Assert.Equal(2, result.Count);
        Assert.Equal(2, result.ValidCount);
        Assert.Equal(2, result.Results.Count);
        Assert.Equal("CH1000230000000012345", result.Results[0].Iban);
        Assert.Equal("DE89370400440532013000", result.Results[1].Iban);
        Assert.Equal("COBADEFFXXX", result.Results[1].Bic!.Code);
        // The DE leg carries no `clearing` key at all in the fixture (CH/LI only); must deserialize to null, not throw.
        Assert.Null(result.Results[1].Clearing);
    }

    [Fact]
    public async Task ValidateBatchAsync_EmptyList_ThrowsWithoutNetworkCall()
    {
        var handler = new FakeHttpMessageHandler(HttpStatusCode.OK, BatchBody);
        using var client = TestClients.Create(handler);

        var ex = await Assert.ThrowsAsync<InvalidInputException>(() => client.ValidateBatchAsync(Array.Empty<string>()));

        Assert.Equal("ibans must contain at least one IBAN", ex.Message);
        Assert.Null(ex.Status);
        Assert.Empty(handler.Requests);
    }

    [Fact]
    public async Task ValidateBatchAsync_OverOneHundred_ThrowsWithoutNetworkCall()
    {
        var handler = new FakeHttpMessageHandler(HttpStatusCode.OK, BatchBody);
        using var client = TestClients.Create(handler);
        var tooMany = Enumerable.Repeat("CH1000230000000012345", 101);

        var ex = await Assert.ThrowsAsync<InvalidInputException>(() => client.ValidateBatchAsync(tooMany));

        Assert.Equal("ibans must be at most 100 entries (got 101)", ex.Message);
        Assert.Empty(handler.Requests);
    }

    [Fact]
    public async Task CheckComplianceAsync_PostsIbanBody_AndDeserializesInheritedAndComplianceFields()
    {
        var handler = new FakeHttpMessageHandler(HttpStatusCode.OK, ComplianceBody);
        using var client = TestClients.Create(handler);

        var result = await client.CheckComplianceAsync("GB29NWBK60161331926819");

        Assert.Equal("/v1/iban/compliance", handler.SingleRequest.RequestUri!.AbsolutePath);
        Assert.Equal("""{"iban":"GB29NWBK60161331926819"}""", handler.RequestBodies.Single());

        // Inherited IbanValidationResult fields:
        Assert.True(result.Valid);
        Assert.Equal("NWBKGB2L", result.Bic!.Code);

        // No top-level risk_score: only at result.Compliance.RiskScore.
        Assert.Equal(10, result.Compliance.RiskScore);
        Assert.Equal("low", result.Compliance.RiskLevel);
        Assert.Equal(new[] { "no_sepa_instant", "no_vop" }, result.Compliance.Flags);
        Assert.False(result.Compliance.Sanctions.BankSanctioned);
        Assert.True(result.Compliance.Sanctions.BankScreened);
        Assert.False(result.Compliance.Reachability.SepaInstant);
        Assert.Equal("not_found", result.Compliance.Vop.Status);
        Assert.Equal("bank_bic_only", result.Meta!.Scope);
    }
}

using System.Net;
using System.Text.Json;
using IBANforge.Sdk;
using IBANforge.Sdk.Models;
using Xunit;

namespace IBANforge.Sdk.Tests;

/// <summary>
/// Covers the free reference-data and utility endpoints: IBAN structures, test
/// IBANs, payment reference validation, address checks, credit bundles and the
/// demo endpoint.
/// </summary>
public sealed class ReferenceDataTests
{
    // sdks/fixtures/quickstart-api.json -> "iban-structure-ch"
    private const string IbanStructureChBody = """
        {"country":{"code":"CH","name":"Switzerland"},"iban_length":21,"bban_length":17,"bban":{"bank_code":{"start":0,"length":5,"charset":"5!n"},"account_number":{"start":5,"length":12,"charset":"12!c"}},"bban_pattern":"5!n12!c","sepa":{"member":true,"schemes":["SCT","SDD"],"vop_required":false},"example_iban":"CH9300762011623852957","example_iban_note":"Illustration from the SWIFT IBAN Registry. Its bank code is not guaranteed to be allocated, so this IBAN may come back bank_code_check.status not_in_register from POST /v1/iban/validate. That is the example being fictional, not a gap in our data.","notes":"BBAN positions are 0-indexed within the BBAN portion of the IBAN (after country code + check digits).","upgrade_hint":"Try the canonical example: GET /v1/iban/format?iban=CH9300762011623852957  or  POST /v1/iban/validate (with full enrichment, $0.005)","cost_usdc":0}
        """;

    // sdks/fixtures/quickstart-api.json -> "test-iban"
    private const string TestIbanBody = """
        {"test_ibans":[{"iban":"CH4208704626920706430","formatted":"CH42 0870 4626 9207 0643 0","country":"CH","proof":{"bank_code_check":{"value":"08704","status":"verified","match":"register","register":"SIX BankMaster (Swiss IID / BC-Nummer register)","authoritative":true,"institution":{"name":"AEK BANK 1826 Genossenschaft","street":"Hofstettenstrasse 2","post_code":"3601","town":"Thun","country":"CH"},"as_of":"2026-08"},"bic":{"code":"AEKTCH22","bank_name":"AEK BANK 1826 Genossenschaft","city":"Thun","source":"IBANforge curated bank-code map","as_of":"2026-08"}},"note":"Structurally valid test IBAN with a REAL, register-allocated bank code. The account digits are random — this is NOT a real account. Safe for demos, fixtures and integration tests."}],"disclaimer":"Bank codes are real (drawn from the national registers we serve); account digits are random and belong to nobody. Do not send money to these.","docs":"https://ibanforge.com/tools/test-iban","cost_usdc":0}
        """;

    // sdks/fixtures/quickstart-api.json -> "credit-bundles"
    private const string CreditBundlesBody = """
        {"bundles":[{"slug":"1k","credits":1000,"price_usdc":5,"price_per_call_usdc":0.005,"buy_endpoint":"POST /v1/credits/buy/1k"},{"slug":"5k","credits":5000,"price_usdc":20,"price_per_call_usdc":0.004,"buy_endpoint":"POST /v1/credits/buy/5k"},{"slug":"25k","credits":25000,"price_usdc":80,"price_per_call_usdc":0.0032,"buy_endpoint":"POST /v1/credits/buy/25k"}],"payment_method":"x402 USDC on Base mainnet","documentation":"https://ibanforge.com/agents#credits"}
        """;

    // No recorded fixture exists for POST /v1/address/check; shape mirrors src/routes/openapi.ts's documented response.
    private const string AddressCheckBody = """
        {"scheme":"sps","conforms":false,"findings":[{"rule":"adr_tp_forbidden","verdict":"fail","detail":"AdrTp must not be sent under SPS 2026.","source":"SIX SPS 2026, section 4.2"},{"rule":"twn_nm_required","verdict":"pass","detail":"TwnNm is present.","source":"SIX SPS 2026, section 4.1"}],"note":"No cbpr+ scheme is offered: CBPR+ structured-address rules are not yet finalised."}
        """;

    [Fact]
    public async Task IbanStructuresAsync_Get_AndDeserializesFullCountryList()
    {
        var handler = new FakeHttpMessageHandler(HttpStatusCode.OK, Fixtures.Load("iban-structures"));
        using var client = TestClients.Create(handler);

        var result = await client.IbanStructuresAsync();

        Assert.Equal(HttpMethod.Get, handler.SingleRequest.Method);
        Assert.Equal("/v1/iban/structure", handler.SingleRequest.RequestUri!.AbsolutePath);
        Assert.Equal(89, result.Total);
        Assert.Equal(89, result.Countries.Count);
        Assert.Equal("GET /v1/iban/structure/:country", result.EndpointPerCountry);

        var ch = result.Countries.Single(c => c.Code == "CH");
        Assert.Equal("Switzerland", ch.Name);
        Assert.Equal(21, ch.IbanLength);
        Assert.True(ch.SepaMember);
    }

    [Fact]
    public async Task IbanStructureAsync_GetsEscapedPath_AndDeserializesBbanTemplate()
    {
        var handler = new FakeHttpMessageHandler(HttpStatusCode.OK, IbanStructureChBody);
        using var client = TestClients.Create(handler);

        var result = await client.IbanStructureAsync("CH");

        Assert.Equal("/v1/iban/structure/CH", handler.SingleRequest.RequestUri!.AbsolutePath);
        Assert.Equal(21, result.IbanLength);
        Assert.Equal("5!n12!c", result.BbanPattern);
        Assert.Equal(0, result.Bban["bank_code"].Start);
        Assert.Equal(5, result.Bban["bank_code"].Length);
        Assert.Equal(12, result.Bban["account_number"].Length);
        Assert.True(result.Sepa!.Member);
        Assert.NotNull(result.ExampleIbanNote);
    }

    [Fact]
    public async Task TestIbanAsync_NoOptions_OmitsQueryString()
    {
        var handler = new FakeHttpMessageHandler(HttpStatusCode.OK, TestIbanBody);
        using var client = TestClients.Create(handler);

        await client.TestIbanAsync();

        Assert.Equal("/v1/test-iban", handler.SingleRequest.RequestUri!.AbsolutePath);
        Assert.Equal(string.Empty, handler.SingleRequest.RequestUri!.Query);
    }

    [Fact]
    public async Task TestIbanAsync_WithCountryAndCount_BuildsQueryString_AndDeserializesProof()
    {
        var handler = new FakeHttpMessageHandler(HttpStatusCode.OK, TestIbanBody);
        using var client = TestClients.Create(handler);

        var result = await client.TestIbanAsync(country: "CH", count: 3);

        Assert.Equal("country=CH&count=3", handler.SingleRequest.RequestUri!.Query.TrimStart('?'));
        var entry = Assert.Single(result.TestIbans);
        Assert.Equal("CH4208704626920706430", entry.Iban);
        Assert.Equal("verified", entry.Proof.BankCodeCheck.Status);
        Assert.Equal("AEKTCH22", entry.Proof.Bic!.Code);
    }

    [Fact]
    public async Task ValidateReferenceAsync_WithoutType_BuildsMinimalQuery()
    {
        var handler = new FakeHttpMessageHandler(HttpStatusCode.OK, """{"reference":"RF18539007547034","scheme":"rf","valid":true,"status":"valid","source":"ISO 11649:2009","note":"Mod 97-10 check digit matches."}""");
        using var client = TestClients.Create(handler);

        var result = await client.ValidateReferenceAsync("RF18539007547034");

        Assert.Equal("reference=RF18539007547034", handler.SingleRequest.RequestUri!.Query.TrimStart('?'));
        Assert.True(result.Valid);
        Assert.Equal("rf", result.Scheme);
    }

    [Fact]
    public async Task ValidateReferenceAsync_WithType_AppendsReferenceType()
    {
        var handler = new FakeHttpMessageHandler(HttpStatusCode.OK, """{"reference":"010008068171","scheme":"ogm","valid":true,"status":"valid","source":"Belgian OGM/VCS specification","note":"Modulo 97 remainder matches (written as 97)."}""");
        using var client = TestClients.Create(handler);

        await client.ValidateReferenceAsync("+++010/0080/68171+++", referenceType: "ogm");

        var query = handler.SingleRequest.RequestUri!.Query.TrimStart('?');
        Assert.Contains("reference=", query);
        Assert.Contains("&reference_type=ogm", query);
    }

    [Fact]
    public async Task CheckAddressAsync_PostsSchemeAndAddress_IncludingExtraTags_AndDeserializesFindings()
    {
        var handler = new FakeHttpMessageHandler(HttpStatusCode.OK, AddressCheckBody);
        using var client = TestClients.Create(handler);
        var address = new PostalAddress
        {
            TwnNm = "Zurich",
            Ctry = "CH",
            PstCd = "8001",
            StrtNm = "Bahnhofstrasse",
            BldgNb = "45",
            AdrLine = new List<string> { "c/o Reception" },
            // Mirrors the TypeScript SDK's `[tag: string]: unknown` index signature: any
            // ISO 20022 tag not modelled explicitly can still be sent through.
            ExtraTags = new Dictionary<string, JsonElement>
            {
                ["dept"] = JsonSerializer.SerializeToElement("Accounts Payable"),
            },
        };

        var result = await client.CheckAddressAsync("sps", address);

        Assert.Equal("/v1/address/check", handler.SingleRequest.RequestUri!.AbsolutePath);
        var sentBody = handler.RequestBodies.Single()!;
        Assert.Contains("\"scheme\":\"sps\"", sentBody);
        Assert.Contains("\"twn_nm\":\"Zurich\"", sentBody);
        Assert.Contains("\"adr_line\":[\"c/o Reception\"]", sentBody);
        Assert.Contains("\"dept\":\"Accounts Payable\"", sentBody);
        // Unset fields (e.g. adr_tp) must be omitted, not sent as explicit nulls.
        Assert.DoesNotContain("adr_tp", sentBody);

        Assert.False(result.Conforms);
        Assert.Equal(2, result.Findings.Count);
        Assert.Equal("fail", result.Findings[0].Verdict);
    }

    [Fact]
    public async Task CreditBundlesAsync_Get_AndDeserializesBundles()
    {
        var handler = new FakeHttpMessageHandler(HttpStatusCode.OK, CreditBundlesBody);
        using var client = TestClients.Create(handler);

        var result = await client.CreditBundlesAsync();

        Assert.Equal("/v1/credits/bundles", handler.SingleRequest.RequestUri!.AbsolutePath);
        Assert.Equal(3, result.Bundles.Count);
        Assert.Equal("1k", result.Bundles[0].Slug);
        Assert.Equal(1000, result.Bundles[0].Credits);
        Assert.Equal(0.005, result.Bundles[0].PricePerCallUsdc);
        Assert.Equal("x402 USDC on Base mainnet", result.PaymentMethod);
    }

    [Fact]
    public async Task DemoAsync_Get_AndDeserializes_TolerantOfFieldsRealApiOmitsHere()
    {
        var handler = new FakeHttpMessageHandler(HttpStatusCode.OK, Fixtures.Load("demo"));
        using var client = TestClients.Create(handler, apiKey: null);

        var result = await client.DemoAsync();

        Assert.Equal("/v1/demo", handler.SingleRequest.RequestUri!.AbsolutePath);
        Assert.Null(handler.SingleRequest.Headers.Authorization);

        Assert.NotEmpty(result.IbanExamples!);
        Assert.Equal("GB29NWBK60161331926819", result.IbanExamples![0].Iban);

        // The demo endpoint's bic_examples entries omit `valid_format` even though
        // BicLookupResult declares it non-optional on a live /v1/bic/:code call;
        // this must deserialize to the type's default (false), never throw.
        Assert.NotEmpty(result.BicExamples!);
        Assert.False(result.BicExamples![0].ValidFormat);
        Assert.Equal("UBS SWITZERLAND AG", result.BicExamples[0].Institution);

        Assert.NotNull(result.ComplianceExample);
        Assert.Equal(JsonValueKind.Object, result.ComplianceExample!.Value.ValueKind);
        Assert.Equal("POST /v1/iban/compliance", result.ComplianceExample.Value.GetProperty("endpoint").GetString());
    }
}

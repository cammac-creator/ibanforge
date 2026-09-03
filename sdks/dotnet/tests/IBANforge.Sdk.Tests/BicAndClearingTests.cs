using System.Net;
using IBANforge.Sdk;
using Xunit;

namespace IBANforge.Sdk.Tests;

/// <summary>Covers <c>LookupBicAsync</c> and both <c>LookupChClearingAsync</c> overloads.</summary>
public sealed class BicAndClearingTests
{
    // sdks/fixtures/quickstart-api.json -> "bic-lookup"
    private const string BicLookupBody = """
        {"bic":"UBSWCHZH80A","bic8":"UBSWCHZH","bic11":"UBSWCHZH80A","found":true,"valid_format":true,"institution":"UBS Switzerland AG","country":{"code":"CH","name":"Switzerland"},"city":"Zurich","address":{"type":"registered","street":"Bahnhofstrasse 45","post_code":"8001","region":"CH-ZH","city":"Zurich","country":"CH","romanized":"Bahnhofstrasse 45","romanization":"original_latin","source":"GLEIF","language":"en","as_of":"2025-12-29"},"address_available":true,"branch_code":"80A","branch_info":null,"lei":"549300WOIFUSNYH0FL22","lei_status":"ACTIVE","is_test_bic":false,"source":"gleif","cost_usdc":0,"processing_ms":0.61}
        """;

    // sdks/fixtures/quickstart-api.json -> "ch-clearing"
    private const string ChClearingBody = """
        {"iid":"00230","found":true,"institution":{"name":"UBS Switzerland AG","type":"bank","iid_type":"headquarters","headquarters_iid":"00230"},"address":{"street":"Bahnhofstrasse","building_number":"45","post_code":"8098","town":"Zürich","country":"CH"},"bic":"UBSWCHZH80A","payment_services":{"sic":true,"rtgs_chf":true,"instant_payments_chf":true,"eurosic":true,"lsv_bdd_chf":true,"lsv_bdd_eur":true},"sic_iid":"002301","qr_iid":"30005","qr_iid_source":"register","qr_iids":["30005","30308"],"valid_on":"2026-08-03","cost_usdc":0,"processing_ms":0.06}
        """;

    [Fact]
    public async Task LookupBicAsync_GetsEscapedPath_AndDeserializes()
    {
        var handler = new FakeHttpMessageHandler(HttpStatusCode.OK, BicLookupBody);
        using var client = TestClients.Create(handler);

        var result = await client.LookupBicAsync("UBSWCHZH80A");

        Assert.Equal(HttpMethod.Get, handler.SingleRequest.Method);
        Assert.Equal("/v1/bic/UBSWCHZH80A", handler.SingleRequest.RequestUri!.AbsolutePath);

        Assert.Equal("UBSWCHZH80A", result.BicCode);
        Assert.Equal("UBSWCHZH", result.Bic8);
        Assert.True(result.Found);
        Assert.True(result.ValidFormat);
        Assert.Equal("UBS Switzerland AG", result.Institution);
        Assert.Equal("549300WOIFUSNYH0FL22", result.Lei);
        Assert.Equal("ACTIVE", result.LeiStatus);
        Assert.Equal("original_latin", result.Address!.Romanization);
        Assert.Null(result.BranchInfo);
    }

    [Fact]
    public async Task LookupChClearingAsync_String_GetsPath_AndDeserializesNestedBlocks()
    {
        var handler = new FakeHttpMessageHandler(HttpStatusCode.OK, ChClearingBody);
        using var client = TestClients.Create(handler);

        var result = await client.LookupChClearingAsync("230");

        Assert.Equal("/v1/ch/clearing/230", handler.SingleRequest.RequestUri!.AbsolutePath);
        Assert.Equal("00230", result.Iid);
        Assert.True(result.Found);
        Assert.Equal("UBS Switzerland AG", result.Institution!.Name);
        Assert.Equal("headquarters", result.Institution.IidType);
        Assert.True(result.PaymentServices!.Sic);
        Assert.True(result.PaymentServices.InstantPaymentsChf);
        Assert.Equal("Zürich", result.Address!["town"]);
        Assert.Equal(new[] { "30005", "30308" }, result.QrIids);
    }

    [Fact]
    public async Task LookupChClearingAsync_Long_DelegatesToSameStringPath()
    {
        var handler = new FakeHttpMessageHandler(HttpStatusCode.OK, ChClearingBody);
        using var client = TestClients.Create(handler);

        await client.LookupChClearingAsync(230L);

        Assert.Equal("/v1/ch/clearing/230", handler.SingleRequest.RequestUri!.AbsolutePath);
    }
}

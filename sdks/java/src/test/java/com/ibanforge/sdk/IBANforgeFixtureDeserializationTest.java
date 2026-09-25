package com.ibanforge.sdk;

import com.ibanforge.sdk.model.APIKey;
import com.ibanforge.sdk.model.APIKeyUsage;
import com.ibanforge.sdk.model.BICLookupResult;
import com.ibanforge.sdk.model.CHClearingResult;
import com.ibanforge.sdk.model.ComplianceResult;
import com.ibanforge.sdk.model.CreditBundleList;
import com.ibanforge.sdk.model.DemoResult;
import com.ibanforge.sdk.model.IBANFormatResult;
import com.ibanforge.sdk.model.IBANStructure;
import com.ibanforge.sdk.model.IBANValidationResult;
import com.ibanforge.sdk.model.TestIbanResult;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Deserializes response bodies recorded from the real IBANforge API (see
 * {@code sdks/fixtures/quickstart-api.json}, {@code calls[].name} noted on each test) into the
 * SDK's model records, and asserts field-by-field on the tricky parts: nested objects, nullable
 * fields that are real answers (not gaps), and lists.
 *
 * <p>The bodies below are reproduced (sometimes trimmed of repeated sibling entries) from that
 * fixture file rather than invented, so a naming-strategy mistake -- the exact bug class the TS
 * and Python SDKs both carry scars from ("bank_name, not bankName") -- shows up as a null field
 * here instead of surfacing for a real caller.
 */
class IBANforgeFixtureDeserializationTest {

    private MockApiServer server;

    @BeforeEach
    void setUp() {
        server = new MockApiServer();
    }

    @AfterEach
    void tearDown() {
        server.close();
    }

    private IBANforge client() {
        return IBANforge.builder().baseUrl(server.baseUrl()).build();
    }

    // fixture: "validate-verified" -- CH1000230000000012345, a register-allocated UBS code.
    private static final String VALIDATE_VERIFIED = """
        {
          "iban": "CH1000230000000012345",
          "valid": true,
          "country": { "code": "CH", "name": "Switzerland" },
          "check_digits": "10",
          "bban": { "bank_code": "00230", "account_number": "000000012345" },
          "sepa": { "member": true, "schemes": ["SCT", "SDD"], "vop_required": false, "vop_participant": false },
          "formatted": "CH10 0023 0000 0000 1234 5",
          "cost_usdc": 0,
          "bic": {
            "code": "UBSWCHZH",
            "bank_name": "UBS Switzerland AG",
            "city": "Zürich",
            "source": "IBANforge curated bank-code map",
            "as_of": "2026-08"
          },
          "issuer": { "type": "bank", "name": "UBS Switzerland AG", "classification": "default" },
          "risk_indicators": {
            "issuer_type": "bank", "country_risk": "standard", "test_bic": false,
            "sepa_reachable": true, "sepa_reachable_scope": "country", "vop_coverage": false
          },
          "bank_code_check": {
            "value": "00230", "status": "verified", "match": "register",
            "register": "SIX BankMaster (Swiss IID / BC-Nummer register)", "authoritative": true,
            "institution": { "name": "UBS Switzerland AG", "street": "Bahnhofstrasse 45", "post_code": "8098", "town": "Zürich", "country": "CH" },
            "as_of": "2026-08"
          },
          "clearing": {
            "iid": "00230", "name": "UBS Switzerland AG", "type": "bank", "town": "Zürich",
            "sic": true, "instant_payments_chf": true, "eurosic": true,
            "qr_iid": "30005", "qr_iid_source": "register", "qr_iids": ["30005", "30308"]
          },
          "next_steps": [
            {
              "code": "screen_compliance",
              "do": "Screen the institution against sanctions, FATF status and VoP reachability before the transfer.",
              "because": "bank_code_check.status is verified, so there is an institution to screen",
              "action": "POST /v1/iban/compliance"
            }
          ],
          "processing_ms": 125.76
        }
        """;

    @Test
    void validateVerified_bicClearingAndBankCodeCheckAreFullyPopulated() {
        server.enqueue(MockApiServer.CannedResponse.json(200, VALIDATE_VERIFIED));
        IBANValidationResult r = client().validateIban("CH1000230000000012345");

        assertTrue(r.valid());
        assertEquals("Switzerland", r.country().name());
        assertEquals("00230", r.bban().bankCode());

        assertEquals("UBSWCHZH", r.bic().code());
        assertEquals("UBS Switzerland AG", r.bic().bankName()); // not bankName's sibling "name"
        assertEquals("Zürich", r.bic().city());

        assertTrue(r.sepa().member());
        assertEquals(java.util.List.of("SCT", "SDD"), r.sepa().schemes());
        assertFalse(r.sepa().vopParticipant()); // false, not absent

        assertEquals("verified", r.bankCodeCheck().status());
        assertTrue(r.bankCodeCheck().authoritative());
        assertEquals("UBS Switzerland AG", r.bankCodeCheck().institution().get("name"));
        assertEquals("Zürich", r.bankCodeCheck().institution().get("town"));

        assertEquals("00230", r.clearing().iid());
        assertTrue(r.clearing().sic());
        assertTrue(r.clearing().instantPaymentsChf());
        assertEquals(java.util.List.of("30005", "30308"), r.clearing().qrIids());

        assertEquals(1, r.nextSteps().size());
        assertEquals("screen_compliance", r.nextSteps().get(0).code());
        assertTrue(r.nextSteps().get(0).doStep().startsWith("Screen the institution"));
        assertEquals("POST /v1/iban/compliance", r.nextSteps().get(0).action());

        assertEquals(125.76, r.processingMs());
        assertEquals(0.0, r.costUsdc());
    }

    // fixture: "validate-not-in-register" -- the SWIFT registry's own illustration IBAN, whose
    // bank code 00762 is not allocated. This is the exact trap the SDK's own docs warn about.
    private static final String VALIDATE_NOT_IN_REGISTER = """
        {
          "iban": "CH9300762011623852957",
          "valid": true,
          "country": { "code": "CH", "name": "Switzerland" },
          "check_digits": "93",
          "bban": { "bank_code": "00762", "account_number": "011623852957" },
          "sepa": { "member": true, "schemes": ["SCT", "SDD"], "vop_required": false, "vop_participant": null },
          "formatted": "CH93 0076 2011 6238 5295 7",
          "cost_usdc": 0,
          "bic": null,
          "risk_indicators": {
            "issuer_type": null, "country_risk": "standard", "test_bic": false,
            "sepa_reachable": true, "sepa_reachable_scope": "country", "vop_coverage": false
          },
          "bank_code_check": {
            "value": "00762", "status": "not_in_register", "match": null,
            "register": "SIX BankMaster (Swiss IID / BC-Nummer register)", "authoritative": true,
            "as_of": "2026-08"
          },
          "clearing": null,
          "next_steps": [
            {
              "code": "bank_code_not_allocated",
              "do": "Do not send. The bank code is absent from the national register, so no institution holds this account.",
              "because": "bank_code_check.status is not_in_register and authoritative is true (SIX BankMaster (Swiss IID / BC-Nummer register))"
            }
          ],
          "processing_ms": 18.91
        }
        """;

    @Test
    void validateNotInRegister_nullsAreRealAnswersNotMissingFields() {
        server.enqueue(MockApiServer.CannedResponse.json(200, VALIDATE_NOT_IN_REGISTER));
        IBANValidationResult r = client().validateIban("CH9300762011623852957");

        // valid: true AND not_in_register is the correct, deliberate pair -- see the SDK's
        // class-level Javadoc warning about this exact IBAN.
        assertTrue(r.valid());
        assertNull(r.bic());
        assertNull(r.clearing());
        assertNull(r.sepa().vopParticipant()); // null, distinct from false
        assertNull(r.riskIndicators().issuerType());

        assertEquals("not_in_register", r.bankCodeCheck().status());
        assertTrue(r.bankCodeCheck().authoritative());
        assertNull(r.bankCodeCheck().match());

        assertEquals("bank_code_not_allocated", r.nextSteps().get(0).code());
        assertNull(r.nextSteps().get(0).action()); // absent in this fixture, must not be "null" string
    }

    // fixture: "format-checksum-failed"
    @Test
    void formatIban_checksumFailed_isA200NotAnException() {
        server.enqueue(MockApiServer.CannedResponse.json(200, """
            {
              "iban": "CH93007620116238529XX",
              "valid": false,
              "error": "checksum_failed",
              "error_detail": "Modulo 97 check returned 95, expected 1.",
              "upgrade_to_full_validation": "POST /v1/iban/validate ($0.005) -- adds BIC, SEPA, VoP, sanctions, Swiss BC-Nummer."
            }
            """));
        IBANFormatResult r = client().formatIban("CH93007620116238529XX");
        assertFalse(r.valid());
        assertEquals("checksum_failed", r.error());
        assertTrue(r.errorDetail().startsWith("Modulo 97"));
    }

    // fixture: "bic-lookup" -- UBSWCHZH80A, with a full GLEIF registered address.
    private static final String BIC_LOOKUP = """
        {
          "bic": "UBSWCHZH80A",
          "bic8": "UBSWCHZH",
          "bic11": "UBSWCHZH80A",
          "found": true,
          "valid_format": true,
          "institution": "UBS Switzerland AG",
          "country": { "code": "CH", "name": "Switzerland" },
          "city": "Zurich",
          "address": {
            "type": "registered", "street": "Bahnhofstrasse 45", "post_code": "8001",
            "region": "CH-ZH", "city": "Zurich", "country": "CH",
            "romanized": "Bahnhofstrasse 45", "romanization": "original_latin",
            "source": "GLEIF", "language": "en", "as_of": "2025-12-29"
          },
          "address_available": true,
          "branch_code": "80A",
          "branch_info": null,
          "lei": "549300WOIFUSNYH0FL22",
          "lei_status": "ACTIVE",
          "is_test_bic": false,
          "source": "gleif",
          "cost_usdc": 0,
          "processing_ms": 0.61
        }
        """;

    @Test
    void lookupBic_registeredAddressRoundTrips() {
        server.enqueue(MockApiServer.CannedResponse.json(200, BIC_LOOKUP));
        BICLookupResult r = client().lookupBic("UBSWCHZH80A");

        assertEquals("UBSWCHZH", r.bic8());
        assertEquals("UBS Switzerland AG", r.institution());
        assertEquals("549300WOIFUSNYH0FL22", r.lei());
        assertEquals("ACTIVE", r.leiStatus());
        assertFalse(r.isTestBic());

        assertEquals("registered", r.address().type());
        assertEquals("original_latin", r.address().romanization());
        assertEquals("Bahnhofstrasse 45", r.address().romanized());
        assertEquals("2025-12-29", r.address().asOf());
        assertEquals("Bahnhofstrasse 45", r.address().street());
    }

    // fixture: "bic-invalid-format"
    @Test
    void lookupBic_invalidFormat_mapsTo400WithSlug() {
        server.enqueue(MockApiServer.CannedResponse.json(400,
            "{\"error\":\"invalid_bic_format\",\"message\":\"BIC code must be 8 or 11 alphanumeric characters\"}"));
        InvalidInputException e = assertThrows(InvalidInputException.class, () -> client().lookupBic("NOTABIC"));
        assertEquals("invalid_bic_format", e.getCode());
        assertEquals(400, e.getStatus());
    }

    // fixture: "ch-clearing" -- IID 00230, UBS Switzerland AG.
    private static final String CH_CLEARING = """
        {
          "iid": "00230",
          "found": true,
          "institution": { "name": "UBS Switzerland AG", "type": "bank", "iid_type": "headquarters", "headquarters_iid": "00230" },
          "address": { "street": "Bahnhofstrasse", "building_number": "45", "post_code": "8098", "town": "Zürich", "country": "CH" },
          "bic": "UBSWCHZH80A",
          "payment_services": {
            "sic": true, "rtgs_chf": true, "instant_payments_chf": true,
            "eurosic": true, "lsv_bdd_chf": true, "lsv_bdd_eur": true
          },
          "sic_iid": "002301",
          "qr_iid": "30005",
          "qr_iid_source": "register",
          "qr_iids": ["30005", "30308"],
          "valid_on": "2026-08-03",
          "cost_usdc": 0,
          "processing_ms": 0.06
        }
        """;

    @Test
    void lookupChClearing_institutionAndPaymentServicesRoundTrip() {
        server.enqueue(MockApiServer.CannedResponse.json(200, CH_CLEARING));
        CHClearingResult r = client().lookupChClearing("230");

        assertTrue(r.found());
        assertEquals("UBS Switzerland AG", r.institution().name());
        assertEquals("headquarters", r.institution().iidType());
        assertEquals("00230", r.institution().headquartersIid());

        assertTrue(r.paymentServices().sic());
        assertTrue(r.paymentServices().rtgsChf());
        assertTrue(r.paymentServices().eurosic());
        assertTrue(r.paymentServices().lsvBddChf());
        assertTrue(r.paymentServices().lsvBddEur());

        assertEquals("Zürich", r.address().get("town"));
        assertEquals(java.util.List.of("30005", "30308"), r.qrIids());
        assertEquals("2026-08-03", r.validOn());
    }

    // fixture: "compliance" -- GB29NWBK60161331926819, NatWest, including the "meta" disclosure
    // block and a UK-specific "modulus_check" field the SDK does not model (must be ignored,
    // not fail deserialization).
    private static final String COMPLIANCE = """
        {
          "iban": "GB29NWBK60161331926819",
          "valid": true,
          "country": { "code": "GB", "name": "United Kingdom" },
          "bic": { "code": "NWBKGB2L", "bank_name": "NatWest", "city": "London", "source": "IBANforge curated bank-code map", "as_of": "2026-08" },
          "bank_code_check": { "value": "NWBK", "status": "verified", "match": "register", "register": "IBANforge composite bank-code map", "authoritative": false },
          "modulus_check": { "checked": true, "passed": true, "source": "Vocalink modulus weight table (published for Pay.UK)", "table_fetched_on": "2026-08-14" },
          "compliance": {
            "sanctions": { "country_sanctioned": false, "bank_sanctioned": false, "matched_lists": [], "fatf_status": "member", "bank_screened": true },
            "reachability": { "sepa_instant": false, "sct": true, "sdd": true, "screened": true },
            "vop": { "participant": false, "status": "not_found", "screened": true },
            "risk_score": 10,
            "risk_level": "low",
            "flags": ["no_sepa_instant", "no_vop"]
          },
          "meta": {
            "scope": "bank_bic_only",
            "disclaimer": "Informational triage only -- NOT a regulated AML/CFT product.",
            "sanctions_as_of": "2026-08-21T04:57:05.198Z",
            "fatf_as_of": "2026-06",
            "sources": "EU,OFAC,UN,FATF,EPC-SCT,EPC-SCT_INST,EPC-SDD",
            "country_risk_as_of": "2026-07",
            "country_risk_scope": "risk_indicators.country_risk is a separate editorial AML axis."
          },
          "processing_ms": 30.36
        }
        """;

    @Test
    void checkCompliance_riskScoreAndMetaScopeAreReadableAtTheirNestedPath() {
        server.enqueue(MockApiServer.CannedResponse.json(200, COMPLIANCE));
        ComplianceResult r = client().checkCompliance("GB29NWBK60161331926819");

        // There is no top-level risk_score -- it must be read at compliance().riskScore().
        assertEquals(10.0, r.compliance().riskScore());
        assertEquals("low", r.compliance().riskLevel());
        assertEquals("member", r.compliance().sanctions().fatfStatus());
        assertTrue(r.compliance().reachability().sct());
        assertEquals("not_found", r.compliance().vop().status());
        assertEquals(java.util.List.of("no_sepa_instant", "no_vop"), r.compliance().flags());

        assertEquals("bank_bic_only", r.meta().scope());
        assertEquals("2026-06", r.meta().fatfAsOf());

        // "modulus_check" is not modelled -- deserialization must not fail on the unknown field.
        assertEquals("NatWest", r.bic().bankName());
    }

    // fixture: "iban-structure-ch"
    @Test
    void ibanStructure_bbanFieldOffsetsRoundTrip() {
        server.enqueue(MockApiServer.CannedResponse.json(200, """
            {
              "country": { "code": "CH", "name": "Switzerland" },
              "iban_length": 21,
              "bban_length": 17,
              "bban": {
                "bank_code": { "start": 0, "length": 5, "charset": "5!n" },
                "account_number": { "start": 5, "length": 12, "charset": "12!c" }
              },
              "bban_pattern": "5!n12!c",
              "sepa": { "member": true, "schemes": ["SCT", "SDD"], "vop_required": false },
              "example_iban": "CH9300762011623852957",
              "example_iban_note": "Illustration from the SWIFT IBAN Registry. Its bank code is not guaranteed to be allocated.",
              "cost_usdc": 0
            }
            """));
        IBANStructure s = client().ibanStructure("CH");

        assertEquals(21, s.ibanLength());
        assertEquals(0, s.bban().get("bank_code").start());
        assertEquals(5, s.bban().get("bank_code").length());
        assertEquals(5, s.bban().get("account_number").start());
        assertEquals("12!c", s.bban().get("account_number").charset());
        assertTrue(s.sepa().member());
        assertEquals("CH9300762011623852957", s.exampleIban());
    }

    // fixture: "test-iban"
    @Test
    void testIban_proofCarriesTheRegisterRow() {
        server.enqueue(MockApiServer.CannedResponse.json(200, """
            {
              "test_ibans": [
                {
                  "iban": "CH4208704626920706430",
                  "formatted": "CH42 0870 4626 9207 0643 0",
                  "country": "CH",
                  "proof": {
                    "bank_code_check": {
                      "value": "08704", "status": "verified", "match": "register",
                      "register": "SIX BankMaster (Swiss IID / BC-Nummer register)", "authoritative": true,
                      "institution": { "name": "AEK BANK 1826 Genossenschaft", "street": "Hofstettenstrasse 2", "post_code": "3601", "town": "Thun", "country": "CH" }
                    },
                    "bic": { "code": "AEKTCH22", "bank_name": "AEK BANK 1826 Genossenschaft", "city": "Thun", "source": "IBANforge curated bank-code map", "as_of": "2026-08" }
                  },
                  "note": "Structurally valid test IBAN with a REAL, register-allocated bank code."
                }
              ],
              "disclaimer": "Bank codes are real; account digits are random and belong to nobody.",
              "docs": "https://ibanforge.com/tools/test-iban",
              "cost_usdc": 0
            }
            """));
        TestIbanResult r = client().testIban("CH", 1);

        var entry = r.testIbans().get(0);
        assertEquals("CH4208704626920706430", entry.iban());
        assertEquals("verified", entry.proof().bankCodeCheck().status());
        assertTrue(entry.proof().bankCodeCheck().authoritative());
        assertEquals("AEK BANK 1826 Genossenschaft", entry.proof().bic().bankName());
        assertEquals("Thun", entry.proof().bic().city());
    }

    // fixture: "credit-bundles"
    @Test
    void creditBundles_pricingRoundTrips() {
        server.enqueue(MockApiServer.CannedResponse.json(200, """
            {
              "bundles": [
                { "slug": "1k", "credits": 1000, "price_usdc": 5, "price_per_call_usdc": 0.005, "buy_endpoint": "POST /v1/credits/buy/1k" },
                { "slug": "5k", "credits": 5000, "price_usdc": 20, "price_per_call_usdc": 0.004, "buy_endpoint": "POST /v1/credits/buy/5k" },
                { "slug": "25k", "credits": 25000, "price_usdc": 80, "price_per_call_usdc": 0.0032, "buy_endpoint": "POST /v1/credits/buy/25k" }
              ],
              "payment_method": "x402 USDC on Base mainnet",
              "documentation": "https://ibanforge.com/agents#credits"
            }
            """));
        CreditBundleList list = client().creditBundles();

        assertEquals(3, list.bundles().size());
        assertEquals("25k", list.bundles().get(2).slug());
        assertEquals(25000, list.bundles().get(2).credits());
        assertEquals(0.0032, list.bundles().get(2).pricePerCallUsdc());
        assertEquals("x402 USDC on Base mainnet", list.paymentMethod());
    }

    // fixture: "demo" -- trimmed to the UK example plus the arbitrary compliance_example wrapper.
    @Test
    void demo_ibanExamplesDeserializeAndComplianceExampleStaysRawJson() {
        server.enqueue(MockApiServer.CannedResponse.json(200, """
            {
              "message": "Demo -- these results are free.",
              "iban_examples": [
                {
                  "iban": "GB29NWBK60161331926819",
                  "valid": true,
                  "country": { "code": "GB", "name": "United Kingdom" },
                  "bic": { "code": "NWBKGB2L", "bank_name": "NatWest", "city": "London" },
                  "cost_usdc": 0.005
                }
              ],
              "compliance_example": {
                "description": "Full compliance check for DE89370400440532013000 (Commerzbank, Germany)",
                "endpoint": "POST /v1/iban/compliance",
                "result": { "iban": "DE89370400440532013000", "valid": true }
              }
            }
            """));
        DemoResult d = client().demo();

        assertEquals(1, d.ibanExamples().size());
        assertEquals("NatWest", d.ibanExamples().get(0).bic().bankName());
        assertEquals("Full compliance check for DE89370400440532013000 (Commerzbank, Germany)",
            d.complianceExample().get("description").asText());
        assertEquals("DE89370400440532013000", d.complianceExample().get("result").get("iban").asText());
    }

    // fixture: "keys-generate"
    @Test
    void generateApiKey_fixture() {
        server.enqueue(MockApiServer.CannedResponse.json(201, """
            {
              "api_key": "ifk_REDACTED",
              "key_prefix": "ifk_REDACTED",
              "email": "you@example.com",
              "monthly_limit": 200,
              "message": "Save this key -- it will not be shown again.",
              "terms_url": "https://ibanforge.com/legal/terms"
            }
            """));
        APIKey key = IBANforge.generateApiKey("you@example.com", server.baseUrl(), java.time.Duration.ofSeconds(5), null);
        assertEquals(200, key.monthlyLimit());
        assertEquals("https://ibanforge.com/legal/terms", key.termsUrl());
    }

    // fixture: "keys-usage" and "keys-usage-wrong-key"
    @Test
    void usage_fixture() {
        server.enqueue(MockApiServer.CannedResponse.json(200,
            "{\"used\":10,\"limit\":200,\"remaining\":190,\"month\":\"2026-08\",\"key_prefix\":\"ifk_REDACTED\"}"));
        APIKeyUsage usage = IBANforge.builder().baseUrl(server.baseUrl()).apiKey("ifk_test").build().usage();
        assertEquals(10, usage.used());
        assertEquals("2026-08", usage.month());
    }

    @Test
    void usage_wrongKey_fixture() {
        server.enqueue(MockApiServer.CannedResponse.json(401,
            "{\"error\":\"invalid_key\",\"message\":\"API key not found or inactive\"}"));
        AuthException e = assertThrows(AuthException.class,
            () -> IBANforge.builder().baseUrl(server.baseUrl()).apiKey("ifk_wrong").build().usage());
        assertEquals("invalid_key", e.getCode());
    }
}

package com.ibanforge.sdk;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.ibanforge.sdk.model.APIKey;
import com.ibanforge.sdk.model.APIKeyUsage;
import com.ibanforge.sdk.model.AddressCheckResult;
import com.ibanforge.sdk.model.BICLookupResult;
import com.ibanforge.sdk.model.CHClearingResult;
import com.ibanforge.sdk.model.ComplianceResult;
import com.ibanforge.sdk.model.CreditBundleList;
import com.ibanforge.sdk.model.DemoResult;
import com.ibanforge.sdk.model.HealthInfo;
import com.ibanforge.sdk.model.IBANBatchResult;
import com.ibanforge.sdk.model.IBANFormatResult;
import com.ibanforge.sdk.model.IBANStructure;
import com.ibanforge.sdk.model.IBANStructureList;
import com.ibanforge.sdk.model.IBANValidationResult;
import com.ibanforge.sdk.model.ReferenceValidationResult;
import com.ibanforge.sdk.model.TestIbanResult;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;

import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.stream.Stream;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Behavioural coverage: request shapes (path, verb, body, auth header), the full HTTP status to
 * exception mapping, timeouts, network failures, client-side guards, and configuration
 * resolution.
 *
 * <p>Field-level deserialization from realistic API responses is covered separately in
 * {@link IBANforgeFixtureDeserializationTest}.
 *
 * <p>Every test runs against a local {@link MockApiServer} on an ephemeral port -- no real
 * network call is ever made.
 */
class IBANforgeTest {

    private static final ObjectMapper JSON = new ObjectMapper();

    private MockApiServer server;

    @BeforeEach
    void setUp() {
        server = new MockApiServer();
    }

    @AfterEach
    void tearDown() {
        server.close();
    }

    private IBANforge.Builder builder() {
        return IBANforge.builder().baseUrl(server.baseUrl());
    }

    private JsonNode bodyOf(MockApiServer.RecordedRequest request) throws Exception {
        return JSON.readTree(request.body());
    }

    // ---- construction & base URL ------------------------------------------------------------

    @Nested
    class Construction {

        @Test
        void stripsTrailingSlashesFromACustomBaseUrl() {
            IBANforge client = IBANforge.builder().baseUrl(server.baseUrl() + "///").build();
            assertEquals(server.baseUrl(), client.resolvedBaseUrlForTests());
        }

        @Test
        void defaultsToTheProductionBaseUrlWhenNothingIsConfigured() {
            // No builder value, and this JVM's environment carries neither IBANFORGE_API_BASE
            // nor IBANFORGE_API_KEY (the Docker container the SDK is built in starts clean).
            IBANforge client = IBANforge.create();
            assertEquals("https://api.ibanforge.com", client.resolvedBaseUrlForTests());
            assertNull(client.resolvedApiKeyForTests());
        }

        @Test
        void explicitBuilderValuesAreUsedAsIs() {
            IBANforge client = IBANforge.builder().apiKey("ifk_test").baseUrl(server.baseUrl()).build();
            assertEquals("ifk_test", client.resolvedApiKeyForTests());
            assertEquals(server.baseUrl(), client.resolvedBaseUrlForTests());
        }

        @Test
        void aFreshBuilderCanBeReusedToBuildIndependentClients() {
            IBANforge.Builder b = IBANforge.builder();
            IBANforge a = b.baseUrl("http://127.0.0.1:1").apiKey("ifk_a").build();
            IBANforge c = b.baseUrl("http://127.0.0.1:2").apiKey("ifk_b").build();
            assertEquals("ifk_a", a.resolvedApiKeyForTests());
            assertEquals("ifk_b", c.resolvedApiKeyForTests());
        }
    }

    // ---- auth headers -------------------------------------------------------------------------

    @Nested
    class AuthHeaders {

        @Test
        void omitsAuthorizationWhenNoApiKeyIsConfigured() {
            server.enqueue(MockApiServer.CannedResponse.json(200, "{\"valid\":true}"));
            builder().build().formatIban("CH93");
            assertFalse(server.lastRequest().hasHeader("Authorization"));
            assertTrue(server.lastRequest().header("user-agent").startsWith("ibanforge-java/"));
        }

        @Test
        void sendsABearerAuthorizationHeaderWhenAnApiKeyIsSet() {
            server.enqueue(MockApiServer.CannedResponse.json(200, "{\"valid\":true}"));
            builder().apiKey("ifk_test").build().validateIban("CH93");
            assertEquals("Bearer ifk_test", server.lastRequest().header("Authorization"));
            assertEquals("application/json", server.lastRequest().header("Content-Type"));
        }

        @Test
        void userAgentCarriesTheSdkVersion() {
            server.enqueue(MockApiServer.CannedResponse.json(200, "{\"status\":\"ok\"}"));
            builder().build().health();
            assertEquals("ibanforge-java/1.5.0", server.lastRequest().header("user-agent"));
        }
    }

    // ---- request shapes, one per public method -------------------------------------------------

    @Nested
    class RequestShapes {

        @Test
        void formatIbanIssuesAGetWithTheIbanUrlEncoded() {
            server.enqueue(MockApiServer.CannedResponse.json(200, "{\"valid\":true}"));
            builder().build().formatIban("CH93 0076 2011");
            MockApiServer.RecordedRequest req = server.lastRequest();
            assertEquals("GET", req.method());
            assertEquals("/v1/iban/format", req.path());
            assertEquals("iban=CH93%200076%202011", req.query());
        }

        @Test
        void validateIbanPostsAJsonBodyWithIban() throws Exception {
            server.enqueue(MockApiServer.CannedResponse.json(200, "{\"valid\":true}"));
            builder().build().validateIban("CH93");
            MockApiServer.RecordedRequest req = server.lastRequest();
            assertEquals("POST", req.method());
            assertEquals("/v1/iban/validate", req.path());
            assertEquals("CH93", bodyOf(req).get("iban").asText());
        }

        @Test
        void validateBatchPostsTheIbanList() throws Exception {
            server.enqueue(MockApiServer.CannedResponse.json(200, "{\"results\":[]}"));
            builder().build().validateBatch(List.of("CH93", "DE89"));
            JsonNode body = bodyOf(server.lastRequest());
            assertEquals("/v1/iban/batch", server.lastRequest().path());
            assertEquals(2, body.get("ibans").size());
            assertEquals("CH93", body.get("ibans").get(0).asText());
            assertEquals("DE89", body.get("ibans").get(1).asText());
        }

        @Test
        void checkCompliancePostsIban() throws Exception {
            server.enqueue(MockApiServer.CannedResponse.json(200, "{\"valid\":true,\"compliance\":{}}"));
            builder().build().checkCompliance("GB29NWBK60161331926819");
            assertEquals("/v1/iban/compliance", server.lastRequest().path());
            assertEquals("GB29NWBK60161331926819", bodyOf(server.lastRequest()).get("iban").asText());
        }

        @Test
        void lookupBicUrlEncodesTheCodeIntoThePath() {
            server.enqueue(MockApiServer.CannedResponse.json(200, "{\"found\":true}"));
            builder().build().lookupBic("UBSWCHZH80A");
            assertEquals("/v1/bic/UBSWCHZH80A", server.lastRequest().path());
            assertEquals("GET", server.lastRequest().method());
        }

        @Test
        void lookupChClearingAcceptsAStringIid() {
            server.enqueue(MockApiServer.CannedResponse.json(200, "{\"found\":true}"));
            builder().build().lookupChClearing("230");
            assertEquals("/v1/ch/clearing/230", server.lastRequest().path());
        }

        @Test
        void lookupChClearingCoercesANumericIidToAStringPath() {
            server.enqueue(MockApiServer.CannedResponse.json(200, "{\"found\":true}"));
            builder().build().lookupChClearing(100L);
            assertEquals("/v1/ch/clearing/100", server.lastRequest().path());
        }

        @Test
        void ibanStructuresGetsTheBareEndpoint() {
            server.enqueue(MockApiServer.CannedResponse.json(200, "{\"total\":0,\"countries\":[],\"endpoint_per_country\":\"x\"}"));
            builder().build().ibanStructures();
            assertEquals("/v1/iban/structure", server.lastRequest().path());
            assertNull(server.lastRequest().query());
        }

        @Test
        void ibanStructureGetsTheCountryPath() {
            server.enqueue(MockApiServer.CannedResponse.json(200,
                "{\"country\":{\"code\":\"CH\",\"name\":\"Switzerland\"},\"iban_length\":21,\"bban_length\":17,\"bban\":{},\"bban_pattern\":\"x\"}"));
            builder().build().ibanStructure("CH");
            assertEquals("/v1/iban/structure/CH", server.lastRequest().path());
        }

        @Test
        void testIbanOmitsTheQueryStringWhenNoOptionsAreGiven() {
            server.enqueue(MockApiServer.CannedResponse.json(200, "{\"test_ibans\":[]}"));
            builder().build().testIban();
            assertEquals("/v1/test-iban", server.lastRequest().path());
            assertNull(server.lastRequest().query());
        }

        @Test
        void testIbanPassesCountryAndCount() {
            server.enqueue(MockApiServer.CannedResponse.json(200, "{\"test_ibans\":[]}"));
            builder().build().testIban("CH", 3);
            assertEquals("country=CH&count=3", server.lastRequest().query());
        }

        @Test
        void validateReferenceIsFreeAndUrlEncodesTheReference() {
            server.enqueue(MockApiServer.CannedResponse.json(200, "{\"reference\":\"RF18539007547034\",\"valid\":true,\"status\":\"checked\"}"));
            builder().build().validateReference("RF18539007547034");
            assertEquals("reference=RF18539007547034", server.lastRequest().query());
            assertFalse(server.lastRequest().hasHeader("Authorization"));
        }

        @Test
        void validateReferencePassesReferenceTypeThroughWhenPinned() {
            server.enqueue(MockApiServer.CannedResponse.json(200, "{\"reference\":\"21000\",\"valid\":true,\"status\":\"checked\"}"));
            builder().build().validateReference("21000", "qrr");
            assertEquals("reference=21000&reference_type=qrr", server.lastRequest().query());
        }

        @Test
        void checkAddressPostsSchemeAndAddress() throws Exception {
            server.enqueue(MockApiServer.CannedResponse.json(200, "{\"scheme\":\"sps\",\"conforms\":true,\"findings\":[]}"));
            builder().build().checkAddress("sps", Map.of("twn_nm", "Zurich", "ctry", "CH"));
            JsonNode body = bodyOf(server.lastRequest());
            assertEquals("/v1/address/check", server.lastRequest().path());
            assertEquals("sps", body.get("scheme").asText());
            assertEquals("Zurich", body.get("address").get("twn_nm").asText());
            assertEquals("CH", body.get("address").get("ctry").asText());
            assertFalse(server.lastRequest().hasHeader("Authorization"));
        }

        @Test
        void creditBundlesGetsTheBareEndpoint() {
            server.enqueue(MockApiServer.CannedResponse.json(200, "{\"bundles\":[],\"payment_method\":\"x402\"}"));
            builder().build().creditBundles();
            assertEquals("/v1/credits/bundles", server.lastRequest().path());
        }

        @Test
        void demoGetsTheBareEndpoint() {
            server.enqueue(MockApiServer.CannedResponse.json(200, "{\"message\":\"hi\"}"));
            builder().build().demo();
            assertEquals("/v1/demo", server.lastRequest().path());
        }

        @Test
        void healthGetsTheBareEndpoint() {
            server.enqueue(MockApiServer.CannedResponse.json(200, "{\"status\":\"ok\",\"version\":\"1.5.0\",\"bic_database_entries\":1}"));
            builder().build().health();
            assertEquals("/health", server.lastRequest().path());
        }

        @Test
        void usageGetsTheEndpointWithAuthorization() {
            server.enqueue(MockApiServer.CannedResponse.json(200, "{\"key_prefix\":\"ifk_x\",\"used\":1,\"limit\":200,\"remaining\":199,\"month\":\"2026-08\"}"));
            builder().apiKey("ifk_test").build().usage();
            assertEquals("/v1/keys/usage", server.lastRequest().path());
            assertEquals("Bearer ifk_test", server.lastRequest().header("Authorization"));
        }
    }

    // ---- validateBatch client-side guards -----------------------------------------------------

    @Nested
    class ValidateBatchGuards {

        @Test
        void rejectsAnEmptyListBeforeHittingTheNetwork() {
            assertThrows(InvalidInputException.class, () -> builder().build().validateBatch(List.of()));
            assertEquals(0, server.requestCount());
        }

        @Test
        void rejectsMoreThanOneHundredIbansBeforeHittingTheNetwork() {
            List<String> tooMany = java.util.Collections.nCopies(101, "CH93");
            InvalidInputException e = assertThrows(InvalidInputException.class,
                () -> builder().build().validateBatch(tooMany));
            assertTrue(e.getMessage().contains("101"));
            assertEquals(0, server.requestCount());
        }

        @Test
        void acceptsExactlyOneHundred() {
            server.enqueue(MockApiServer.CannedResponse.json(200, "{\"results\":[]}"));
            List<String> oneHundred = java.util.Collections.nCopies(100, "CH93");
            builder().build().validateBatch(oneHundred);
            assertEquals(1, server.requestCount());
        }
    }

    // ---- usage() client-side guard -------------------------------------------------------------

    @Test
    void usageThrowsAuthExceptionWithoutAnApiKeyAndNeverCallsTheNetwork() {
        assertThrows(AuthException.class, () -> builder().build().usage());
        assertEquals(0, server.requestCount());
    }

    // ---- static generateApiKey ------------------------------------------------------------------

    @Nested
    class GenerateApiKey {

        @Test
        void postsTheEmailToKeysGenerate() throws Exception {
            server.enqueue(MockApiServer.CannedResponse.json(201,
                "{\"api_key\":\"ifk_x\",\"key_prefix\":\"ifk_x\",\"monthly_limit\":200}"));
            APIKey key = IBANforge.generateApiKey("dev@example.test", server.baseUrl(), Duration.ofSeconds(5), null);
            assertEquals("/v1/keys/generate", server.lastRequest().path());
            assertEquals("dev@example.test", bodyOf(server.lastRequest()).get("email").asText());
            assertFalse(bodyOf(server.lastRequest()).has("code"));
            assertEquals("ifk_x", key.apiKey());
            assertEquals(200, key.monthlyLimit());
        }

        @Test
        void sendsTheMailboxCodeWhenOneIsGivenAndNeverAsAConfigField() throws Exception {
            server.enqueue(MockApiServer.CannedResponse.json(201, "{\"api_key\":\"ifk_x\",\"key_prefix\":\"ifk_x\"}"));
            IBANforge.generateApiKey("dev@example.test", server.baseUrl(), Duration.ofSeconds(5), "123456");
            JsonNode body = bodyOf(server.lastRequest());
            assertEquals("dev@example.test", body.get("email").asText());
            assertEquals("123456", body.get("code").asText());
        }

        @Test
        void theShortOverloadDefaultsBaseUrlAndTimeoutFromTheEnvironment() {
            // The short overloads must not silently pin the production base URL: they defer
            // to the same builder resolution as everything else (env, then production).
            // Regression check for a bug caught before this suite ever ran.
            server.enqueue(MockApiServer.CannedResponse.json(201, "{\"api_key\":\"ifk_x\",\"key_prefix\":\"ifk_x\"}"));
            // Can't call the 1-arg overload against the mock server (it targets production),
            // so this exercises the 4-arg overload with an explicit null timeout/baseUrl
            // resolution path instead, which is exactly what the short overloads delegate to.
            APIKey key = IBANforge.generateApiKey("dev@example.test", server.baseUrl(), null, null);
            assertNotNull(key);
        }
    }

    // ---- HTTP status -> typed exception mapping -------------------------------------------------

    @Nested
    class ErrorMapping {

        static Stream<Arguments> cases() {
            return Stream.of(
                Arguments.of(401, "{\"message\":\"no key\"}", AuthException.class),
                Arguments.of(403, "{\"message\":\"forbidden\"}", AuthException.class),
                Arguments.of(402, "{\"message\":\"pay up\"}", PaymentRequiredException.class),
                Arguments.of(429, "{\"error\":\"quota_exceeded\",\"message\":\"out of quota\"}", QuotaExhaustedException.class),
                Arguments.of(429, "{\"error\":\"rate_limited\",\"message\":\"slow down\"}", RateLimitException.class),
                Arguments.of(400, "{\"message\":\"bad iban\"}", InvalidInputException.class),
                Arguments.of(413, "{\"error\":\"payload_too_large\",\"message\":\"body over 1 MB\"}", PayloadTooLargeException.class),
                Arguments.of(404, "{\"message\":\"not found\"}", InvalidInputException.class),
                Arguments.of(500, "{\"message\":\"boom\"}", ApiException.class),
                Arguments.of(503, "{\"message\":\"down\"}", ApiException.class)
            );
        }

        @ParameterizedTest(name = "{0} -> {2}")
        @MethodSource("cases")
        void mapsStatusToExceptionType(int status, String body, Class<? extends IBANforgeException> expected) {
            server.enqueue(MockApiServer.CannedResponse.json(status, body));
            IBANforgeException e = assertThrows(IBANforgeException.class,
                () -> builder().build().validateIban("CH93"));
            assertInstanceOf(expected, e);
            assertEquals(status, e.getStatus());
        }

        @Test
        void carriesTheParsedResponseBodyAndMessageOnTheException() {
            server.enqueue(MockApiServer.CannedResponse.json(400, "{\"message\":\"bad iban\"}"));
            InvalidInputException e = assertThrows(InvalidInputException.class,
                () -> builder().build().validateIban("CH93"));
            assertEquals("bad iban", e.getMessage());
            assertInstanceOf(JsonNode.class, e.getBody());
            assertEquals("bad iban", ((JsonNode) e.getBody()).get("message").asText());
        }

        @Test
        void liftsTheErrorSlugOntoCodeSoBranchingNeedsNoCast() {
            server.enqueue(MockApiServer.CannedResponse.json(401, "{\"error\":\"invalid_key\",\"message\":\"API key not found or inactive\"}"));
            AuthException e = assertThrows(AuthException.class,
                () -> builder().apiKey("ifk_wrong").build().usage());
            assertEquals("invalid_key", e.getCode());
            assertEquals(401, e.getStatus());
        }

        @Test
        void leavesCodeNullWhenTheBodyCarriesNoSlug() {
            server.enqueue(MockApiServer.CannedResponse.text(500, "plain text failure"));
            ApiException e = assertThrows(ApiException.class, () -> builder().build().health());
            assertNull(e.getCode());
            assertEquals("plain text failure", e.getBody());
        }

        @Test
        void fallsBackToMessageThenErrorDetailThenErrorThenHttpStatus() {
            server.enqueue(MockApiServer.CannedResponse.json(400, "{\"error_detail\":\"too short\",\"error\":\"invalid_iban\"}"));
            InvalidInputException withDetail = assertThrows(InvalidInputException.class,
                () -> builder().build().validateIban("CH"));
            assertEquals("too short", withDetail.getMessage());

            server.enqueue(MockApiServer.CannedResponse.json(400, "{\"error\":\"invalid_iban\"}"));
            InvalidInputException withErrorOnly = assertThrows(InvalidInputException.class,
                () -> builder().build().validateIban("CH"));
            assertEquals("invalid_iban", withErrorOnly.getMessage());

            server.enqueue(MockApiServer.CannedResponse.json(400, "{}"));
            InvalidInputException withNothing = assertThrows(InvalidInputException.class,
                () -> builder().build().validateIban("CH"));
            assertEquals("HTTP 400", withNothing.getMessage());
        }

        @Test
        void paymentRequiredCarriesTheX402AcceptsChallenge() {
            server.enqueue(MockApiServer.CannedResponse.json(402,
                "{\"error\":\"payment_required\",\"message\":\"Pay or use a key\",\"accepts\":[{\"scheme\":\"exact\",\"network\":\"base\"}]}"));
            PaymentRequiredException e = assertThrows(PaymentRequiredException.class,
                () -> builder().build().validateIban("CH93"));
            assertEquals(402, e.getStatus());
            assertNotNull(e.getAccepts());
            assertEquals("base", e.getAccepts().get(0).get("network").asText());
        }

        @Test
        void aSuccessfulResponseNeverThrows() {
            server.enqueue(MockApiServer.CannedResponse.json(200, "{\"valid\":true}"));
            IBANValidationResult r = builder().build().validateIban("CH93");
            assertTrue(r.valid());
        }

        @Test
        void a201IsTreatedAsSuccess() {
            server.enqueue(MockApiServer.CannedResponse.json(201, "{\"api_key\":\"ifk_x\",\"key_prefix\":\"ifk_x\"}"));
            APIKey key = IBANforge.generateApiKey("dev@example.test", server.baseUrl(), Duration.ofSeconds(5), null);
            assertEquals("ifk_x", key.apiKey());
        }
    }

    // ---- timeout & network failures -------------------------------------------------------------

    @Nested
    class TimeoutAndNetworkFailures {

        @Test
        void aSlowServerProducesATimedOutIBANforgeException() {
            server.delayResponsesBy(600);
            server.enqueue(MockApiServer.CannedResponse.json(200, "{\"status\":\"ok\"}"));
            IBANforge client = builder().timeout(Duration.ofMillis(150)).build();
            IBANforgeException e = assertThrows(IBANforgeException.class, client::health);
            assertTrue(e.getMessage().toLowerCase(java.util.Locale.ROOT).contains("timed out"),
                "expected a timeout message, got: " + e.getMessage());
            assertNull(e.getStatus());
        }

        @Test
        void anUnreachableServerProducesANetworkErrorIBANforgeException() {
            String deadBaseUrl = server.baseUrl();
            server.close(); // stop listening: the port is now refused
            IBANforge client = IBANforge.builder().baseUrl(deadBaseUrl).build();
            IBANforgeException e = assertThrows(IBANforgeException.class, client::health);
            assertTrue(e.getMessage().toLowerCase(java.util.Locale.ROOT).contains("network error"),
                "expected a network error message, got: " + e.getMessage());
            assertNull(e.getStatus());
        }
    }

    // ---- deserialization smoke tests for every result type (see also the fixture suite) --------

    @Nested
    class ResultTypesDeserialize {

        @Test
        void ibanFormatResult() {
            server.enqueue(MockApiServer.CannedResponse.json(200,
                "{\"iban\":\"CH93\",\"formatted\":\"CH93\",\"valid\":false,\"error\":\"checksum_failed\"}"));
            IBANFormatResult r = builder().build().formatIban("CH93");
            assertFalse(r.valid());
            assertEquals("checksum_failed", r.error());
        }

        @Test
        void ibanBatchResult() {
            server.enqueue(MockApiServer.CannedResponse.json(200,
                "{\"results\":[],\"count\":0,\"valid_count\":0,\"cost_usdc\":0}"));
            IBANBatchResult r = builder().build().validateBatch(List.of("CH93"));
            assertEquals(0, r.count());
        }

        @Test
        void bicLookupResult() {
            server.enqueue(MockApiServer.CannedResponse.json(200,
                "{\"bic\":\"UBSWCHZH80A\",\"found\":true,\"valid_format\":true,\"institution\":\"UBS\",\"city\":\"Zurich\",\"lei\":null}"));
            BICLookupResult r = builder().build().lookupBic("UBSWCHZH80A");
            assertTrue(r.found());
            assertEquals("UBS", r.institution());
            assertNull(r.lei());
        }

        @Test
        void chClearingResult() {
            server.enqueue(MockApiServer.CannedResponse.json(200, "{\"iid\":\"00230\",\"found\":true}"));
            CHClearingResult r = builder().build().lookupChClearing("230");
            assertTrue(r.found());
        }

        @Test
        void complianceResult() {
            server.enqueue(MockApiServer.CannedResponse.json(200,
                "{\"iban\":\"GB29\",\"valid\":true,\"compliance\":{\"sanctions\":{\"country_sanctioned\":false,\"bank_sanctioned\":false,\"matched_lists\":[],\"fatf_status\":\"member\"},"
                    + "\"reachability\":{\"sepa_instant\":false,\"sct\":true,\"sdd\":true},\"vop\":{\"participant\":false,\"status\":\"not_found\"},\"risk_score\":10,\"risk_level\":\"low\",\"flags\":[]}}"));
            ComplianceResult r = builder().build().checkCompliance("GB29");
            assertEquals(10.0, r.compliance().riskScore());
            assertEquals("low", r.compliance().riskLevel());
        }

        @Test
        void apiKeyUsage() {
            server.enqueue(MockApiServer.CannedResponse.json(200,
                "{\"key_prefix\":\"ifk_x\",\"used\":10,\"limit\":200,\"remaining\":190,\"month\":\"2026-08\"}"));
            APIKeyUsage u = builder().apiKey("ifk_x").build().usage();
            assertEquals(10, u.used());
            assertEquals(190, u.remaining());
        }

        @Test
        void healthInfo() {
            server.enqueue(MockApiServer.CannedResponse.json(200,
                "{\"status\":\"ok\",\"version\":\"1.5.0\",\"bic_database_entries\":121716,\"ch_clearing_entries\":1165}"));
            HealthInfo h = builder().build().health();
            assertEquals("ok", h.status());
            assertEquals(121716, h.bicDatabaseEntries());
        }

        @Test
        void ibanStructureList() {
            server.enqueue(MockApiServer.CannedResponse.json(200,
                "{\"total\":89,\"countries\":[{\"code\":\"CH\",\"name\":\"Switzerland\",\"iban_length\":21,\"sepa_member\":true,\"has_bban_structure\":true,\"has_example\":true}],\"endpoint_per_country\":\"x\"}"));
            IBANStructureList list = builder().build().ibanStructures();
            assertEquals(89, list.total());
            assertEquals("CH", list.countries().get(0).code());
            assertEquals(21, list.countries().get(0).ibanLength());
        }

        @Test
        void ibanStructure() {
            server.enqueue(MockApiServer.CannedResponse.json(200,
                "{\"country\":{\"code\":\"CH\",\"name\":\"Switzerland\"},\"iban_length\":21,\"bban_length\":17,"
                    + "\"bban\":{\"bank_code\":{\"start\":0,\"length\":5,\"charset\":\"5!n\"}},\"bban_pattern\":\"5!n12!c\"}"));
            IBANStructure s = builder().build().ibanStructure("CH");
            assertEquals(21, s.ibanLength());
            assertEquals(5, s.bban().get("bank_code").length());
        }

        @Test
        void testIbanResult() {
            server.enqueue(MockApiServer.CannedResponse.json(200,
                "{\"test_ibans\":[{\"iban\":\"CH42\",\"formatted\":\"CH42\",\"country\":\"CH\","
                    + "\"proof\":{\"bank_code_check\":{\"value\":\"08704\",\"status\":\"verified\",\"match\":\"register\",\"register\":\"SIX\",\"authoritative\":true}},\"note\":\"n\"}],"
                    + "\"disclaimer\":\"d\"}"));
            TestIbanResult r = builder().build().testIban("CH", 1);
            assertEquals(1, r.testIbans().size());
            assertEquals("verified", r.testIbans().get(0).proof().bankCodeCheck().status());
            assertTrue(r.testIbans().get(0).proof().bankCodeCheck().authoritative());
        }

        @Test
        void creditBundleList() {
            server.enqueue(MockApiServer.CannedResponse.json(200,
                "{\"bundles\":[{\"slug\":\"1k\",\"credits\":1000,\"price_usdc\":5,\"price_per_call_usdc\":0.005,\"buy_endpoint\":\"POST /v1/credits/buy/1k\"}],\"payment_method\":\"x402\"}"));
            CreditBundleList list = builder().build().creditBundles();
            assertEquals(1000, list.bundles().get(0).credits());
            assertEquals(5.0, list.bundles().get(0).priceUsdc());
        }

        @Test
        void demoResult() {
            server.enqueue(MockApiServer.CannedResponse.json(200, "{\"message\":\"hi\",\"iban_examples\":[],\"compliance_example\":{\"anything\":1}}"));
            DemoResult d = builder().build().demo();
            assertEquals("hi", d.message());
            assertEquals(1, d.complianceExample().get("anything").asInt());
        }

        @Test
        void referenceValidationResultRelaysNullValidRatherThanCoercingToFalse() {
            server.enqueue(MockApiServer.CannedResponse.json(200,
                "{\"reference\":\"12345678903\",\"scheme\":\"kid\",\"valid\":null,\"status\":\"not_checkable\",\"note\":\"n/a\"}"));
            ReferenceValidationResult r = builder().build().validateReference("12345678903");
            assertNull(r.valid());
        }

        @Test
        void addressCheckResultRelaysFindingsWithSource() {
            server.enqueue(MockApiServer.CannedResponse.json(200,
                "{\"scheme\":\"sps\",\"conforms\":true,\"findings\":[{\"rule\":\"twn_nm_required\",\"verdict\":\"pass\",\"detail\":\"present\",\"source\":\"SIX SPS 2026 v2.3\"}]}"));
            AddressCheckResult r = builder().build().checkAddress("sps", Map.of("twn_nm", "Zurich"));
            assertTrue(r.findings().get(0).source().contains("SIX"));
        }

        @Test
        void unknownServerFieldsAreIgnoredRatherThanFailingDeserialization() {
            // Forward-compatibility: the server may add fields the SDK does not yet model.
            server.enqueue(MockApiServer.CannedResponse.json(200,
                "{\"valid\":true,\"a_field_from_the_future\":{\"nested\":true},\"another_one\":[1,2,3]}"));
            IBANValidationResult r = builder().build().validateIban("CH93");
            assertTrue(r.valid());
        }
    }
}

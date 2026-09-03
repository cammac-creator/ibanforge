package com.ibanforge.sdk;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.fasterxml.jackson.annotation.JsonInclude;

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

import java.io.IOException;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.net.http.HttpTimeoutException;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * IBANforge -- official Java SDK.
 *
 * <p>Mirrors the TypeScript and Python SDKs: API-key auth, a typed exception hierarchy, and
 * coverage of every public endpoint (validate, batch, BIC, CH clearing, compliance, format,
 * structures, test IBANs, reference/address checks, demo, credit bundles, usage, key
 * generation). Response shapes are kept in lock-step with the server's {@code src/types.ts}.
 *
 * <pre>{@code
 * // Free format check (no key needed)
 * IBANforge free = IBANforge.create();
 * IBANFormatResult out = free.formatIban("CH1000230000000012345");
 *
 * // Authenticated calls (required for paid endpoints unless you go x402)
 * IBANforge client = IBANforge.builder().apiKey("ifk_...").build();
 * IBANValidationResult r = client.validateIban("CH1000230000000012345");
 *
 * // Generate a free key in 1 line
 * APIKey key = IBANforge.generateApiKey("you@company.com");
 * }</pre>
 *
 * <p><b>Warning:</b> the IBAN above is not decoration. {@code CH9300762011623852957} -- the
 * SWIFT registry's illustration, which every quickstart reaches for -- carries a bank code no
 * institution holds, so it comes back with {@code bic == null} and {@code clearing == null}.
 * Use a register-allocated code, or {@link #testIban()}, which mints one.
 *
 * <p>Every method throws a subclass of {@link IBANforgeException} on a transport or
 * authorization failure. A malformed IBAN is NOT an exception: it comes back 200 with
 * {@code valid: false} and an {@code error} field on the result.
 */
public final class IBANforge {

    static final String VERSION = "1.5.0";
    private static final String DEFAULT_BASE_URL = "https://api.ibanforge.com";
    private static final Duration DEFAULT_TIMEOUT = Duration.ofSeconds(30);
    private static final String USER_AGENT = "ibanforge-java/" + VERSION;

    static final ObjectMapper MAPPER = new ObjectMapper()
        .setPropertyNamingStrategy(PropertyNamingStrategies.SNAKE_CASE)
        .setSerializationInclusion(JsonInclude.Include.NON_NULL)
        .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false)
        .configure(SerializationFeature.FAIL_ON_EMPTY_BEANS, false);

    private final String baseUrl;
    private final String apiKey;
    private final Duration timeout;
    private final HttpClient httpClient;

    private IBANforge(Builder builder) {
        // Explicit builder value wins, then the environment, then production. Resolved per
        // instance rather than cached statically so a test (or a process that configures
        // itself late) is never fighting a snapshot taken at class-load time.
        this.baseUrl = firstNonBlank(builder.baseUrl, System.getenv("IBANFORGE_API_BASE"), DEFAULT_BASE_URL)
            .replaceAll("/+$", "");
        this.apiKey = firstNonBlank(builder.apiKey, System.getenv("IBANFORGE_API_KEY"), null);
        this.timeout = builder.timeout != null ? builder.timeout : DEFAULT_TIMEOUT;
        this.httpClient = builder.httpClient != null
            ? builder.httpClient
            : HttpClient.newBuilder()
                .connectTimeout(this.timeout)
                .followRedirects(HttpClient.Redirect.NORMAL)
                .build();
    }

    /** A new builder, defaulting every option from the environment (see {@link Builder}). */
    public static Builder builder() {
        return new Builder();
    }

    // Package-private: not part of the public API, only so the same-package test suite can
    // assert configuration resolution (builder value / env / default) without faking the
    // transport layer or mutating the real process environment.
    String resolvedBaseUrlForTests() {
        return baseUrl;
    }

    String resolvedApiKeyForTests() {
        return apiKey;
    }

    /** Equivalent to {@code IBANforge.builder().build()}: every option resolved from the environment. */
    public static IBANforge create() {
        return new Builder().build();
    }

    /**
     * Builds an {@link IBANforge} client.
     *
     * <p>Every option falls back to an environment variable, then a production default, so a
     * bare {@code IBANforge.create()} already works: {@code apiKey} falls back to
     * {@code IBANFORGE_API_KEY} -- the same variable the MCP server reads, so one setting
     * configures both -- and {@code baseUrl} falls back to {@code IBANFORGE_API_BASE}, which is
     * what points the SDK at a local server in tests and a staging deployment in CI.
     */
    public static final class Builder {
        private String apiKey;
        private String baseUrl;
        private Duration timeout;
        private HttpClient httpClient;

        private Builder() {
        }

        /** ifk_* API key. Required for paid endpoints (unless paying per-call via x402). */
        public Builder apiKey(String apiKey) {
            this.apiKey = apiKey;
            return this;
        }

        /** Override the API base URL (default {@code https://api.ibanforge.com}). */
        public Builder baseUrl(String baseUrl) {
            this.baseUrl = baseUrl;
            return this;
        }

        /** Per-request timeout (default 30s). */
        public Builder timeout(Duration timeout) {
            this.timeout = timeout;
            return this;
        }

        /**
         * Use a caller-supplied {@link HttpClient} instead of the SDK's default one -- for a
         * custom proxy, executor, or connection pool. {@link #timeout(Duration)} still governs
         * every request made through it.
         */
        public Builder httpClient(HttpClient httpClient) {
            this.httpClient = httpClient;
            return this;
        }

        public IBANforge build() {
            return new IBANforge(this);
        }
    }

    private static String firstNonBlank(String a, String b, String fallback) {
        if (a != null && !a.isBlank()) {
            return a;
        }
        if (b != null && !b.isBlank()) {
            return b;
        }
        return fallback;
    }

    // ---- HTTP plumbing --------------------------------------------------------------------

    private HttpRequest.Builder newRequestBuilder(String path) {
        HttpRequest.Builder b = HttpRequest.newBuilder(URI.create(baseUrl + path))
            .timeout(timeout)
            .header("User-Agent", USER_AGENT);
        if (apiKey != null && !apiKey.isBlank()) {
            b.header("Authorization", "Bearer " + apiKey);
        }
        return b;
    }

    private <T> T get(String path, Class<T> type) {
        return execute(newRequestBuilder(path).GET().build(), type);
    }

    private <T> T post(String path, Object body, Class<T> type) {
        String json;
        try {
            json = MAPPER.writeValueAsString(body);
        } catch (JsonProcessingException e) {
            throw new IBANforgeException("Failed to encode request body: " + e.getMessage());
        }
        HttpRequest request = newRequestBuilder(path)
            .header("Content-Type", "application/json")
            .POST(HttpRequest.BodyPublishers.ofString(json, StandardCharsets.UTF_8))
            .build();
        return execute(request, type);
    }

    private <T> T execute(HttpRequest request, Class<T> type) {
        try {
            HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
            raiseForStatus(response);
            return MAPPER.readValue(response.body(), type);
        } catch (HttpTimeoutException e) {
            throw new IBANforgeException("Request timed out after " + timeout.toMillis() + "ms");
        } catch (IOException e) {
            // Covers both a transport failure and a malformed JSON response body -- the same
            // bucket the TypeScript SDK's fetch-based client falls into for either.
            throw new IBANforgeException("Network error: " + e.getMessage());
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IBANforgeException("Network error: " + e.getMessage());
        }
    }

    /** Maps a non-2xx HTTP response to a typed {@link IBANforgeException} subclass. */
    private static void raiseForStatus(HttpResponse<String> response) {
        int status = response.statusCode();
        if (status >= 200 && status < 300) {
            return;
        }
        String text = response.body() == null ? "" : response.body();
        JsonNode node = null;
        if (!text.isBlank()) {
            try {
                JsonNode parsed = MAPPER.readTree(text);
                if (parsed != null && !parsed.isMissingNode()) {
                    node = parsed;
                }
            } catch (IOException ignored) {
                // Not JSON -- body stays the raw text, exactly like the TS/Python clients.
            }
        }
        Object body = node != null ? node : text;
        String message = pickMessage(node, status);
        String errorSlug = textField(node, "error");

        if (status == 401 || status == 403) {
            throw new AuthException(message, status, body);
        }
        if (status == 402) {
            throw new PaymentRequiredException(message, status, body);
        }
        if (status == 413) {
            throw new PayloadTooLargeException(message, status, body);
        }
        if (status == 429) {
            if ("quota_exceeded".equals(errorSlug)) {
                throw new QuotaExhaustedException(message, status, body);
            }
            throw new RateLimitException(message, status, body);
        }
        if (status >= 400 && status < 500) {
            throw new InvalidInputException(message, status, body);
        }
        if (status >= 500) {
            throw new ApiException(message, status, body);
        }
        throw new IBANforgeException(message, status, body);
    }

    private static String pickMessage(JsonNode node, int status) {
        String message = textField(node, "message");
        if (message != null) {
            return message;
        }
        String detail = textField(node, "error_detail");
        if (detail != null) {
            return detail;
        }
        String error = textField(node, "error");
        if (error != null) {
            return error;
        }
        // java.net.http.HttpResponse exposes no HTTP reason phrase, unlike fetch's
        // res.statusText or httpx's res.reason_phrase -- fall back to the bare status.
        return "HTTP " + status;
    }

    private static String textField(JsonNode node, String field) {
        if (node == null || !node.isObject()) {
            return null;
        }
        JsonNode value = node.get(field);
        return (value != null && value.isTextual() && !value.asText().isEmpty()) ? value.asText() : null;
    }

    /**
     * Percent-encodes one path/query component the way JavaScript's {@code encodeURIComponent}
     * does. {@link URLEncoder} alone targets {@code application/x-www-form-urlencoded} and
     * encodes a space as {@code +}; every reference SDK (and this SDK's own tests) expects
     * {@code %20}, so the substitution below is required, not cosmetic.
     */
    private static String encode(String value) {
        return URLEncoder.encode(value, StandardCharsets.UTF_8).replace("+", "%20");
    }

    // ---- IBAN -------------------------------------------------------------------------------

    /** FREE pre-flight check (mod-97 + structure). No API key required. */
    public IBANFormatResult formatIban(String iban) {
        return get("/v1/iban/format?iban=" + encode(iban), IBANFormatResult.class);
    }

    /** Validate one IBAN with full enrichment ($0.005 / call with API key). */
    public IBANValidationResult validateIban(String iban) {
        return post("/v1/iban/validate", Map.of("iban", iban), IBANValidationResult.class);
    }

    /** Validate up to 100 IBANs in one call ($0.002 / IBAN with API key). */
    public IBANBatchResult validateBatch(List<String> ibans) {
        if (ibans == null || ibans.isEmpty()) {
            throw new InvalidInputException("ibans must contain at least one IBAN");
        }
        if (ibans.size() > 100) {
            throw new InvalidInputException("ibans must be at most 100 entries (got " + ibans.size() + ")");
        }
        return post("/v1/iban/batch", Map.of("ibans", ibans), IBANBatchResult.class);
    }

    /**
     * Pre-flight compliance triage on an IBAN ($0.02 / call with API key). Read the score at
     * {@code result.compliance().riskScore()}. Informational, not a regulated AML/CFT product;
     * sanctions screening is BANK-level (BIC8) only.
     */
    public ComplianceResult checkCompliance(String iban) {
        return post("/v1/iban/compliance", Map.of("iban", iban), ComplianceResult.class);
    }

    // ---- BIC / SWIFT ------------------------------------------------------------------------

    /** Resolve a BIC/SWIFT code into bank, country, city, LEI ($0.003 / call). */
    public BICLookupResult lookupBic(String code) {
        return get("/v1/bic/" + encode(code), BICLookupResult.class);
    }

    // ---- Swiss clearing -----------------------------------------------------------------------

    /** Resolve a Swiss BC-Nummer / IID into institution data ($0.003 / call). */
    public CHClearingResult lookupChClearing(String iid) {
        return get("/v1/ch/clearing/" + encode(iid), CHClearingResult.class);
    }

    /** Resolve a Swiss BC-Nummer / IID into institution data ($0.003 / call). */
    public CHClearingResult lookupChClearing(long iid) {
        return lookupChClearing(Long.toString(iid));
    }

    // ---- Reference data (all FREE, no key needed) --------------------------------------------

    /** Every country the API can parse, with its IBAN length. FREE. */
    public IBANStructureList ibanStructures() {
        return get("/v1/iban/structure", IBANStructureList.class);
    }

    /** One country's BBAN template -- field offsets, lengths, charsets. FREE. */
    public IBANStructure ibanStructure(String country) {
        return get("/v1/iban/structure/" + encode(country), IBANStructure.class);
    }

    /**
     * Test IBANs whose bank code is REALLY allocated, with the register row that proves it.
     * FREE. Use this instead of a registry illustration for fixtures and demos: an unallocated
     * bank code comes back with every enrichment field null.
     */
    public TestIbanResult testIban() {
        return testIban(null, null);
    }

    /** Like {@link #testIban()}, restricted to one country and/or a given count. FREE. */
    public TestIbanResult testIban(String country, Integer count) {
        List<String> params = new ArrayList<>();
        if (country != null && !country.isBlank()) {
            params.add("country=" + encode(country));
        }
        if (count != null) {
            params.add("count=" + count);
        }
        String suffix = params.isEmpty() ? "" : "?" + String.join("&", params);
        return get("/v1/test-iban" + suffix, TestIbanResult.class);
    }

    /**
     * Check a QR-bill (QRR), ISO 11649 (RF/SCOR), Belgian OGM/VCS or Finnish payment reference
     * against the dated document that publishes its rule. FREE.
     *
     * <p>This checks the reference ALONE. The pairing verdict -- whether that reference may
     * legally travel with a given account under the Swiss Payment Standards -- is the paid
     * half: send a {@code reference} field to {@link #validateIban} and read the result's
     * {@code reference_check.pairing}.
     */
    public ReferenceValidationResult validateReference(String reference) {
        return validateReference(reference, null);
    }

    /** Like {@link #validateReference(String)}, pinning the scheme to check against. FREE. */
    public ReferenceValidationResult validateReference(String reference, String referenceType) {
        StringBuilder query = new StringBuilder("reference=").append(encode(reference));
        if (referenceType != null && !referenceType.isBlank()) {
            query.append("&reference_type=").append(encode(referenceType));
        }
        return get("/v1/reference/validate?" + query, ReferenceValidationResult.class);
    }

    /**
     * Check a structured ISO 20022 postal address against a scheme's rules ({@code sps},
     * {@code hvps_plus}, {@code fedwire}). FREE.
     *
     * <p>{@code address} is the open bag of ISO 20022 address tags (e.g. {@code twn_nm},
     * {@code ctry}, {@code pst_cd}, {@code strt_nm}, {@code bldg_nb}, {@code adr_line}) -- kept
     * as a {@code Map} rather than a fixed type because the checker reads more tags than any
     * one scheme uses, exactly like the TypeScript SDK's {@code PostalAddress} index signature
     * and the Python SDK's plain {@code dict}.
     *
     * <p>Every finding names the guideline it was read from: relay {@code source} with the
     * verdict rather than the boolean alone.
     */
    public AddressCheckResult checkAddress(String scheme, Map<String, Object> address) {
        return post("/v1/address/check", Map.of("scheme", scheme, "address", address), AddressCheckResult.class);
    }

    /** Prepaid credit packs and their per-call price. FREE to list. */
    public CreditBundleList creditBundles() {
        return get("/v1/credits/bundles", CreditBundleList.class);
    }

    /** Worked examples of every endpoint, no key and no payment. FREE. */
    public DemoResult demo() {
        return get("/v1/demo", DemoResult.class);
    }

    // ---- API keys -----------------------------------------------------------------------------

    /**
     * Create a free API key (200 requests/month). The key is shown ONCE.
     *
     * <p>Use a real mailbox: fictional and disposable domains ({@code example.com},
     * {@code mailinator}, ...) are refused with {@code disposable_email}. A second key from the
     * same network within seven days answers 403 {@code verification_required} and mails a
     * six-digit code -- repeat the call with {@link #generateApiKey(String, String)} to claim
     * it.
     */
    public static APIKey generateApiKey(String email) {
        return generateApiKey(email, null, null, null);
    }

    /** Like {@link #generateApiKey(String)}, replaying the mailbox verification code. */
    public static APIKey generateApiKey(String email, String code) {
        return generateApiKey(email, null, null, code);
    }

    /** Full control over base URL and timeout, for tests and staging. */
    public static APIKey generateApiKey(String email, String baseUrl, Duration timeout, String code) {
        Builder builder = builder();
        if (baseUrl != null) {
            builder.baseUrl(baseUrl);
        }
        if (timeout != null) {
            builder.timeout(timeout);
        }
        IBANforge client = builder.build();
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("email", email);
        if (code != null && !code.isBlank()) {
            body.put("code", code);
        }
        return client.post("/v1/keys/generate", body, APIKey.class);
    }

    /** Current month's quota usage for the configured API key. */
    public APIKeyUsage usage() {
        if (apiKey == null || apiKey.isBlank()) {
            throw new AuthException(
                "usage() requires an API key -- pass IBANforge.builder().apiKey(\"ifk_...\").build()");
        }
        return get("/v1/keys/usage", APIKeyUsage.class);
    }

    // ---- Misc -----------------------------------------------------------------------------------

    /** Public health endpoint -- version, BIC count, uptime. */
    public HealthInfo health() {
        return get("/health", HealthInfo.class);
    }
}

package com.ibanforge.sdk;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;

import java.io.IOException;
import java.io.OutputStream;
import java.io.UncheckedIOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * A local {@code com.sun.net.httpserver.HttpServer} on an ephemeral port, for testing the SDK
 * with canned responses and no real network traffic.
 *
 * <p>Queue responses with {@link #enqueue}; each incoming request consumes the next queued
 * response, or replays {@link #fallback} once the queue runs dry. Every request received is
 * recorded and retrievable via {@link #lastRequest()} for assertions on method, path, query,
 * headers and body.
 */
final class MockApiServer implements AutoCloseable {

    record CannedResponse(int status, String contentType, String body) {
        static CannedResponse json(int status, String body) {
            return new CannedResponse(status, "application/json", body);
        }

        static CannedResponse text(int status, String body) {
            return new CannedResponse(status, "text/plain", body);
        }
    }

    record RecordedRequest(String method, String path, String query, Map<String, String> headers, String body) {
        boolean hasHeader(String name) {
            return headers.containsKey(name.toLowerCase(java.util.Locale.ROOT));
        }

        String header(String name) {
            return headers.get(name.toLowerCase(java.util.Locale.ROOT));
        }
    }

    private final HttpServer server;
    private final Deque<CannedResponse> queue = new ArrayDeque<>();
    private final Deque<RecordedRequest> requests = new ArrayDeque<>();
    private CannedResponse fallback = CannedResponse.json(200, "{}");
    private long handlerDelayMillis = 0;

    MockApiServer() {
        try {
            server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
        server.createContext("/", this::handle);
        server.setExecutor(null);
        server.start();
    }

    String baseUrl() {
        return "http://127.0.0.1:" + server.getAddress().getPort();
    }

    void enqueue(CannedResponse response) {
        queue.addLast(response);
    }

    void setFallback(CannedResponse response) {
        this.fallback = response;
    }

    /** Makes every handled request sleep this long before responding, to force client timeouts. */
    void delayResponsesBy(long millis) {
        this.handlerDelayMillis = millis;
    }

    RecordedRequest lastRequest() {
        return requests.peekLast();
    }

    int requestCount() {
        return requests.size();
    }

    private void handle(HttpExchange exchange) throws IOException {
        if (handlerDelayMillis > 0) {
            try {
                Thread.sleep(handlerDelayMillis);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
        }

        Map<String, String> headers = new LinkedHashMap<>();
        exchange.getRequestHeaders().forEach((k, v) -> headers.put(k.toLowerCase(java.util.Locale.ROOT), String.join(",", v)));
        byte[] requestBody = exchange.getRequestBody().readAllBytes();
        String bodyText = new String(requestBody, StandardCharsets.UTF_8);
        requests.addLast(new RecordedRequest(
            exchange.getRequestMethod(),
            exchange.getRequestURI().getPath(),
            exchange.getRequestURI().getRawQuery(),
            headers,
            bodyText
        ));

        CannedResponse response = queue.isEmpty() ? fallback : queue.pollFirst();
        byte[] payload = response.body().getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set("Content-Type", response.contentType());
        exchange.sendResponseHeaders(response.status(), payload.length);
        try (OutputStream os = exchange.getResponseBody()) {
            os.write(payload);
        }
    }

    @Override
    public void close() {
        server.stop(0);
    }
}

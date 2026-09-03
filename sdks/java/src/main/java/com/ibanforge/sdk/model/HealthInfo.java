package com.ibanforge.sdk.model;

import java.util.Map;

/** Result of {@code GET /health} -- version, database size, uptime. */
public record HealthInfo(
    String status,
    String version,
    Double uptimeSeconds,
    int bicDatabaseEntries,
    Integer chClearingEntries,
    String bicDataLastUpdated,
    Map<String, String> databases
) {
}

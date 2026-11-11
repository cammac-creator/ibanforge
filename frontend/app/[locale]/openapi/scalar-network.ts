/**
 * What the API reference (/openapi, Scalar) may reach on the network, kept
 * apart from its theme so that a test can hold it (`scalar-network.test.ts`).
 *
 * Since 11/11/2026 (audit WEB-03, the content security policy is enforced):
 *
 *  - `proxyUrl: ''`: by default Scalar sends every "Test Request" through
 *    https://proxy.scalar.com (its `getDefaultProxyUrl` for a web page), a
 *    third-party relay that forwards to whatever address it is handed. The
 *    policy does not name it and must not: an open relay in `connect-src` would
 *    let any script on any page send anything anywhere. An empty string means
 *    "no proxy" (left undefined, Scalar falls back to its own). The browser then
 *    calls api.ibanforge.com directly, which answers CORS for ibanforge.com,
 *    and a key a visitor pastes into the form no longer transits a third party.
 *  - `withDefaultFonts: false`: otherwise Scalar loads Inter from
 *    fonts.scalar.com; the site already serves its own.
 *  - `agent: { disabled: true }`: the "Ask AI" panel talks to Scalar's servers.
 *    It only switches itself on for a local address or with a Scalar key, so it
 *    never showed in production; disabled, a local check sees what visitors see.
 *  - `telemetry: false`: no analytics plugin is loaded, so nothing was sent;
 *    written down so that adding one later does not turn it on silently.
 */
export const SCALAR_NETWORK_CONFIGURATION = {
  proxyUrl: '',
  withDefaultFonts: false,
  agent: { disabled: true },
  telemetry: false,
} as const;

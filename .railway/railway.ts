// The settings of the API service on Railway (infrastructure as code).
//
// Railway stops reading `railway.toml` on 1 December 2026; since 20 November 2026 this
// file carries what it carried: the Dockerfile build, the paths whose change redeploys
// the API, the health check, the restart policy and the mount of the volume.
//
// Railway does NOT read this file at deploy time. A change here reaches production only
// through `railway config plan` (read the plan first) and then `railway config apply`,
// run from the repository root by the integrator. A push to `main` still redeploys the
// API by itself when it touches one of the watched paths.
//
// The volume `ibanforge-volume` holds stats.sqlite (keys, quotas, revenue). Never remove
// it or its mount from this file, and never apply a plan that touches the volume at all
// (its size and region included): this file describes the whole project, and an apply
// deletes what the file omits.
//
// Variables are listed by name only, with `preserve()`: their values stay on Railway.
// A variable that exists on Railway and is not named here is DELETED by the next apply
// (the plan says "Delete variable"). So a variable set on Railway, a withdrawal switch
// such as RESTRICTED_WITHDRAWN included, is added here in the same move, and a plan that
// announces anything "to destroy" is never applied: the file is corrected first.
//
// `scripts/dockerfile-watch-patterns.test.ts` holds this file against the Dockerfile.
import { defineRailway, github, preserve, project, service, volume } from "railway/iac";

export default defineRailway(() => {
  const ibanforgeVolume = volume("ibanforge-volume", { alerts: { usage: { "100": {}, "80": {}, "95": {} } }, allowOnlineResize: true, region: "europe-west4-drams3a", sizeMB: 5000 });
  const ibanforge = service("ibanforge", {
    source: github("cammac-creator/ibanforge", { checkSuites: false }),
    replicas: { "europe-west4-drams3a": 1 },
    domains: [{ domain: "api.ibanforge.com", port: 3000 }],
    volumeMounts: { "/app/data": ibanforgeVolume },
    // Redeploy the API only when something that enters its image changes: the paths the
    // Dockerfile copies, plus the build configuration. With a volume attached, every
    // redeploy is a short outage, so a push that touches only the site, the SDKs, the
    // MCP package or the docs must not cause one. scripts/ is watched file by file: a
    // script the Dockerfile starts to copy is added here, or the test fails.
    build: {
      builder: "DOCKERFILE",
      dockerfilePath: "Dockerfile",
      watchPatterns: [
        "src/**",
        "scripts/seed-uk-modulus.ts",
        "scripts/forget-customer.cjs",
        "data/**",
        "package.json",
        "package-lock.json",
        "tsconfig.json",
        "tsconfig.build.json",
        "Dockerfile",
        "entrypoint.sh",
      ],
    },
    deploy: {
      healthcheckPath: "/health",
      healthcheckTimeout: 30,
      // Restart on failure, three tries. "On failure" is Railway's default and Railway
      // stores a default as unset: naming restartPolicyType here leaves a pending change
      // in every plan (seen on 20 November 2026). Only the number of tries is set.
      restartPolicyMaxRetries: 3,
    },
    env: { ACTIVATION_NUDGE_DISABLED: preserve(), ADMIN_READ_TOKEN: preserve(), ADMIN_SECRET: preserve(), ANTHROPIC_API_KEY: preserve(), BACKUP_TOKEN: preserve(), BASE_RPC_URL: preserve(), BULLETIN_FEED_TOKEN: preserve(), BUREAU_CONTEXT_TOKEN: preserve(), CDP_API_KEY_ID: preserve(), CDP_API_KEY_SECRET: preserve(), CORS_ORIGIN: preserve(), CRM_INTERNAL_EMAILS: preserve(), CRM_WARM_ACCOUNT: preserve(), EE_REGISTER_PATH: preserve(), GR_REGISTER_PATH: preserve(), GSC_SA_JSON: preserve(), HEARTBEAT_TOKEN: preserve(), INDICATORS_TOKEN: preserve(), IP_HASH_SECRET: preserve(), LU_REGISTER_PATH: preserve(), MAIL_OUTREACH_TOKEN: preserve(), MAIL_RELAY_SECRET: preserve(), MAIL_RELAY_URL: preserve(), MAIL_SYNC_TOKEN: preserve(), ME_REGISTER_PATH: preserve(), NODE_ENV: preserve(), PARTNER_PAYQR: preserve(), PLAYGROUND_API_KEY: preserve(), PORT: preserve(), PROSPECTING_TOKEN: preserve(), RESTRICTED_BIC_OVERLAY_PATH: preserve(), RESTRICTED_COMPLIANCE_OVERLAY_PATH: preserve(), RESTRICTED_OVERLAY_PULL_REPO: preserve(), RESTRICTED_OVERLAY_PULL_TOKEN: preserve(), RPC_LOG_CHUNK_SIZE: preserve(), RS_REGISTER_PATH: preserve(), SITE_ADMIN_TOKEN: preserve(), SITE_SERVER_API_KEYS: preserve(), SO_USER_ID: preserve(), STATS_TOKEN: preserve(), STRIPE_PAYMENT_LINK_ALLOWLIST: preserve(), STRIPE_SECRET_KEY: preserve(), STRIPE_WEBHOOK_SECRET: preserve(), TELEGRAM_BOT_TOKEN: preserve(), TELEGRAM_CHAT_ID: preserve(), WALLET_ADDRESS: preserve(), X402_ENABLED: preserve(), X402_INTERNAL_PAYERS: preserve() },
  });

  return project("captivating-compassion", {
    resources: [ibanforge, ibanforgeVolume],
  });
});

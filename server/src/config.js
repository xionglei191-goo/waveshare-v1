const path = require("path");

function numberFromEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}

function listFromEnv(name, fallback) {
  return String(process.env[name] || fallback)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function loadConfig(overrides = {}) {
  const rootDir = path.resolve(__dirname, "..");
  const dataDir = process.env.DATA_DIR || path.join(rootDir, "data");
  const resourceDir = process.env.RESOURCE_DIR || path.join(dataDir, "resources");
  const openclawTargets = listFromEnv("OPENCLAW_TARGETS", "default,music,diagnostics");

  return {
    name: "xiaozhi-family-hub-server",
    version: "0.2.0",
    host: process.env.HOST || "0.0.0.0",
    port: numberFromEnv("PORT", 3100),
    rootDir,
    dataDir,
    stateFile: process.env.STATE_FILE || path.join(dataDir, "state.json"),
    storeDriver: process.env.STORE_DRIVER || "json",
    sqliteFile: process.env.SQLITE_FILE || path.join(dataDir, "family-hub.sqlite"),
    sqliteRelationalReads: process.env.SQLITE_RELATIONAL_READS === "1",
    sqliteCompactKv: process.env.SQLITE_COMPACT_KV === "1",
    resourceDir,
    publicBaseUrl: process.env.PUBLIC_BASE_URL || "http://192.168.31.246:3100",
    // LAN base URL used for device-facing media stream URLs. The ESP32 round screen
    // plays server audio over plain HTTP on the LAN and cannot open the public HTTPS
    // tunnel URL, so device-facing streamUrl/downloadUrl must stay on the LAN backend.
    deviceMediaBaseUrl: process.env.DEVICE_MEDIA_BASE_URL || process.env.LAN_BASE_URL || "",
    adminToken: process.env.ADMIN_TOKEN || "",
    adminPublicHosts: listFromEnv("ADMIN_PUBLIC_HOSTS", ""),
    adminProtectPublicMutations: process.env.ADMIN_PROTECT_PUBLIC_MUTATIONS !== "0",
    allowQueryTokens: process.env.ALLOW_QUERY_TOKENS !== "0",
    corsAllowedOrigins: listFromEnv("CORS_ALLOWED_ORIGINS", ""),
    requestLogJson: process.env.REQUEST_LOG_JSON !== "0",
    idempotencyTtlMs: numberFromEnv("IDEMPOTENCY_TTL_MS", 24 * 60 * 60 * 1000),
    rateLimitAgentPerMinute: numberFromEnv("RATE_LIMIT_AGENT_PER_MINUTE", 30),
    rateLimitActionPerMinute: numberFromEnv("RATE_LIMIT_ACTION_PER_MINUTE", 60),
    rateLimitDeviceLogsPerMinute: numberFromEnv("RATE_LIMIT_DEVICE_LOGS_PER_MINUTE", 120),
    rateLimitAdminPerMinute: numberFromEnv("RATE_LIMIT_ADMIN_PER_MINUTE", 120),
    cloudflareAccessTeamDomain: process.env.CLOUDFLARE_ACCESS_TEAM_DOMAIN || "",
    cloudflareAccessAud: process.env.CLOUDFLARE_ACCESS_AUD || "",
    cloudflareAccessAllowedEmails: listFromEnv("CLOUDFLARE_ACCESS_ALLOWED_EMAILS", ""),
    cloudflareAccessRequired: process.env.CLOUDFLARE_ACCESS_REQUIRED === "1",
    xiaozhiToolToken: process.env.XIAOZHI_TOOL_TOKEN || process.env.AI_TOOL_TOKEN || "",
    deviceToken: process.env.DEVICE_TOKEN || "",
    aiDeviceContextTtlMs: numberFromEnv("AI_DEVICE_CONTEXT_TTL_MS", 120000),
    aiTraceLimit: numberFromEnv("AI_TRACE_LIMIT", 200),
    aiTraceStoreText: process.env.AI_TRACE_STORE_TEXT === "1",
    aiStoreConversationText: process.env.AI_STORE_CONVERSATION_TEXT === "1",
    aiLightweightModel: process.env.AI_LIGHTWEIGHT_MODEL || "gpt-5.4-mini",
    aiComplexModel: process.env.AI_COMPLEX_MODEL || "gpt-5.5",
    openclawCommand: process.env.OPENCLAW_COMMAND || "/usr/local/bin/openclaw",
    openclawTimeoutMs: numberFromEnv("OPENCLAW_TIMEOUT_MS", 10000),
    openclawTargets,
    openclawTargetCommands: Object.fromEntries(openclawTargets.map((target) => {
      const envName = `OPENCLAW_TARGET_${String(target).replace(/[^a-zA-Z0-9]/g, "_").toUpperCase()}_COMMAND`;
      return [target, process.env[envName] || ""];
    })),
    musicServerUrl: process.env.MUSIC_SERVER_URL || "",
    serverMusicDir: process.env.SERVER_MUSIC_DIR || path.join(resourceDir, "music/server"),
    onlineMediaProviders: listFromEnv("ONLINE_MEDIA_PROVIDERS", "rss,archive,direct"),
    onlineMediaFeeds: listFromEnv("ONLINE_MEDIA_FEEDS", ""),
    onlineMediaCatalogFile: process.env.ONLINE_MEDIA_CATALOG_FILE || path.join(dataDir, "online-media.json"),
    onlineMediaTimeoutMs: numberFromEnv("ONLINE_MEDIA_TIMEOUT_MS", 4500),
    onlineMediaMaxResults: numberFromEnv("ONLINE_MEDIA_MAX_RESULTS", 6),
    onlineMediaAllowDirectUrls: process.env.ONLINE_MEDIA_ALLOW_DIRECT_URLS !== "0",
    onlineMediaAllowPrivateHosts: process.env.ONLINE_MEDIA_ALLOW_PRIVATE_HOSTS === "1",
    podcastRefreshIntervalMinutes: numberFromEnv("PODCAST_REFRESH_INTERVAL_MINUTES", 0),
    podcastRefreshBatchSize: numberFromEnv("PODCAST_REFRESH_BATCH_SIZE", 6),
    nasMusicDir: process.env.NAS_MUSIC_DIR || "",
    homeAssistantUrl: process.env.HOME_ASSISTANT_URL || "",
    homeAssistantToken: process.env.HOME_ASSISTANT_TOKEN || "",
    homeAssistantScenes: listFromEnv("HOME_ASSISTANT_SCENES", "scene.family,scene.home,scene.evening,scene.good_night,scene.morning,scene.away"),
    homeAssistantTimeoutMs: numberFromEnv("HOME_ASSISTANT_TIMEOUT_MS", 5000),
    // Xiaomi / XiaoAi speaker control through Home Assistant. The entity should be
    // the speaker exposed by the xiaomi_miot integration (a media_player entity
    // that also accepts the intelligent_speaker service). Speaker tools stay
    // simulated until both Home Assistant and this entity are configured.
    speakerEntity: process.env.XIAOMI_SPEAKER_ENTITY || "",
    speakerService: process.env.XIAOMI_SPEAKER_SERVICE || "xiaomi_miot.intelligent_speaker",
    weatherProvider: process.env.WEATHER_PROVIDER || "mock",
    weatherLatitude: numberFromEnv("WEATHER_LATITUDE", 27.681864),
    weatherLongitude: numberFromEnv("WEATHER_LONGITUDE", 112.626292),
    weatherTimezone: process.env.WEATHER_TIMEZONE || "Asia/Shanghai",
    weatherLocationLabel: process.env.WEATHER_LOCATION_LABEL || "家",
    weatherTimeoutMs: numberFromEnv("WEATHER_TIMEOUT_MS", 6000),
    weatherRefreshIntervalMinutes: numberFromEnv("WEATHER_REFRESH_INTERVAL_MINUTES", 30),
    weatherAgentCacheMaxAgeMs: numberFromEnv("WEATHER_AGENT_CACHE_MAX_AGE_MS", 35 * 60 * 1000),
    weatherAgentRefreshTimeoutMs: numberFromEnv("WEATHER_AGENT_REFRESH_TIMEOUT_MS", 800),
    ...overrides
  };
}

module.exports = {
  loadConfig
};

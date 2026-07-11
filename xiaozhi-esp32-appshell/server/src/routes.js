const express = require("express");
const crypto = require("crypto");
const fs = require("fs");

const { buildAcceptanceStatus, recordAcceptanceEvidence } = require("./acceptance");
const { buildAcceptanceEvidencePack } = require("./acceptance-pack");
const { planAgentRequest } = require("./agents");
const {
  agentBodyWithDeviceContext,
  deviceContext,
  listAiTraces,
  modelTierForFallback,
  updateDeviceContext,
  upsertAiTrace
} = require("./ai-runtime");
const {
  personalizeSpeech
} = require("./member-context");
const { adminAuthMiddleware, publicMutationAuthMiddleware } = require("./admin-auth");
const {
  markAuthTokenUsed,
  verifyAuthToken
} = require("./auth-tokens");
const { handleAction, normalizeActionName, normalizeParams } = require("./actions");
const {
  executeCapability,
  listCapabilities,
  normalizeArgs,
  normalizeContext,
  prepareCapability
} = require("./capabilities");
const { catalogView, importContent, seedContent } = require("./content");
const { looksLikeRepresentativeContent } = require("./content-policy");
const {
  enqueueXiaozhiToolCommand,
  ensureDeviceCommandState,
  pendingDeviceCommands,
  resolveServerMediaForCommand
} = require("./device-commands");
const {
  buildCompatibility,
  buildOtaManifest
} = require("./device-registry");
const { deviceSummary, musicSummary, nextSchedule } = require("./domain");
const { executionSourceStatus, weatherSourceStatus } = require("./integration-status");
const { refreshWeatherStore, weatherView } = require("./weather");
const {
  addMediaFavorite,
  addMediaQueueItem,
  applyPodcastFeedRefresh,
  audioContentType,
  buildMediaLibrary,
  clearMediaQueue,
  deleteOnlineCatalogTrack,
  deleteMediaFavorite,
  deleteMediaProgress,
  deletePodcastFeed,
  deleteServerTrack,
  fetchPodcastFeed,
  findOnlineTrack,
  listMediaFavorites,
  listMediaProgress,
  listMediaQueue,
  listKnownServerTracks,
  filterTracksForView,
  toDeviceTrack,
  listOnlineCatalog,
  listPodcastEpisodes,
  listPodcastFeeds,
  listResumeCandidates,
  markPodcastFeedRefreshError,
  moveMediaQueueItem,
  nextMediaQueueItem,
  playMediaQueueItem,
  proxyRemoteAudio,
  registerOnlineTrack,
  refreshPodcastFeeds,
  removeMediaQueueItem,
  resolveMediaSearch,
  resolveResumeCandidate,
  renameServerTrack,
  stopMediaQueue,
  upsertPodcastFeed,
  upsertOnlineCatalogTrack,
  upsertMediaProgress,
  serverTrackFile
} = require("./media");
const {
  createMemory,
  deleteMemory,
  listLearningRecords,
  listMemory,
  recordAgentInteraction,
  updateMemory
} = require("./memory");
const { buildResourceManifest, deleteResourceFile, resourceFilePath, writeResourceFile } = require("./resources");
const { createRequestControls } = require("./request-controls");
const { registerFamilyRoutes } = require("./routes/family");
const { registerDeviceRoutes } = require("./routes/devices");
const { registerAdminRoutes } = require("./routes/admin");
const { applyPushedEvents, buildPullPayload } = require("./sync");
const { COMPONENT_SCHEMA, buildPage } = require("./ui-pages");

function commandExecutable(command) {
  if (!command) {
    return false;
  }
  try {
    fs.accessSync(command, fs.constants.X_OK);
    return true;
  } catch (error) {
    return false;
  }
}

function snapshotWithServerMedia(state, config) {
  const tracks = listKnownServerTracks(state, config);
  if (tracks.length === 0) {
    return state;
  }
  const currentIndex = Math.min(state.music.server.currentIndex || 0, tracks.length - 1);
  const deviceTracks = tracks.map((track) => toDeviceTrack(track, config));
  const current = deviceTracks[currentIndex];
  return {
    ...state,
    music: {
      ...state.music,
      server: {
        ...state.music.server,
        available: true,
        source: current.origin === "online" ? current.source : "服务器播客",
        detail: current.origin === "online" ? `网络媒体 ${tracks.length} 项` : `服务器媒体 ${tracks.length} 项`,
        currentIndex,
        title: current.title,
        artist: current.artist,
        tracks: deviceTracks
      }
    }
  };
}

function notificationKey(state) {
  const item = state?.notifications?.[0];
  if (!item) {
    return "";
  }
  return item.id || [item.title, item.message, item.level].filter(Boolean).join("|");
}

function compactNotification(item) {
  if (!item) {
    return null;
  }
  return {
    id: item.id,
    title: item.title,
    message: item.message,
    level: item.level,
    createdAt: item.createdAt
  };
}

function compactMediaProgress(items, deviceId = "") {
  const list = Array.isArray(items) ? items : [];
  return list
    .filter((item) => !deviceId || item.deviceId === deviceId)
    .slice(0, 100);
}

function readinessStatus(checks) {
  const okCount = checks.filter((check) => check.ok).length;
  if (okCount === checks.length) {
    return "ready";
  }
  if (okCount > 0) {
    return "partial";
  }
  return "missing";
}

function readinessCheck(id, label, ok, detail = "") {
  return {
    id,
    label,
    ok: Boolean(ok),
    detail: String(detail || "").slice(0, 240)
  };
}

function latestDeviceLog(state) {
  const logs = Array.isArray(state.deviceLogs) ? state.deviceLogs : [];
  return logs.find((log) => log?.source === "appshell.heartbeat") || logs[0] || null;
}

function latestDeviceSramMinimum(state, logicalDeviceId = "esp32-185b") {
  const log = (state.deviceLogs || []).find((item) =>
    item?.source === "appshell.heartbeat" &&
    (!logicalDeviceId || item?.data?.logicalDeviceId === logicalDeviceId)
  );
  const value = Number(log?.data?.minimumFreeInternalSram);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function latestLogBySource(state, source) {
  const logs = Array.isArray(state.deviceLogs) ? state.deviceLogs : [];
  return logs.find((log) => log?.source === source) || null;
}

function isRecentIso(value, maxAgeMs) {
  const time = Date.parse(value || "");
  return Number.isFinite(time) && Date.now() - time <= maxAgeMs;
}

function manifestFiles(manifest) {
  return (manifest.packs || []).flatMap((pack) => (pack.files || []).map((file) => ({ ...file, packId: pack.id })));
}

function buildAcceptanceReadiness(state, config, manifest = buildResourceManifest(state, config)) {
  const acceptanceById = Object.fromEntries(buildAcceptanceStatus(state).items.map((item) => [item.id, item.status]));
  const catalog = Array.isArray(state.content?.catalog) ? state.content.catalog : [];
  const files = manifestFiles(manifest);
  const filePaths = new Set(files.map((file) => file.path));
  const typeItem = (type) => catalog.find((item) => item.type === type && (!item.path || filePaths.has(item.path)));
  const realTypeItem = (type) => catalog.find((item) =>
    item.type === type &&
    (!item.path || filePaths.has(item.path)) &&
    !looksLikeRepresentativeContent(item));
  const tracks = listKnownServerTracks(state, config);
  const recentLog = latestDeviceLog(state);
  const provisionedLog = latestLogBySource(state, "appshell.wifi_provisioned");
  const recentData = recentLog?.data && typeof recentLog.data === "object" ? recentLog.data : {};
  const provisionedData = provisionedLog?.data && typeof provisionedLog.data === "object" ? provisionedLog.data : {};
  const recentBoard = recentData.board && typeof recentData.board === "object" ? recentData.board : {};
  const recentStatus = recentData.status && typeof recentData.status === "object" ? recentData.status : {};
  const recentNetwork = recentStatus.network && typeof recentStatus.network === "object" ? recentStatus.network : {};
  const provisionedRecent = Boolean(provisionedLog && isRecentIso(provisionedLog.at, 15 * 60 * 1000));
  const openclawJobs = Array.isArray(state.openclaw?.jobs) ? state.openclaw.jobs : [];
  const openclawTargetCommands = config.openclawTargetCommands || {};
  const haHistory = Array.isArray(state.integrations?.homeAssistant?.history) ? state.integrations.homeAssistant.history : [];
  const haLatestSuccess = haHistory.find((item) => item.status === "success" || (item.httpCode >= 200 && item.httpCode < 300));
  const defaultSuccess = openclawJobs.find((job) => job.target === "default" && job.status === "success");
  const musicSuccess = openclawJobs.find((job) => job.target === "music" && job.status === "success");
  const albumItem = realTypeItem("album");
  const podcastItem = realTypeItem("podcast");
  const englishItem = realTypeItem("english");
  const gameItem = realTypeItem("game");
  const podcastTrack = podcastItem?.path ? tracks.find((track) => track.path === podcastItem.path || track.id === podcastItem.path) : null;
  const realContentPaths = [albumItem, podcastItem, englishItem, gameItem].map((item) => item?.path).filter(Boolean);
  const realContentFiles = files.filter((file) => realContentPaths.includes(file.path));

  const items = [
    {
      id: "blufi-new-wifi",
      checks: [
        readinessCheck("heartbeat", "收到近期设备心跳", Boolean(recentLog && isRecentIso(recentLog.at, 15 * 60 * 1000)), recentLog?.at || "暂无设备日志"),
        readinessCheck("wifi-provisioned", "收到近期配网专用事件", provisionedRecent, provisionedLog?.at || "missing"),
        readinessCheck("method", "近期配网事件 method=hotspot 或 blufi", provisionedRecent && ["hotspot", "blufi"].includes(provisionedData.method), provisionedRecent ? (provisionedData.method || "missing") : "missing or stale"),
        readinessCheck("ssid", "心跳包含 SSID", Boolean(recentBoard.ssid || recentNetwork.ssid), recentBoard.ssid || recentNetwork.ssid || "missing"),
        readinessCheck("ip", "心跳包含 IP", Boolean(recentBoard.ip), recentBoard.ip || "missing"),
        readinessCheck("rssi", "心跳包含 RSSI/channel", recentBoard.rssi !== undefined && recentBoard.rssi !== null && recentBoard.channel !== undefined && recentBoard.channel !== null, `${recentBoard.rssi ?? "?"}/${recentBoard.channel ?? "?"}`),
        readinessCheck("backend-probe", "后端探针字段存在", Boolean(recentData.backendProbe), recentData.backendProbe || "missing")
      ]
    },
    {
      id: "home-assistant-real-scene",
      checks: [
        readinessCheck("configured", "HA URL/token 已配置", Boolean(config.homeAssistantUrl && config.homeAssistantToken), config.homeAssistantUrl || "HOME_ASSISTANT_URL missing"),
        readinessCheck("scenes", "HA 场景白名单存在", (config.homeAssistantScenes || []).length > 0, (config.homeAssistantScenes || []).join(", ")),
        readinessCheck("success-history", "最近 HA 调用有成功记录", Boolean(haLatestSuccess), haLatestSuccess ? `${haLatestSuccess.entityId || haLatestSuccess.serviceData?.entity_id || ""} http=${haLatestSuccess.httpCode || ""}` : "missing"),
        readinessCheck("history", "HA 调用 history 可查询", haHistory.length > 0, `${haHistory.length} records`)
      ]
    },
    {
      id: "real-family-content",
      checks: [
        readinessCheck("album", "catalog/manifest 有真实相册资源", Boolean(albumItem), albumItem?.path || "missing or sample-only"),
        readinessCheck("podcast", "catalog 有真实播客资源且媒体库可播放", Boolean(podcastItem && (podcastTrack || podcastItem.path)), podcastItem?.path || "missing or sample-only"),
        readinessCheck("english", "catalog/manifest 有真实英语资源", Boolean(englishItem), englishItem?.path || "missing or sample-only"),
        readinessCheck("game", "catalog/manifest 有真实小游戏资源", Boolean(gameItem), gameItem?.path || "missing or sample-only"),
        readinessCheck("manifest", "真实资源 manifest 包含校验文件", realContentFiles.length > 0 && realContentFiles.every((file) => file.sha256 && file.size > 0 && file.contentType), `${realContentFiles.length}/${realContentPaths.length} real files`)
      ]
    },
    {
      id: "openclaw-default-music",
      checks: [
        readinessCheck("command", "OPENCLAW_COMMAND 可执行", commandExecutable(config.openclawCommand), config.openclawCommand || "missing"),
        readinessCheck("default-mapping", "default target command 已配置", Boolean(openclawTargetCommands.default), openclawTargetCommands.default ? "configured" : "OPENCLAW_TARGET_DEFAULT_COMMAND missing"),
        readinessCheck("music-mapping", "music target command 已配置", Boolean(openclawTargetCommands.music), openclawTargetCommands.music ? "configured" : "OPENCLAW_TARGET_MUSIC_COMMAND missing"),
        readinessCheck("default-success", "default target 有 success job", Boolean(defaultSuccess), defaultSuccess?.finishedAt || "missing"),
        readinessCheck("music-success", "music target 有 success job", Boolean(musicSuccess), musicSuccess?.finishedAt || "missing")
      ]
    }
  ].map((item) => ({
    ...item,
    status: readinessStatus(item.checks),
    historicalAcceptanceStatus: acceptanceById[item.id] || "pending",
    historicallyPassed: acceptanceById[item.id] === "passed",
    okCount: item.checks.filter((check) => check.ok).length,
    total: item.checks.length
  }));

  return {
    generatedAt: new Date().toISOString(),
    counts: {
      total: items.length,
      ready: items.filter((item) => item.status === "ready").length,
      partial: items.filter((item) => item.status === "partial").length,
      missing: items.filter((item) => item.status === "missing").length
    },
    items
  };
}

function safeAdminConfig(config) {
  return {
    name: config.name,
    version: config.version,
    host: config.host,
    port: config.port,
    publicBaseUrl: config.publicBaseUrl,
    dataDir: config.dataDir,
    resourceDir: config.resourceDir,
    serverMusicDir: config.serverMusicDir,
    storeDriver: config.storeDriver,
    sqliteFile: config.sqliteFile,
    onlineMedia: {
      providers: config.onlineMediaProviders || [],
      feeds: config.onlineMediaFeeds || [],
      catalogFile: config.onlineMediaCatalogFile,
      allowDirectUrls: Boolean(config.onlineMediaAllowDirectUrls),
      allowPrivateHosts: Boolean(config.onlineMediaAllowPrivateHosts),
      timeoutMs: config.onlineMediaTimeoutMs,
      maxResults: config.onlineMediaMaxResults,
      podcastRefreshIntervalMinutes: config.podcastRefreshIntervalMinutes,
      podcastRefreshBatchSize: config.podcastRefreshBatchSize
    },
    integrations: {
      openclawCommand: config.openclawCommand,
      openclawTargets: config.openclawTargets || [],
      openclawTargetCommands: Object.fromEntries(Object.entries(config.openclawTargetCommands || {}).map(([target, command]) => [target, Boolean(command)])),
      homeAssistantConfigured: Boolean(config.homeAssistantUrl && config.homeAssistantToken),
      homeAssistantUrl: config.homeAssistantUrl || "",
      homeAssistantScenes: config.homeAssistantScenes || [],
      homeAssistantTimeoutMs: config.homeAssistantTimeoutMs,
      nasMusicDir: config.nasMusicDir || ""
    },
    secrets: {
      adminToken: Boolean(config.adminToken),
      xiaozhiToolToken: Boolean(config.xiaozhiToolToken),
      deviceToken: Boolean(config.deviceToken),
      homeAssistantToken: Boolean(config.homeAssistantToken)
    },
    adminSecurity: {
      publicHosts: config.adminPublicHosts || [],
      protectPublicMutations: Boolean(config.adminProtectPublicMutations),
      allowQueryTokens: Boolean(config.allowQueryTokens),
      corsAllowedOrigins: config.corsAllowedOrigins || [],
      cloudflareAccessConfigured: Boolean(config.cloudflareAccessTeamDomain && config.cloudflareAccessAud),
      cloudflareAccessRequired: Boolean(config.cloudflareAccessRequired),
      cloudflareAccessAllowedEmails: config.cloudflareAccessAllowedEmails || []
    }
  };
}

function gatewayToken(req, config) {
  const auth = String(req.get("authorization") || "");
  if (auth.toLowerCase().startsWith("bearer ")) {
    return auth.slice(7).trim();
  }
  const header = String(req.get("x-ai-tool-token") || req.get("x-xiaozhi-tool-token") || "");
  if (header) return header;
  if (config.allowQueryTokens === false) return "";
  const query = String(req.query.token || "");
  if (query) req.deprecatedQueryToken = true;
  return query;
}

function requireAiGatewayToken(req, res, config, store) {
  const token = gatewayToken(req, config);
  const record = token ? verifyAuthToken(store.snapshot(), token, "agent:invoke") : null;
  if (record) {
    store.update((state) => markAuthTokenUsed(state, record.id));
    req.agentAuth = { method: "managed-token", tokenId: record.id };
    return true;
  }
  if (!config.xiaozhiToolToken || token === config.xiaozhiToolToken) {
    if (req.deprecatedQueryToken) {
      res.setHeader("Deprecation", "true");
      res.setHeader("Sunset", "2026-10-01");
      res.setHeader("Warning", '299 - "Query-string tokens are deprecated"');
    }
    return true;
  }
  res.status(401).json({ ok: false, error: "invalid ai tool token" });
  return false;
}

function createApiRouter(store, config, eventBus = null, observability = null) {
  const router = express.Router();
  const adminAuth = adminAuthMiddleware(config, store);
  const requestControls = createRequestControls(config);

  router.use(publicMutationAuthMiddleware(config, store));
  router.use(requestControls.rateLimitMiddleware);
  router.use(requestControls.idempotencyMiddleware);

  function publishMutation(before, after, reason) {
    if (!eventBus) {
      return;
    }
    const beforeKey = notificationKey(before);
    const afterKey = notificationKey(after);
    if (afterKey && afterKey !== beforeKey) {
      eventBus.publish("notification.created", {
        reason,
        notification: compactNotification(after.notifications[0])
      });
      return;
    }
    eventBus.publish("summary.updated", { reason });
  }

  function updateAndPublish(reason, mutator) {
    const before = store.snapshot();
    const snapshot = store.update(mutator);
    publishMutation(before, snapshot, reason);
    return snapshot;
  }

  async function updateAndPublishAsync(reason, mutator) {
    const before = store.snapshot();
    const snapshot = await store.updateAsync(mutator);
    publishMutation(before, snapshot, reason);
    return snapshot;
  }

  function publishDeviceCommandResult(result) {
    if (!result?.accepted || !result.command || !eventBus) {
      return;
    }
    eventBus.publish("device.command.created", {
      command: result.command,
      speech: result.speech || ""
    });
  }

  function agentStatus(result) {
    if (result?.denied) {
      return 403;
    }
    if (result?.accepted && result?.command) {
      return 202;
    }
    if (result?.accepted) {
      return 200;
    }
    return 400;
  }

  function enqueueMediaPlayCommand(state, body, track, origin = "") {
    const tracks = listKnownServerTracks(state, config);
    const index = Math.max(0, tracks.findIndex((item) => item.id === track?.id));
    return enqueueXiaozhiToolCommand(state, config, {
      tool: "family.media.play",
      text: body?.text || body?.query || track?.title || "播放媒体",
      params: {
        trackId: track?.id,
        deviceId: body?.deviceId || body?.device_id || "esp32-185b"
      },
      _resolvedMedia: {
        tracks,
        track,
        index,
        origin: origin || (track?.origin === "online" ? "online" : "local"),
        query: body?.query || track?.title || ""
      }
    });
  }

  registerFamilyRoutes(router, { store, adminAuth, updateAndPublish });
  registerDeviceRoutes(router, { store, config, updateAndPublish, publishMutation, deviceSummary });
  registerAdminRoutes(router, { store, config, adminAuth, observability, requestControls, updateAndPublish });

  router.get("/events", (req, res) => {
    if (!eventBus) {
      res.status(503).json({ ok: false, error: "event bus unavailable" });
      return;
    }
    eventBus.connect(req, res);
  });

  router.get("/events/latest", (req, res) => {
    const state = store.snapshot();
    const latest = eventBus?.latest?.() || null;
    const commands = pendingDeviceCommands(state, req.query.deviceId || req.query.device_id || "esp32-185b", 1);
    res.json({
      ok: true,
      data: {
        event: latest ? {
          id: latest.id,
          type: latest.type,
          at: latest.at,
          data: latest.data
        } : null,
        notification: compactNotification(state.notifications?.[0]),
        notificationKey: notificationKey(state),
        command: commands[0] || null
      }
    });
  });

  router.get("/health", (req, res) => {
    res.json({
      ok: true,
      status: "ok",
      name: config.name,
      version: config.version,
      time: new Date().toISOString(),
      uptimeSec: Math.floor(process.uptime())
    });
  });

  router.get("/device/summary", (req, res) => {
    res.json({ ok: true, data: deviceSummary(snapshotWithServerMedia(store.snapshot(), config), config) });
  });

  router.get("/weather/today", (req, res) => {
    res.json({ ok: true, data: weatherView(store.snapshot().weather) });
  });

  router.post("/weather/refresh", async (req, res, next) => {
    try {
      const before = store.snapshot();
      const result = await refreshWeatherStore(store, config);
      observability?.recordDependency?.("weather.open-meteo", result);
      publishMutation(before, result.snapshot, "weather.refresh");
      res.status(result.ok ? 200 : 503).json({
        ok: result.ok,
        error: result.error || null,
        cached: Boolean(result.cached),
        data: {
          weather: result.weather,
          summary: deviceSummary(snapshotWithServerMedia(result.snapshot, config), config)
        }
      });
    } catch (error) {
      next(error);
    }
  });

  router.get("/schedule/today", (req, res) => {
    const state = store.snapshot();
    res.json({ ok: true, data: { next: nextSchedule(state), today: state.schedule } });
  });

  router.get("/music/state", (req, res) => {
    res.json({ ok: true, data: musicSummary(snapshotWithServerMedia(store.snapshot(), config)) });
  });

  router.get("/media/library", (req, res) => {
    res.json({ ok: true, data: buildMediaLibrary(store.snapshot(), config, { includeDiagnostics: req.query.includeDiagnostics }) });
  });

  router.get("/media/server/tracks", (req, res) => {
    const tracks = filterTracksForView(listKnownServerTracks(store.snapshot(), config), {
      includeDiagnostics: req.query.includeDiagnostics
    }).map((track) => toDeviceTrack(track, config));
    res.json({ ok: true, data: { tracks } });
  });

  router.get("/media/search", async (req, res, next) => {
    try {
      const query = String(req.query.q || req.query.query || "").slice(0, 160);
      const result = await resolveMediaSearch(config, query, store.snapshot());
      let tracks = result.tracks || [];
      if (result.source === "online") {
        const snapshot = updateAndPublish("media.search", (state) => {
          tracks = tracks.map((track) => registerOnlineTrack(state, config, track, result.query)).filter(Boolean);
          state.media.searchHistory.unshift({
            id: `ms_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`,
            at: new Date().toISOString(),
            query: result.query,
            source: result.source,
            count: tracks.length
          });
          state.media.searchHistory = state.media.searchHistory.slice(0, 50);
        });
        res.json({
          ok: true,
          data: { ...result, tracks, summary: deviceSummary(snapshotWithServerMedia(snapshot, config), config) }
        });
        return;
      }
      res.json({ ok: true, data: { ...result, tracks } });
    } catch (error) {
      next(error);
    }
  });

  router.get("/media/queue", (req, res) => {
    res.json({ ok: true, data: listMediaQueue(store.snapshot()) });
  });

  router.post("/media/queue", async (req, res, next) => {
    try {
      const body = req.body || {};
      const query = String(body.query || body.q || "").slice(0, 160);
      const search = query ? await resolveMediaSearch(config, query, store.snapshot()) : null;
      let item = null;
      const snapshot = updateAndPublish("media.queue.add", (state) => {
        let track = null;
        if (body.trackId || body.track_id || body.id) {
          item = addMediaQueueItem(state, config, body);
          return;
        }
        if (search?.tracks?.[0]) {
          track = search.source === "online"
            ? registerOnlineTrack(state, config, search.tracks[0], search.query)
            : search.tracks[0];
        }
        item = addMediaQueueItem(state, config, { ...body, track });
      });
      res.json({ ok: true, data: { item, queue: listMediaQueue(snapshot) } });
    } catch (error) {
      next(error);
    }
  });

  router.post("/media/queue/play", (req, res, next) => {
    try {
      let queueResult = null;
      let commandResult = null;
      const snapshot = updateAndPublish("media.queue.play", (state) => {
        queueResult = playMediaQueueItem(state, config, req.body || {});
        commandResult = enqueueMediaPlayCommand(state, req.body || {}, queueResult.track, "queue");
      });
      res.status(commandResult?.accepted ? 202 : 400).json({
        ok: Boolean(commandResult?.accepted),
        data: {
          queue: listMediaQueue(snapshot),
          item: queueResult?.item || null,
          track: queueResult?.track || null,
          command: commandResult?.command || null,
          summary: deviceSummary(snapshotWithServerMedia(snapshot, config), config)
        }
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/media/queue/next", (req, res, next) => {
    try {
      let queueResult = null;
      let commandResult = null;
      const snapshot = updateAndPublish("media.queue.next", (state) => {
        queueResult = nextMediaQueueItem(state, config, req.body || {});
        if (queueResult?.track) {
          commandResult = enqueueMediaPlayCommand(state, req.body || {}, queueResult.track, "queue");
        } else {
          commandResult = enqueueXiaozhiToolCommand(state, config, {
            tool: "family.podcast.next",
            params: { deviceId: req.body?.deviceId || req.body?.device_id || "esp32-185b" }
          });
        }
      });
      res.status(commandResult?.accepted ? 202 : 400).json({
        ok: Boolean(commandResult?.accepted),
        data: {
          queue: listMediaQueue(snapshot),
          item: queueResult?.item || null,
          track: queueResult?.track || null,
          command: commandResult?.command || null,
          summary: deviceSummary(snapshotWithServerMedia(snapshot, config), config)
        }
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/media/queue/stop", (req, res, next) => {
    try {
      let queue = null;
      let commandResult = null;
      const snapshot = updateAndPublish("media.queue.stop", (state) => {
        queue = stopMediaQueue(state);
        commandResult = enqueueXiaozhiToolCommand(state, config, {
          tool: "family.podcast.stop",
          params: { deviceId: req.body?.deviceId || req.body?.device_id || "esp32-185b" }
        });
      });
      res.status(commandResult?.accepted ? 202 : 400).json({
        ok: Boolean(commandResult?.accepted),
        data: { queue, command: commandResult?.command || null, summary: deviceSummary(snapshot, config) }
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/media/queue/clear", (req, res, next) => {
    try {
      let queue = null;
      const snapshot = updateAndPublish("media.queue.clear", (state) => {
        queue = clearMediaQueue(state, req.body || {});
      });
      res.json({ ok: true, data: { queue, summary: deviceSummary(snapshotWithServerMedia(snapshot, config), config) } });
    } catch (error) {
      next(error);
    }
  });

  router.patch("/media/queue/:id", (req, res, next) => {
    try {
      let queue = null;
      const snapshot = updateAndPublish("media.queue.move", (state) => {
        queue = moveMediaQueueItem(state, req.params.id, req.body?.direction || req.body?.move || "up");
      });
      res.json({ ok: true, data: { queue, summary: deviceSummary(snapshotWithServerMedia(snapshot, config), config) } });
    } catch (error) {
      next(error);
    }
  });

  router.delete("/media/queue/:id", (req, res, next) => {
    try {
      let queue = null;
      const snapshot = updateAndPublish("media.queue.remove", (state) => {
        queue = removeMediaQueueItem(state, req.params.id);
      });
      res.json({ ok: true, data: { queue, summary: deviceSummary(snapshotWithServerMedia(snapshot, config), config) } });
    } catch (error) {
      next(error);
    }
  });

  router.get("/media/favorites", (req, res) => {
    res.json({ ok: true, data: { favorites: listMediaFavorites(store.snapshot()) } });
  });

  router.post("/media/favorites", (req, res, next) => {
    try {
      let favorite = null;
      const snapshot = updateAndPublish("media.favorite.add", (state) => {
        const body = req.body || {};
        const current = state.music?.server?.tracks?.[state.music.server.currentIndex || 0] || null;
        favorite = addMediaFavorite(state, config, body.trackId || body.track_id || body.id ? body : { ...body, track: current });
      });
      res.json({ ok: true, data: { favorite, favorites: listMediaFavorites(snapshot) } });
    } catch (error) {
      next(error);
    }
  });

  router.delete("/media/favorites/:id", (req, res, next) => {
    try {
      let result = null;
      const snapshot = updateAndPublish("media.favorite.delete", (state) => {
        result = deleteMediaFavorite(state, req.params.id);
      });
      res.json({ ok: true, data: { result, favorites: listMediaFavorites(snapshot) } });
    } catch (error) {
      next(error);
    }
  });

  router.get("/media/resume", (req, res) => {
    res.json({
      ok: true,
      data: {
        candidates: listResumeCandidates(store.snapshot(), config, req.query)
      }
    });
  });

  router.post("/media/resume", (req, res, next) => {
    try {
      const candidate = resolveResumeCandidate(store.snapshot(), config, req.body || {});
      let result = null;
      const snapshot = updateAndPublish("media.resume", (state) => {
        result = enqueueXiaozhiToolCommand(state, config, {
          tool: "family.podcast.resume",
          text: req.body?.text || "继续播放上次没听完",
          params: {
            ...(req.body || {}),
            trackId: req.body?.trackId || req.body?.track_id || candidate?.trackId,
            deviceId: req.body?.deviceId || req.body?.device_id || "esp32-185b"
          }
        });
      });
      res.status(result?.accepted ? 202 : 404).json({
        ok: Boolean(result?.accepted),
        data: {
          ...result,
          candidate,
          candidates: listResumeCandidates(snapshot, config, { deviceId: req.body?.deviceId || req.body?.device_id || "" }),
          summary: deviceSummary(snapshotWithServerMedia(snapshot, config), config)
        }
      });
    } catch (error) {
      next(error);
    }
  });

  router.get("/media/server/progress", (req, res) => {
    res.json({
      ok: true,
      data: {
        progress: listMediaProgress(store.snapshot(), config, req.query)
      }
    });
  });

  router.post("/media/server/progress", (req, res, next) => {
    try {
      let item = null;
      const snapshot = updateAndPublish("media.progress", (state) => {
        item = upsertMediaProgress(state, config, req.body || {});
      });
      res.json({
        ok: true,
        data: {
          item,
          progress: listMediaProgress(snapshot, config, { deviceId: req.body?.deviceId || req.body?.device_id || "" })
        }
      });
    } catch (error) {
      next(error);
    }
  });

  router.patch("/media/server/progress/:trackId", (req, res, next) => {
    try {
      let item = null;
      const snapshot = updateAndPublish("media.progress.update", (state) => {
        item = upsertMediaProgress(state, config, {
          ...(req.body || {}),
          trackId: req.params.trackId
        });
      });
      res.json({
        ok: true,
        data: {
          item,
          progress: listMediaProgress(snapshot, config, { trackId: req.params.trackId })
        }
      });
    } catch (error) {
      next(error);
    }
  });

  router.delete("/media/server/progress/:trackId", (req, res, next) => {
    try {
      let result = null;
      const snapshot = updateAndPublish("media.progress.delete", (state) => {
        result = deleteMediaProgress(state, req.params.trackId, req.query || {});
      });
      res.json({
        ok: true,
        data: {
          result,
          progress: listMediaProgress(snapshot, config, { trackId: req.params.trackId })
        }
      });
    } catch (error) {
      next(error);
    }
  });

  router.get("/media/server/stream/:id", (req, res, next) => {
    const filePath = serverTrackFile(config, req.params.id);
    if (!filePath) {
      res.status(404).json({ ok: false, error: "media track not found" });
      return;
    }
    const stat = fs.statSync(filePath);
    const total = stat.size;
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Cache-Control", "public, max-age=0");
    res.type(audioContentType(filePath));

    const range = req.headers.range;
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!match) {
        res.status(416).setHeader("Content-Range", `bytes */${total}`).end();
        return;
      }
      let start = match[1] === "" ? 0 : Number(match[1]);
      let end = match[2] === "" ? total - 1 : Number(match[2]);
      if (match[1] === "" && match[2] !== "") {
        const suffixLength = Math.max(0, Number(match[2]));
        start = Math.max(0, total - suffixLength);
        end = total - 1;
      }
      if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= total) {
        res.status(416).setHeader("Content-Range", `bytes */${total}`).end();
        return;
      }
      end = Math.min(end, total - 1);
      res.status(206);
      res.setHeader("Content-Range", `bytes ${start}-${end}/${total}`);
      res.setHeader("Content-Length", String(end - start + 1));
      fs.createReadStream(filePath, { start, end }).on("error", next).pipe(res);
      return;
    }

    res.setHeader("Content-Length", String(total));
    fs.createReadStream(filePath).on("error", next).pipe(res);
  });

  router.get("/media/online/stream/:id", async (req, res, next) => {
    try {
      const track = findOnlineTrack(store.snapshot(), config, req.params.id);
      if (!track) {
        res.status(404).json({ ok: false, error: "online media track not found" });
        return;
      }
      await proxyRemoteAudio(res, track, req.headers, config);
    } catch (error) {
      next(error);
    }
  });

  router.get("/apps", (req, res) => {
    res.json({ ok: true, data: store.snapshot().apps });
  });

  router.get("/english/session", (req, res) => {
    res.json({ ok: true, data: store.snapshot().english });
  });

  router.get("/content/catalog", (req, res) => {
    res.json({
      ok: true,
      data: catalogView(store.snapshot(), req.query.type || "", {
        includeDiagnostics: req.query.includeDiagnostics
      })
    });
  });

  router.post("/content/seed", (req, res, next) => {
    try {
      let result = null;
      const snapshot = updateAndPublish("content.seed", (state) => {
        result = seedContent(state, config);
        state.resources = state.resources || {};
        state.resources.version = Number(state.resources.version || 1) + 1;
        state.resources.manifestVersion = new Date().toISOString().slice(0, 10).replace(/-/g, ".");
        state.resources.lastImportAt = result.seededAt;
      });
      res.json({ ok: true, data: { result, manifest: buildResourceManifest(snapshot, config) } });
    } catch (error) {
      next(error);
    }
  });

  router.post("/content/import", (req, res, next) => {
    let result = null;
    try {
      const snapshot = updateAndPublish("content.import", (state) => {
        result = importContent(state, config, req.body);
        state.resources = state.resources || {};
        state.resources.version = Number(state.resources.version || 1) + 1;
        state.resources.manifestVersion = new Date().toISOString().slice(0, 10).replace(/-/g, ".");
        state.resources.lastImportAt = new Date().toISOString();
        state.resources.lastImport = result.file || result.item;
      });
      res.json({ ok: true, data: { result, manifest: buildResourceManifest(snapshot, config) } });
    } catch (error) {
      if (result?.file?.path) {
        try {
          deleteResourceFile(config, result.file.path);
        } catch {
          // Preserve the import or persistence error.
        }
      }
      next(error);
    }
  });

  router.get("/content/packs", (req, res) => {
    const state = store.snapshot();
    res.json({ ok: true, data: { packs: state.content?.packs || [], catalogCount: state.content?.catalog?.length || 0 } });
  });

  router.get("/notifications", (req, res) => {
    res.json({ ok: true, data: store.snapshot().notifications });
  });

  router.get("/integrations/status", (req, res) => {
    const state = store.snapshot();
    res.json({
      ok: true,
      data: {
        openclaw: {
          configured: commandExecutable(config.openclawCommand),
          sourceStatus: executionSourceStatus(commandExecutable(config.openclawCommand)),
          command: config.openclawCommand,
          allowedTargets: config.openclawTargets || [],
          jobs: state.openclaw?.jobs?.slice(0, 20) || [],
          tasks: state.openclaw?.tasks || []
        },
        homeAssistant: {
          configured: Boolean(config.homeAssistantUrl && config.homeAssistantToken),
          sourceStatus: executionSourceStatus(
            Boolean(config.homeAssistantUrl && config.homeAssistantToken),
            !config.homeAssistantUrl || !config.homeAssistantToken
          ),
          lastActionAt: state.integrations?.homeAssistant?.lastActionAt || null,
          history: state.integrations?.homeAssistant?.history?.slice(0, 20) || []
        },
        nas: {
          configured: Boolean(config.nasMusicDir),
          sourceStatus: executionSourceStatus(Boolean(config.nasMusicDir)),
          lastScanAt: state.integrations?.nas?.lastScanAt || null,
          history: state.integrations?.nas?.history?.slice(0, 20) || []
        },
        weather: {
          configured: config.weatherProvider === "open-meteo",
          sourceStatus: weatherSourceStatus(state.weather, config.weatherProvider),
          provider: state.weather?.provider || config.weatherProvider,
          updatedAt: state.weather?.updatedAt || null,
          lastRefreshError: state.weather?.lastRefreshError || null
        },
        media: {
          configured: true,
          sourceStatus: filterTracksForView(listKnownServerTracks(state, config)).length ? "real" : "simulated"
        }
      }
    });
  });

  router.get("/openclaw/jobs", (req, res) => {
    const state = store.snapshot();
    res.json({
      ok: true,
      data: {
        configured: commandExecutable(config.openclawCommand),
        command: config.openclawCommand,
        allowedTargets: config.openclawTargets || [],
        jobs: state.openclaw?.jobs || [],
        tasks: state.openclaw?.tasks || []
      }
    });
  });

  router.get("/screensaver/state", (req, res) => {
    res.json({ ok: true, data: store.snapshot().screensaver });
  });

  router.post("/device/context", (req, res, next) => {
    try {
      let context = null;
      updateAndPublish("device.context", (state) => {
        context = updateDeviceContext(state, req.body || {});
      });
      res.json({ ok: true, data: { context } });
    } catch (error) {
      next(error);
    }
  });

  router.get("/device/context/:deviceId", (req, res) => {
    if (!requireAiGatewayToken(req, res, config, store)) {
      return;
    }
    const result = deviceContext(store.snapshot(), req.params.deviceId, config.aiDeviceContextTtlMs);
    res.status(result.context ? 200 : 404).json({ ok: Boolean(result.context), data: result });
  });

  router.post("/ai/traces", (req, res, next) => {
    if (!requireAiGatewayToken(req, res, config, store)) {
      return;
    }
    try {
      let trace = null;
      updateAndPublish("ai.trace", (state) => {
        trace = upsertAiTrace(state, req.body || {}, {
          limit: config.aiTraceLimit,
          storeText: config.aiTraceStoreText
        });
      });
      res.json({ ok: true, data: { trace } });
    } catch (error) {
      next(error);
    }
  });

  router.get("/ui/schema", (req, res) => {
    res.json({ ok: true, data: COMPONENT_SCHEMA });
  });

  router.get("/ui/capabilities", (req, res) => {
    res.json({
      ok: true,
      data: {
        schemaVersion: COMPONENT_SCHEMA.schemaVersion,
        deviceProfile: COMPONENT_SCHEMA.deviceProfile,
        components: COMPONENT_SCHEMA.components,
        actions: COMPONENT_SCHEMA.actions,
        layouts: COMPONENT_SCHEMA.layouts,
        themeTokens: COMPONENT_SCHEMA.themeTokens,
        limits: COMPONENT_SCHEMA.limits
      }
    });
  });

  router.get("/ui/page/:page", (req, res) => {
    const summary = deviceSummary(snapshotWithServerMedia(store.snapshot(), config), config);
    res.json({ ok: true, data: buildPage(req.params.page, summary) });
  });

  router.get("/resources/manifest", (req, res) => {
    res.json({ ok: true, data: buildResourceManifest(store.snapshot(), config) });
  });

  router.get("/resources/file/*", (req, res, next) => {
    const filePath = resourceFilePath(config, req.params[0]);
    if (!filePath) {
      res.status(400).json({ ok: false, error: "invalid resource path" });
      return;
    }
    res.sendFile(filePath, (error) => {
      if (error) {
        next(error);
      }
    });
  });

  function importResource(req, res, next) {
    try {
      const relativePath = req.body?.path || req.body?.relativePath;
      const contentBase64 = req.body?.contentBase64 || req.body?.base64 || "";
      const content = Buffer.from(String(contentBase64), "base64");
      const file = writeResourceFile(config, relativePath, content);
      const snapshot = updateAndPublish("resources.import", (state) => {
        state.resources = state.resources || {};
        state.resources.version = Number(state.resources.version || 1) + 1;
        state.resources.manifestVersion = new Date().toISOString().slice(0, 10).replace(/-/g, ".");
        state.resources.lastImportAt = new Date().toISOString();
        state.resources.lastImport = file;
      });
      res.json({
        ok: true,
        data: {
          file,
          manifest: buildResourceManifest(snapshot, config)
        }
      });
    } catch (error) {
      next(error);
    }
  }

  router.post("/resources/import", importResource);
  router.post("/usb/import", importResource);

  router.delete("/resources/file/*", adminAuth, (req, res, next) => {
    try {
      const file = deleteResourceFile(config, req.params[0]);
      const snapshot = updateAndPublish("resources.delete", (state) => {
        state.resources = state.resources || {};
        state.resources.version = Number(state.resources.version || 1) + 1;
        state.resources.manifestVersion = new Date().toISOString().slice(0, 10).replace(/-/g, ".");
        state.resources.lastImportAt = new Date().toISOString();
        state.resources.lastImport = `deleted:${file.path}`;
      });
      res.json({
        ok: true,
        data: {
          file,
          manifest: buildResourceManifest(snapshot, config)
        }
      });
    } catch (error) {
      next(error);
    }
  });

  router.get("/memory", adminAuth, (req, res) => {
    res.json({ ok: true, data: { items: listMemory(store.snapshot(), req.query) } });
  });

  router.post("/memory", adminAuth, (req, res, next) => {
    try {
      let item = null;
      const snapshot = updateAndPublish("memory.create", (state) => {
        item = createMemory(state, req.body);
      });
      res.json({ ok: true, data: { item, summary: deviceSummary(snapshot, config) } });
    } catch (error) {
      next(error);
    }
  });

  router.patch("/memory/:id", adminAuth, (req, res, next) => {
    try {
      let item = null;
      const snapshot = updateAndPublish("memory.update", (state) => {
        item = updateMemory(state, req.params.id, req.body);
      });
      res.json({ ok: true, data: { item, summary: deviceSummary(snapshot, config) } });
    } catch (error) {
      next(error);
    }
  });

  router.delete("/memory/:id", adminAuth, (req, res, next) => {
    try {
      let item = null;
      const snapshot = updateAndPublish("memory.delete", (state) => {
        item = deleteMemory(state, req.params.id);
      });
      res.json({ ok: true, data: { item, summary: deviceSummary(snapshot, config) } });
    } catch (error) {
      next(error);
    }
  });

  router.get("/learning/records", (req, res) => {
    res.json({ ok: true, data: { records: listLearningRecords(store.snapshot(), req.query) } });
  });

  router.get("/agent/capabilities", (req, res) => {
    res.json({ ok: true, data: listCapabilities() });
  });

  router.post("/agent/tools/:name", async (req, res, next) => {
    if (!requireAiGatewayToken(req, res, config, store)) {
      return;
    }
    try {
      const name = req.params.name;
      const args = normalizeArgs(req.body?.args || req.body?.params || req.body || {});
      const context = normalizeContext(store.snapshot(), {
        ...(req.body || {}),
        requestId: req.body?.requestId || req.body?.request_id || req.requestId,
        source: req.body?.source || "agent.tool"
      });
      const prepared = await prepareCapability(name, args, store.snapshot(), config, context);
      let result = null;
      const snapshot = await updateAndPublishAsync(`agent.tool.${name}`, async (state) => {
        result = await executeCapability(state, config, name, args, context, prepared);
      });
      publishDeviceCommandResult(result);
      res.status(agentStatus(result)).json({
        ok: Boolean(result?.accepted),
        data: {
          ...result,
          summary: deviceSummary(snapshotWithServerMedia(snapshot, config), config)
        }
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/agent/ask", async (req, res, next) => {
    if (!requireAiGatewayToken(req, res, config, store)) {
      return;
    }
    const startedAt = Date.now();
    const traceId = String(req.body?.traceId || req.body?.trace_id || `trace_${crypto.randomBytes(12).toString("hex")}`).slice(0, 96);
    let contextResolution = null;
    let plan = null;
    try {
      contextResolution = agentBodyWithDeviceContext(
        store.snapshot(),
        { requestId: req.body?.requestId || req.body?.request_id || req.get("x-request-id") || "", ...(req.body || {}), traceId },
        config.aiDeviceContextTtlMs
      );
      if (!contextResolution.contextFresh) {
        res.status(428).json({
          ok: false,
          error: "page_context_required",
          data: {
            traceId,
            contextRequired: true,
            contextSource: contextResolution.contextSource,
            contextAgeMs: contextResolution.contextAgeMs
          }
        });
        return;
      }
      const planStartedAt = Date.now();
      plan = await planAgentRequest(store.snapshot(), config, contextResolution.body);
      const planMs = Date.now() - planStartedAt;
      if (!plan.tool) {
        const modelTier = modelTierForFallback(contextResolution.body.utterance || contextResolution.body.text, plan.fallbackReason);
        const totalMs = Date.now() - startedAt;
        const snapshot = updateAndPublish(`agent.ask.${plan.agent}.${plan.intent}.context`, (state) => {
          recordAgentInteraction(state, {
            memberId: plan.context.memberId,
            page: plan.page,
            agent: plan.agent,
            intent: plan.intent,
            utterance: req.body?.utterance || req.body?.text || "",
            speech: plan.speech,
            storeConversationText: config.aiStoreConversationText
          });
          upsertAiTrace(state, {
            traceId,
            sessionId: plan.sessionId,
            deviceId: contextResolution.body.deviceId,
            page: plan.page,
            familyMode: contextResolution.body.familyMode,
            stage: "backend_complete",
            status: "fallback",
            agent: plan.agent,
            intent: plan.intent,
            handled: false,
            fallbackReason: plan.fallbackReason,
            modelTier,
            modelName: modelTier === "complex" ? config.aiComplexModel : config.aiLightweightModel,
            utterance: contextResolution.body.utterance || contextResolution.body.text,
            contextSource: contextResolution.contextSource,
            timings: {
              planMs,
              backendMs: totalMs,
              sramMinBytes: latestDeviceSramMinimum(state, contextResolution.body.deviceId)
            }
          }, { limit: config.aiTraceLimit, storeText: config.aiTraceStoreText });
        });
        res.json({
          ok: true,
          data: {
            handled: plan.handled,
            fallbackReason: plan.fallbackReason,
            traceId,
            sessionId: plan.sessionId,
            contextSource: contextResolution.contextSource,
            contextAgeMs: contextResolution.contextAgeMs,
            modelTier,
            modelName: modelTier === "complex" ? config.aiComplexModel : config.aiLightweightModel,
            timings: { planMs, backendMs: totalMs },
            agent: plan.agent,
            page: plan.page,
            intent: plan.intent,
            confidence: plan.confidence,
            speech: plan.speech,
            display: plan.display,
            actions: [],
            handoff: plan.handoff,
            requiresConfirmation: plan.requiresConfirmation,
            memberContext: plan.memberContext,
            summary: deviceSummary(snapshotWithServerMedia(snapshot, config), config)
          }
        });
        return;
      }

      const preparedStartedAt = Date.now();
      const prepared = await prepareCapability(plan.tool, plan.args, store.snapshot(), config, plan.context);
      const prepareMs = Date.now() - preparedStartedAt;
      let result = null;
      let responseSpeech = plan.speech;
      let toolMs = 0;
      const snapshot = await updateAndPublishAsync(`agent.ask.${plan.agent}.${plan.intent}`, async (state) => {
        const toolStartedAt = Date.now();
        result = await executeCapability(state, config, plan.tool, plan.args, plan.context, prepared);
        toolMs = Date.now() - toolStartedAt;
        responseSpeech = personalizeSpeech(result?.speech || plan.speech, plan.memberContext);
        recordAgentInteraction(state, {
          memberId: plan.context.memberId,
          page: plan.page,
          agent: plan.agent,
          intent: plan.intent,
          utterance: req.body?.utterance || req.body?.text || "",
          speech: responseSpeech,
          storeConversationText: config.aiStoreConversationText
        });
        upsertAiTrace(state, {
          traceId,
          sessionId: plan.sessionId,
          deviceId: contextResolution.body.deviceId,
          page: plan.page,
          familyMode: contextResolution.body.familyMode,
          stage: "backend_complete",
          status: result?.accepted ? "handled" : "failed",
          agent: plan.agent,
          intent: plan.intent,
          handled: true,
          utterance: contextResolution.body.utterance || contextResolution.body.text,
          contextSource: contextResolution.contextSource,
          timings: {
            planMs,
            prepareMs,
            toolMs,
            backendMs: Date.now() - startedAt,
            sramMinBytes: latestDeviceSramMinimum(state, contextResolution.body.deviceId)
          }
        }, { limit: config.aiTraceLimit, storeText: config.aiTraceStoreText });
      });
      publishDeviceCommandResult(result);

      const action = {
        tool: plan.tool,
        intent: plan.intent,
        status: result?.status || (result?.accepted ? "accepted" : "failed"),
        accepted: Boolean(result?.accepted),
        result: {
          commandId: result?.command?.id || "",
          command: result?.command || null,
          track: result?.track || null,
          progress: result?.progress || null,
          item: result?.result?.item || null,
          reason: result?.reason || ""
        }
      };

      res.status(agentStatus(result)).json({
        ok: Boolean(result?.accepted),
        data: {
          handled: true,
          fallbackReason: "",
          requestId: plan.requestId,
          traceId,
          sessionId: plan.sessionId,
          contextSource: contextResolution.contextSource,
          contextAgeMs: contextResolution.contextAgeMs,
          modelTier: "none",
          modelName: "",
          timings: { planMs, prepareMs, toolMs, backendMs: Date.now() - startedAt },
          agent: plan.agent,
          page: plan.page,
          intent: plan.intent,
          confidence: plan.confidence,
          speech: responseSpeech,
          display: {
            ...(plan.display || {}),
            ...(result?.display || {})
          },
          actions: [action],
          handoff: plan.handoff,
          requiresConfirmation: plan.requiresConfirmation,
          memberContext: plan.memberContext,
          denied: Boolean(result?.denied),
          reason: result?.reason || "",
          summary: deviceSummary(snapshotWithServerMedia(snapshot, config), config)
        }
      });
    } catch (error) {
      try {
        store.update((state) => {
          upsertAiTrace(state, {
            traceId,
            sessionId: plan?.sessionId || req.body?.sessionId,
            deviceId: contextResolution?.body?.deviceId || req.body?.deviceId,
            page: plan?.page || contextResolution?.body?.page,
            familyMode: contextResolution?.body?.familyMode,
            stage: "backend_error",
            status: "failed",
            errorType: error?.name || "Error",
            timings: { backendMs: Date.now() - startedAt }
          }, { limit: config.aiTraceLimit, storeText: false });
        });
      } catch (traceError) {
        // The original request error remains authoritative.
      }
      next(error);
    }
  });

  router.get("/ota/manifest", (req, res) => {
    res.json({ ok: true, data: buildOtaManifest(store.snapshot(), config) });
  });

  router.get("/compatibility", (req, res) => {
    res.json({ ok: true, data: buildCompatibility(store.snapshot()) });
  });

  router.get("/acceptance/status", (req, res) => {
    res.json({ ok: true, data: buildAcceptanceStatus(store.snapshot()) });
  });

  router.get("/acceptance/readiness", (req, res) => {
    const state = store.snapshot();
    res.json({ ok: true, data: buildAcceptanceReadiness(state, config, buildResourceManifest(state, config)) });
  });

  router.get("/diagnostics/report", (req, res) => {
    const state = store.snapshot();
    const manifest = buildResourceManifest(state, config);
    const eventStats = eventBus?.stats?.() || { clients: 0, nextId: null, latest: eventBus?.latest?.() || null };
    const latestOpenClawJob = state.openclaw?.jobs?.[0] || null;
    const recentDeviceLog = state.deviceLogs?.[0] || null;
    const recentDeviceData = recentDeviceLog?.data && typeof recentDeviceLog.data === "object" ? recentDeviceLog.data : {};
    const recentBoard = recentDeviceData.board && typeof recentDeviceData.board === "object" ? recentDeviceData.board : {};
    const recentStatus = recentDeviceData.status && typeof recentDeviceData.status === "object" ? recentDeviceData.status : {};
    const recentNetwork = recentStatus.network && typeof recentStatus.network === "object" ? recentStatus.network : {};
    res.json({
      ok: true,
      data: {
        generatedAt: new Date().toISOString(),
        backend: {
          name: config.name,
          version: config.version,
          uptimeSec: Math.floor(process.uptime()),
          storeDriver: store.driver || "json",
          storeFile: store.filePath
        },
        deviceSummary: deviceSummary(snapshotWithServerMedia(state, config), config),
        integrationStatus: {
          openclawConfigured: commandExecutable(config.openclawCommand),
          openclawCommand: config.openclawCommand,
          openclawAllowedTargets: config.openclawTargets || [],
          openclawLatestJob: latestOpenClawJob,
          homeAssistantConfigured: Boolean(config.homeAssistantUrl && config.homeAssistantToken),
          nasConfigured: Boolean(config.nasMusicDir)
        },
        eventStatus: {
          latest: eventStats.latest,
          sseClients: eventStats.clients,
          nextId: eventStats.nextId,
          latestNotificationKey: notificationKey(state),
          latestNotification: compactNotification(state.notifications?.[0]),
          probePath: "/api/events/latest"
        },
        commandStatus: {
          pending: pendingDeviceCommands(state, "esp32-185b", 8),
          history: ensureDeviceCommandState(state).history.slice(0, 20),
          stats: ensureDeviceCommandState(state).stats
        },
        contentStatus: {
          catalogCount: state.content?.catalog?.length || 0,
          packCount: state.content?.packs?.length || 0,
          lastSeedAt: state.content?.lastSeedAt || null,
          lastImportAt: state.content?.lastImportAt || null
        },
        resourceStatus: {
          version: manifest.version,
          packCount: manifest.packs?.length || 0,
          fileCount: (manifest.packs || []).reduce((sum, pack) => sum + (pack.files?.length || 0), 0),
          diagnostics: manifest.diagnostics || {}
        },
        esp32Status: {
          latestLogAt: recentDeviceLog?.at || null,
          bootId: recentDeviceLog?.bootId || recentDeviceData.bootId || recentDeviceData.boot_id || null,
          bootSequence: recentDeviceLog?.bootSequence ?? recentDeviceData.bootSequence ?? recentDeviceData.boot_sequence ?? null,
          uptimeSec: recentDeviceLog?.uptimeSec ?? recentDeviceData.uptimeSec ?? recentDeviceData.uptime_sec ?? null,
          firmwareBuild: recentDeviceLog?.firmwareBuild || recentDeviceData.firmwareBuild || recentDeviceData.firmware_build || null,
          requestId: recentDeviceLog?.requestId || recentDeviceData.requestId || recentDeviceData.request_id || null,
          recentMemory: recentDeviceLog?.memory || recentDeviceLog?.heap || {
            freeHeap: recentDeviceData.freeHeap ?? null,
            minimumFreeHeap: recentDeviceData.minimumFreeHeap ?? null
          },
          wakeReason: recentDeviceLog?.wakeReason || recentDeviceData.wakeReason || null,
          backendProbe: recentDeviceLog?.backendProbe || recentDeviceData.backendProbe || null,
          backendRefresh: recentDeviceData.backendRefresh || null,
          backendAction: recentDeviceData.backendAction || null,
          resetReason: recentDeviceLog?.resetReason || recentDeviceData.resetReason || null,
          panicSummary: recentDeviceLog?.panicSummary || recentDeviceData.panicSummary || null,
          network: {
            ssid: recentBoard.ssid || recentNetwork.ssid || "",
            ip: recentBoard.ip || "",
            rssi: recentBoard.rssi ?? null,
            channel: recentBoard.channel ?? null,
            signal: recentNetwork.signal || ""
          },
          note: "ESP32 运行指标以固件设置-诊断页为准；后端在收到设备日志后汇总。"
        },
        bootStatus: {
          sessions: (state.deviceBoots || []).slice(0, 20),
          sessionCount: (state.deviceBoots || []).length
        },
        metrics: observability?.snapshot?.() || null,
        remoteUi: {
          schemaVersion: COMPONENT_SCHEMA.schemaVersion,
          pages: ["home", "apps", "english", "album", "settings"],
          compatibilityPages: ["content"]
        },
        memoryStatus: {
          memoryCount: state.memory?.items?.filter((item) => !item.deletedAt).length || 0,
          learningRecordCount: state.learning?.records?.length || 0
        },
        aiRuntime: {
          stats: state.aiRuntime?.stats || {},
          deviceContexts: Object.values(state.aiRuntime?.deviceContexts || {}),
          recentTraces: listAiTraces(state, { limit: 20 })
        },
        acceptanceStatus: buildAcceptanceStatus(state),
        acceptanceReadiness: buildAcceptanceReadiness(state, config, manifest),
        resourceManifest: manifest,
        recentLogs: state.deviceLogs?.slice(0, 20) || [],
        recentAudit: state.security?.audit?.slice(0, 20) || []
      }
    });
  });

  router.post("/sync/push", (req, res) => {
    let pushResult = null;
    const snapshot = updateAndPublish("sync.push", (state) => {
      pushResult = applyPushedEvents(state, req.body);
    });
    res.json({
      ok: true,
      data: {
        result: pushResult,
        summary: buildPullPayload(snapshot, config)
      }
    });
  });

  router.get("/sync/pull", (req, res) => {
    res.json({ ok: true, data: buildPullPayload(store.snapshot(), config) });
  });

  router.post("/action", async (req, res, next) => {
    const name = normalizeActionName(req.body);
    const params = {
      ...normalizeParams(req.body),
      requestId: req.body?.requestId || req.body?.request_id || req.requestId
    };
    try {
      if (name === "weather.refresh") {
        const before = store.snapshot();
        const result = await refreshWeatherStore(store, config);
        observability?.recordDependency?.("weather.open-meteo", result);
        publishMutation(before, result.snapshot, "weather.refresh");
        res.json({
          ok: result.ok,
          action: name,
          cached: Boolean(result.cached),
          error: result.error || null,
          data: deviceSummary(snapshotWithServerMedia(result.snapshot, config), config)
        });
        return;
      }
      const snapshot = updateAndPublish(`action.${name || "unknown"}`, (state) => handleAction(state, name, params, config));
      res.json({
        ok: true,
        action: name,
        data: deviceSummary(snapshotWithServerMedia(snapshot, config), config)
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/intent", (req, res, next) => {
    const text = req.body?.text || req.body?.transcript || req.body?.intent || "";
    try {
      const snapshot = updateAndPublish("intent.voice", (state) => handleAction(state, "voice.intent", {
        ...normalizeParams(req.body),
        text,
        memberId: req.body?.memberId,
        role: req.body?.role
      }, config));
      res.json({
        ok: true,
        data: deviceSummary(snapshotWithServerMedia(snapshot, config), config)
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/ai/xiaozhi/tool", async (req, res, next) => {
    if (!requireAiGatewayToken(req, res, config, store)) {
      return;
    }
    try {
      let result = null;
      const body = req.body || {};
      const resolvedMedia = await resolveServerMediaForCommand(store.snapshot(), config, body);
      const before = store.snapshot();
      const snapshot = store.update((state) => {
        result = enqueueXiaozhiToolCommand(state, config, {
          ...body,
          requestId: body.requestId || req.requestId,
          _resolvedMedia: resolvedMedia
        });
      });
      publishMutation(before, snapshot, "xiaozhi.tool");
      if (result?.accepted && eventBus) {
        eventBus.publish("device.command.created", {
          command: result.command,
          speech: result.speech || ""
        });
      }
      res.status(result?.accepted ? 202 : 400).json({
        ok: Boolean(result?.accepted),
        data: {
          ...result,
          summary: deviceSummary(snapshotWithServerMedia(snapshot, config), config)
        }
      });
    } catch (error) {
      next(error);
    }
  });

  router.use("/admin", adminAuth);

  router.get("/admin/ai/traces", (req, res) => {
    const state = store.snapshot();
    res.json({
      ok: true,
      data: {
        stats: state.aiRuntime?.stats || {},
        deviceContexts: Object.values(state.aiRuntime?.deviceContexts || {}),
        traces: listAiTraces(state, req.query)
      }
    });
  });

  router.get("/admin/config", (req, res) => {
    res.json({ ok: true, data: safeAdminConfig(config) });
  });

  router.get("/admin/acceptance/evidence-pack", (req, res) => {
    const state = store.snapshot();
    const manifest = buildResourceManifest(state, config);
    const status = buildAcceptanceStatus(state);
    const readiness = buildAcceptanceReadiness(state, config, manifest);
    const items = String(req.query.items || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    res.json({
      ok: true,
      data: buildAcceptanceEvidencePack({
        status,
        readiness,
        diagnostics: {
          generatedAt: new Date().toISOString(),
          backend: {
            name: config.name,
            version: config.version,
            uptimeSec: Math.floor(process.uptime()),
            storeDriver: store.driver || "json"
          }
        },
        deviceLogs: state.deviceLogs?.slice(0, 20) || [],
        integrations: state.integrations || {},
        openclawJobs: state.openclaw?.jobs?.slice(0, 20) || [],
        commandStatus: {
          pending: pendingDeviceCommands(state, "esp32-185b", 8),
          history: ensureDeviceCommandState(state).history.slice(0, 20),
          stats: ensureDeviceCommandState(state).stats
        },
        recentAudit: state.security?.audit?.slice(0, 20) || [],
        manifest,
        catalog: state.content?.catalog || []
      }, { items })
    });
  });

  router.post("/admin/acceptance/:id/evidence", (req, res, next) => {
    try {
      let result = null;
      const snapshot = updateAndPublish(`admin.acceptance.${req.params.id}`, (state) => {
        result = recordAcceptanceEvidence(state, req.params.id, req.body || {});
      });
      res.json({
        ok: true,
        data: {
          ...result,
          summary: deviceSummary(snapshotWithServerMedia(snapshot, config), config)
        }
      });
    } catch (error) {
      next(error);
    }
  });

  router.get("/admin/media", (req, res) => {
    const state = store.snapshot();
    const library = buildMediaLibrary(state, config, { includeDiagnostics: true });
    res.json({
      ok: true,
      data: {
        ...library,
        localCount: library.localTracks.length,
        config: safeAdminConfig(config).onlineMedia
      }
    });
  });

  router.get("/admin/podcasts/feeds", (req, res) => {
    res.json({ ok: true, data: { feeds: listPodcastFeeds(store.snapshot()) } });
  });

  router.post("/admin/podcasts/feeds", (req, res, next) => {
    try {
      let feed = null;
      const snapshot = updateAndPublish("admin.podcast.feed.create", (state) => {
        feed = upsertPodcastFeed(state, config, req.body || {});
      });
      res.json({ ok: true, data: { feed, feeds: listPodcastFeeds(snapshot) } });
    } catch (error) {
      next(error);
    }
  });

  router.patch("/admin/podcasts/feeds/:id", (req, res, next) => {
    try {
      let feed = null;
      const snapshot = updateAndPublish("admin.podcast.feed.update", (state) => {
        feed = upsertPodcastFeed(state, config, req.body || {}, req.params.id);
      });
      res.json({ ok: true, data: { feed, feeds: listPodcastFeeds(snapshot) } });
    } catch (error) {
      next(error);
    }
  });

  router.delete("/admin/podcasts/feeds/:id", (req, res, next) => {
    try {
      let result = null;
      const snapshot = updateAndPublish("admin.podcast.feed.delete", (state) => {
        result = deletePodcastFeed(state, req.params.id);
      });
      res.json({ ok: true, data: { result, feeds: listPodcastFeeds(snapshot), episodes: listPodcastEpisodes(snapshot, config) } });
    } catch (error) {
      next(error);
    }
  });

  router.post("/admin/podcasts/feeds/:id/refresh", async (req, res, next) => {
    const feed = listPodcastFeeds(store.snapshot()).find((item) => item.id === req.params.id);
    if (!feed) {
      res.status(404).json({ ok: false, error: "podcast feed not found" });
      return;
    }
    try {
      const parsed = await fetchPodcastFeed(config, feed);
      let result = null;
      const snapshot = updateAndPublish("admin.podcast.feed.refresh", (state) => {
        result = applyPodcastFeedRefresh(state, config, req.params.id, parsed);
      });
      res.json({
        ok: true,
        data: {
          feed: result.feed,
          episodes: result.episodes,
          feeds: listPodcastFeeds(snapshot),
          library: buildMediaLibrary(snapshot, config, { includeDiagnostics: true })
        }
      });
    } catch (error) {
      updateAndPublish("admin.podcast.feed.refresh_error", (state) => {
        markPodcastFeedRefreshError(state, req.params.id, error.message);
      });
      next(error);
    }
  });

  router.post("/admin/podcasts/refresh-all", async (req, res, next) => {
    try {
      const result = await refreshPodcastFeeds(store, config, {
        force: req.body?.force !== false,
        batchSize: req.body?.batchSize || req.body?.batch_size
      });
      publishMutation(store.snapshot(), store.snapshot(), "admin.podcast.refresh_all");
      res.json({
        ok: true,
        data: {
          result,
          feeds: listPodcastFeeds(store.snapshot()),
          episodes: listPodcastEpisodes(store.snapshot(), config),
          library: buildMediaLibrary(store.snapshot(), config, { includeDiagnostics: true })
        }
      });
    } catch (error) {
      next(error);
    }
  });

  router.get("/admin/podcasts/episodes", (req, res) => {
    res.json({
      ok: true,
      data: {
        episodes: listPodcastEpisodes(store.snapshot(), config, req.query)
      }
    });
  });

  router.get("/admin/media/catalog", (req, res) => {
    res.json({ ok: true, data: { tracks: listOnlineCatalog(config) } });
  });

  router.post("/admin/media/catalog", (req, res, next) => {
    try {
      const item = upsertOnlineCatalogTrack(config, req.body || {});
      res.json({ ok: true, data: { item, tracks: listOnlineCatalog(config) } });
    } catch (error) {
      next(error);
    }
  });

  router.delete("/admin/media/catalog/:id", (req, res, next) => {
    try {
      res.json({ ok: true, data: deleteOnlineCatalogTrack(config, req.params.id) });
    } catch (error) {
      next(error);
    }
  });

  router.patch("/admin/media/server/:id", (req, res, next) => {
    try {
      let track = null;
      const snapshot = updateAndPublish("admin.media.server.rename", (state) => {
        track = renameServerTrack(config, req.params.id, req.body?.title || req.body?.name || "");
        state.music = state.music || {};
        state.music.server = state.music.server || {};
        state.music.server.tracks = listKnownServerTracks(state, config);
        const index = state.music.server.tracks.findIndex((item) => item.id === track.id);
        if (index >= 0) {
          state.music.server.currentIndex = index;
          state.music.server.title = track.title;
          state.music.server.artist = track.artist;
        }
      });
      res.json({
        ok: true,
        data: {
          track,
          media: {
            tracks: listKnownServerTracks(snapshot, config)
          }
        }
      });
    } catch (error) {
      next(error);
    }
  });

  router.delete("/admin/media/server/:id", (req, res, next) => {
    try {
      let deleted = null;
      const snapshot = updateAndPublish("admin.media.server.delete", (state) => {
        deleted = deleteServerTrack(config, req.params.id);
        state.music = state.music || {};
        state.music.server = state.music.server || {};
        const tracks = listKnownServerTracks(state, config);
        state.music.server.tracks = tracks;
        state.music.server.available = tracks.length > 0;
        state.music.server.currentIndex = Math.min(Number(state.music.server.currentIndex || 0), Math.max(0, tracks.length - 1));
        if (tracks.length === 0) {
          state.music.server.playing = false;
          state.music.server.title = "服务器暂无音频";
          state.music.server.artist = "";
        }
      });
      res.json({
        ok: true,
        data: {
          deleted,
          media: {
            tracks: listKnownServerTracks(snapshot, config)
          }
        }
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/admin/media/command", async (req, res, next) => {
    try {
      let result = null;
      const body = {
        requestId: req.requestId,
        tool: req.body?.tool || req.body?.action || "family.media.play",
        text: req.body?.text || req.body?.query || "",
        params: {
          ...(req.body?.params && typeof req.body.params === "object" ? req.body.params : {}),
          query: req.body?.query || req.body?.params?.query,
          trackId: req.body?.trackId || req.body?.params?.trackId,
          deviceId: req.body?.deviceId || req.body?.params?.deviceId || "esp32-185b"
        }
      };
      const resolvedMedia = await resolveServerMediaForCommand(store.snapshot(), config, body);
      const before = store.snapshot();
      const snapshot = store.update((state) => {
        result = enqueueXiaozhiToolCommand(state, config, { ...body, _resolvedMedia: resolvedMedia });
      });
      publishMutation(before, snapshot, "admin.media.command");
      if (result?.accepted && eventBus) {
        eventBus.publish("device.command.created", {
          command: result.command,
          speech: result.speech || ""
        });
      }
      res.status(result?.accepted ? 202 : 400).json({
        ok: Boolean(result?.accepted),
        data: {
          ...result,
          summary: deviceSummary(snapshotWithServerMedia(snapshot, config), config)
        }
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/admin/reset", (req, res) => {
    const before = store.snapshot();
    const snapshot = store.reset();
    publishMutation(before, snapshot, "admin.reset");
    res.json({ ok: true, data: deviceSummary(snapshot, config) });
  });

  return router;
}

module.exports = {
  buildAcceptanceReadiness,
  createApiRouter,
  looksLikeRepresentativeContent
};

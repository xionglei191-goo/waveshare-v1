const {
  createAuthToken,
  listAuthTokens,
  revokeAuthToken,
  rotateAuthToken
} = require("../auth-tokens");
const { ensureDeviceCommandState, pendingDeviceCommands } = require("../device-commands");
const { buildAdminDashboard, deviceDiagnostics } = require("../device-registry");
const { auditAction } = require("../security");

function tokenAudit(state, action, reason, requestId) {
  auditAction(state, action, { memberId: "admin", requestId }, {
    allowed: true,
    category: "diagnostics",
    mode: state.familyMode || "默认",
    reason
  });
}

function registerAdminRoutes(router, context) {
  const {
    store,
    config,
    adminAuth,
    observability,
    requestControls,
    updateAndPublish,
    publishMutation,
    deviceSummary,
    listAiTraces,
    safeAdminConfig
  } = context;
  router.get("/admin/dashboard", adminAuth, (req, res) => {
    res.json({ ok: true, data: buildAdminDashboard(store.snapshot()) });
  });
  router.get("/admin/metrics", adminAuth, (req, res) => {
    const state = store.snapshot();
    const commands = ensureDeviceCommandState(state);
    const history = commands.history || [];
    const durations = history.map((item) => Date.parse(item.ackedAt || "") - Date.parse(item.createdAt || "")).filter((value) => Number.isFinite(value) && value >= 0);
    res.json({ ok: true, data: {
      generatedAt: new Date().toISOString(),
      http: observability?.snapshot?.() || null,
      requestControls: requestControls.snapshot(),
      commands: {
        ...commands.stats,
        pending: commands.queue.filter((item) => item.status === "pending").length,
        historyCount: history.length,
        successRate: commands.stats.created ? Number(((commands.stats.acked || 0) / commands.stats.created).toFixed(3)) : null,
        avgAckMs: durations.length ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length) : null
      },
      devices: {
        count: (state.devices || []).length,
        healthy: (state.devices || []).filter((item) => item.health === "healthy").length,
        crashLoop: (state.devices || []).filter((item) => item.health === "crash_loop").length,
        backendUnreachable: (state.devices || []).filter((item) => item.health === "backend_unreachable").length
      },
      dependencies: {
        openclawLatestJob: state.openclaw?.jobs?.[0] || null,
        homeAssistantLatest: state.integrations?.homeAssistant?.history?.[0] || null,
        weatherProvider: state.weather?.provider || config.weatherProvider,
        weatherUpdatedAt: state.weather?.updatedAt || null
      }
    } });
  });
  router.get("/admin/devices/:id/diagnostics", adminAuth, (req, res) => {
    const state = store.snapshot();
    const diagnostics = deviceDiagnostics(state, req.params.id);
    if (!diagnostics.device) {
      res.status(404).json({ ok: false, error: "device not found" });
      return;
    }
    res.json({ ok: true, data: {
      ...diagnostics,
      commandHistory: ensureDeviceCommandState(state).history.filter((item) => item.deviceId === req.params.id || item.deviceId === "all").slice(0, 50),
      pendingCommands: pendingDeviceCommands(state, req.params.id, 8)
    } });
  });
  router.get("/admin/database/schema", adminAuth, (req, res) => {
    const state = store.snapshot();
    res.json({ ok: true, data: {
      ...state.database,
      driver: store.driver || "json",
      filePath: store.filePath,
      ...(typeof store.schemaInfo === "function" ? store.schemaInfo() : {})
    } });
  });
  router.get("/admin/tokens", adminAuth, (req, res) => {
    res.json({ ok: true, data: { tokens: listAuthTokens(store.snapshot()) } });
  });
  router.post("/admin/tokens", adminAuth, (req, res, next) => {
    try {
      let created;
      updateAndPublish("admin.token.create", (state) => {
        created = createAuthToken(state, req.body || {});
        tokenAudit(state, "admin.token.create", `created ${created.record.kind} token`, req.requestId);
      });
      res.status(201).json({ ok: true, data: created });
    } catch (error) { next(error); }
  });
  router.post("/admin/tokens/:id/rotate", adminAuth, (req, res, next) => {
    try {
      let rotated;
      updateAndPublish("admin.token.rotate", (state) => {
        rotated = rotateAuthToken(state, req.params.id);
        tokenAudit(state, "admin.token.rotate", `rotated token ${req.params.id}`, req.requestId);
      });
      res.status(201).json({ ok: true, data: rotated });
    } catch (error) { next(error); }
  });
  router.delete("/admin/tokens/:id", adminAuth, (req, res, next) => {
    try {
      let revoked;
      updateAndPublish("admin.token.revoke", (state) => {
        revoked = revokeAuthToken(state, req.params.id);
        tokenAudit(state, "admin.token.revoke", `revoked token ${req.params.id}`, req.requestId);
      });
      res.json({ ok: true, data: { token: revoked } });
    } catch (error) { next(error); }
  });
  router.get("/admin/ai/traces", adminAuth, (req, res) => {
    const state = store.snapshot();
    res.json({ ok: true, data: {
      stats: state.aiRuntime?.stats || {},
      deviceContexts: Object.values(state.aiRuntime?.deviceContexts || {}),
      traces: listAiTraces(state, req.query)
    } });
  });
  router.get("/admin/config", adminAuth, (req, res) => {
    res.json({ ok: true, data: safeAdminConfig(config) });
  });
  router.post("/admin/reset", adminAuth, (req, res) => {
    const before = store.snapshot();
    const snapshot = store.reset();
    publishMutation(before, snapshot, "admin.reset");
    res.json({ ok: true, data: deviceSummary(snapshot, config) });
  });
}

module.exports = { registerAdminRoutes };

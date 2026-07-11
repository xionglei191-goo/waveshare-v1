const { buildAcceptanceStatus, recordAcceptanceEvidence } = require("../acceptance");
const { buildAcceptanceEvidencePack } = require("../acceptance-pack");
const { ensureDeviceCommandState, pendingDeviceCommands } = require("../device-commands");

function registerAcceptanceRoutes(router, context) {
  const {
    store, config, adminAuth, buildAcceptanceReadiness, buildResourceManifest,
    deviceSummary, snapshotWithServerMedia, updateAndPublish
  } = context;

  router.get("/acceptance/status", (req, res) => {
    res.json({ ok: true, data: buildAcceptanceStatus(store.snapshot()) });
  });
  router.get("/acceptance/readiness", (req, res) => {
    const state = store.snapshot();
    res.json({ ok: true, data: buildAcceptanceReadiness(state, config, buildResourceManifest(state, config)) });
  });
  router.get("/admin/acceptance/evidence-pack", adminAuth, (req, res) => {
    const state = store.snapshot();
    const manifest = buildResourceManifest(state, config);
    const status = buildAcceptanceStatus(state);
    const readiness = buildAcceptanceReadiness(state, config, manifest);
    const items = String(req.query.items || "").split(",").map((item) => item.trim()).filter(Boolean);
    res.json({ ok: true, data: buildAcceptanceEvidencePack({
      status,
      readiness,
      diagnostics: { generatedAt: new Date().toISOString(), backend: {
        name: config.name, version: config.version, uptimeSec: Math.floor(process.uptime()),
        storeDriver: store.driver || "json"
      } },
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
    }, { items }) });
  });
  router.post("/admin/acceptance/:id/evidence", adminAuth, (req, res, next) => {
    try {
      let result = null;
      const snapshot = updateAndPublish(`admin.acceptance.${req.params.id}`, (state) => {
        result = recordAcceptanceEvidence(state, req.params.id, req.body || {});
      });
      res.json({ ok: true, data: {
        ...result,
        summary: deviceSummary(snapshotWithServerMedia(snapshot, config), config)
      } });
    } catch (error) {
      next(error);
    }
  });
}

module.exports = { registerAcceptanceRoutes };

const { ackDeviceCommand, pendingDeviceCommands } = require("../device-commands");
const { appendDeviceLog, registerDevice } = require("../device-registry");

function registerDeviceRoutes(router, context) {
  const { store, config, updateAndPublish, publishMutation, deviceSummary } = context;
  router.get("/devices", (req, res) => {
    res.json({ ok: true, data: { devices: store.snapshot().devices || [] } });
  });
  router.get("/device/commands/poll", (req, res) => {
    res.json({ ok: true, data: { commands: pendingDeviceCommands(
      store.snapshot(), req.query.deviceId || req.query.device_id || "esp32-185b", req.query.limit || 1
    ) } });
  });
  router.post("/device/commands/:id/ack", (req, res) => {
    let result;
    const before = store.snapshot();
    const snapshot = store.update((state) => { result = ackDeviceCommand(state, req.params.id, req.body || {}); });
    publishMutation(before, snapshot, "device.command.ack");
    res.status(result?.found ? 200 : 404).json({ ok: Boolean(result?.found), data: result });
  });
  router.post("/devices/register", (req, res) => {
    let device;
    const snapshot = updateAndPublish("devices.register", (state) => { device = registerDevice(state, req.body); });
    res.json({ ok: true, data: { device, summary: deviceSummary(snapshot, config) } });
  });
  router.post("/device/logs", (req, res) => {
    let log;
    const snapshot = updateAndPublish("device.logs", (state) => {
      log = appendDeviceLog(state, { requestId: req.requestId, ...(req.body || {}) });
    });
    res.json({ ok: true, data: { log, logs: snapshot.deviceLogs.slice(0, 20) } });
  });
  router.get("/device/logs", (req, res) => {
    res.json({ ok: true, data: { logs: store.snapshot().deviceLogs || [] } });
  });
}

module.exports = { registerDeviceRoutes };

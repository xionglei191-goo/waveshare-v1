const assert = require("node:assert/strict");
const test = require("node:test");

const { appendDeviceLog, deviceDiagnostics } = require("../src/device-registry");
const { createInitialState } = require("../src/fixtures");

test("heartbeats from one boot create one boot session", () => {
  const state = createInitialState();
  const heartbeat = {
    deviceId: "device-a",
    message: "device heartbeat",
    data: {
      bootId: "boot-a",
      bootSequence: 4,
      uptimeSec: 30,
      resetReason: "panic",
      panicSummary: "reset_code=4;reason=panic",
      backendProbe: "探针 summary.updated"
    }
  };
  appendDeviceLog(state, heartbeat);
  appendDeviceLog(state, { ...heartbeat, data: { ...heartbeat.data, uptimeSec: 90 } });
  const diagnostics = deviceDiagnostics(state, "device-a");
  assert.equal(diagnostics.bootSessions.length, 1);
  assert.equal(diagnostics.bootSessions[0].logCount, 2);
  assert.equal(diagnostics.panicSessionsLast10m, 1);
  assert.equal(diagnostics.health, "healthy");
});

test("two distinct recent panic boots are a crash loop", () => {
  const state = createInitialState();
  for (const bootId of ["boot-a", "boot-b"]) {
    appendDeviceLog(state, {
      deviceId: "device-a",
      message: "device heartbeat",
      data: { bootId, resetReason: "panic", panicSummary: `panic ${bootId}`, uptimeSec: 20 }
    });
  }
  assert.equal(deviceDiagnostics(state, "device-a").health, "crash_loop");
});

test("early backend failure is startup pending", () => {
  const state = createInitialState();
  appendDeviceLog(state, {
    deviceId: "device-a",
    data: { bootId: "boot-a", uptimeSec: 40, backendProbe: "探针不可达" }
  });
  assert.equal(deviceDiagnostics(state, "device-a").health, "startup_pending");
});

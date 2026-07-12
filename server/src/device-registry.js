function ensureDeviceModels(state) {
  state.devices = Array.isArray(state.devices) ? state.devices : [];
  state.deviceLogs = Array.isArray(state.deviceLogs) ? state.deviceLogs : [];
  state.deviceBoots = Array.isArray(state.deviceBoots) ? state.deviceBoots : [];
  state.database = state.database || {};
  state.database.schemaVersion = state.database.schemaVersion || 1;
  state.database.tables = state.database.tables || {
    families: "family profile and policy records",
    members: "family member identities and roles",
    devices: "registered ESP32 terminals",
    events: "sync, learning, media, and system events",
    resources: "resource package manifests and files",
    audit: "action security audit records"
  };
  state.product = state.product || {};
  state.product.releaseChannel = state.product.releaseChannel || "local";
  state.product.minFirmware = state.product.minFirmware || "2.2.6";
  state.product.remoteUiSchema = state.product.remoteUiSchema || 1;
  state.product.backendApi = state.product.backendApi || 1;
  state.product.upgradePolicy = state.product.upgradePolicy || {
    firmware: "manual-confirm",
    resources: "auto-verified",
    backend: "compatible-migrations"
  };
  state.ota = state.ota || {};
  state.ota.firmware = state.ota.firmware || {
    version: state.product.minFirmware,
    channel: state.product.releaseChannel,
    url: "",
    sha256: "",
    mandatory: false
  };
}

function numericOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function compactText(value, max = 240) {
  return String(value || "").slice(0, max);
}

function normalizeBootFields(body = {}, data = {}) {
  const nested = data.boot && typeof data.boot === "object" ? data.boot : {};
  const panicSummary = body.panicSummary || body.panic_summary || data.panicSummary || data.panic_summary || nested.panicSummary || "";
  return {
    bootId: compactText(body.bootId || body.boot_id || data.bootId || data.boot_id || nested.bootId || "", 96),
    bootSequence: numericOrNull(body.bootSequence ?? body.boot_sequence ?? data.bootSequence ?? data.boot_sequence ?? nested.bootSequence),
    uptimeSec: numericOrNull(body.uptimeSec ?? body.uptime_sec ?? data.uptimeSec ?? data.uptime_sec ?? nested.uptimeSec),
    firmwareBuild: compactText(body.firmwareBuild || body.firmware_build || data.firmwareBuild || data.firmware_build || data.firmware || "", 96),
    resetReason: compactText(body.resetReason || body.reset_reason || data.resetReason || data.reset_reason || nested.resetReason || "", 120),
    panicSummary: compactText(panicSummary, 500),
    requestId: compactText(body.requestId || body.request_id || data.requestId || data.request_id || "", 96)
  };
}

function upsertBootSession(state, entry, bootFields) {
  if (!bootFields.bootId) {
    return null;
  }
  const now = entry.at || new Date().toISOString();
  const key = `${entry.deviceId}:${bootFields.bootId}`;
  let session = state.deviceBoots.find((item) => item.key === key);
  if (!session) {
    session = {
      key,
      id: bootFields.bootId,
      deviceId: entry.deviceId,
      firstSeenAt: now,
      lastSeenAt: now,
      bootSequence: bootFields.bootSequence,
      firmwareBuild: bootFields.firmwareBuild,
      resetReason: bootFields.resetReason,
      panicSummary: bootFields.panicSummary,
      logCount: 0
    };
    state.deviceBoots.unshift(session);
  }
  session.lastSeenAt = now;
  session.logCount = (session.logCount || 0) + 1;
  session.uptimeSec = bootFields.uptimeSec ?? session.uptimeSec ?? null;
  session.bootSequence = bootFields.bootSequence ?? session.bootSequence ?? null;
  session.firmwareBuild = bootFields.firmwareBuild || session.firmwareBuild || "";
  session.resetReason = bootFields.resetReason || session.resetReason || "";
  session.panicSummary = bootFields.panicSummary || session.panicSummary || "";
  state.deviceBoots = state.deviceBoots
    .filter((item) => Date.now() - Date.parse(item.lastSeenAt || item.firstSeenAt || now) <= 180 * 24 * 60 * 60 * 1000)
    .slice(0, 2000);
  return session;
}

function recentPanicSessionCount(state, deviceId, windowMs = 10 * 60 * 1000) {
  const cutoff = Date.now() - windowMs;
  const sessionIds = new Set();
  for (const session of state.deviceBoots || []) {
    const resetReason = String(session.resetReason || "").toLowerCase();
    if (session.deviceId !== deviceId || (!session.panicSummary && !resetReason.includes("panic"))) {
      continue;
    }
    const time = Date.parse(session.firstSeenAt || session.lastSeenAt || "");
    if (Number.isFinite(time) && time >= cutoff) {
      sessionIds.add(session.key || `${session.deviceId}:${session.id}`);
    }
  }
  return sessionIds.size;
}

function deviceHealthFor(state, deviceId, latestLog = null) {
  const log = latestLog || (state.deviceLogs || []).find((item) => item.deviceId === deviceId) || null;
  if (!log) {
    return "backend_unreachable";
  }
  if (recentPanicSessionCount(state, deviceId) >= 2) {
    return "crash_loop";
  }
  const data = log.data && typeof log.data === "object" ? log.data : {};
  const uptimeSec = numericOrNull(log.uptimeSec ?? data.uptimeSec ?? data.uptime_sec);
  const backendProbe = String(log.backendProbe || data.backendProbe || "").toLowerCase();
  if (uptimeSec !== null && uptimeSec < 180 && (backendProbe.includes("fail") || backendProbe.includes("不可达"))) {
    return "startup_pending";
  }
  if (backendProbe.includes("fail") || backendProbe.includes("不可达")) {
    return "backend_unreachable";
  }
  return "healthy";
}

function registerDevice(state, body = {}) {
  ensureDeviceModels(state);
  const now = new Date().toISOString();
  const id = body.id || body.deviceId || body.uuid || "unknown-device";
  let device = state.devices.find((item) => item.id === id);
  if (!device) {
    device = {
      id,
      name: body.name || "Family Round Screen",
      profile: body.profile || "waveshare-esp32-s3-touch-lcd-1.85b",
      createdAt: now
    };
    state.devices.push(device);
  }
  device.name = body.name || device.name;
  device.profile = body.profile || device.profile;
  device.firmware = body.firmware || body.version || device.firmware || "";
  device.ip = body.ip || device.ip || "";
  device.owner = body.owner || device.owner || "family";
  device.room = body.room || device.room || "home";
  device.lastSeenAt = now;
  return device;
}

function appendDeviceLog(state, body = {}) {
  ensureDeviceModels(state);
  const now = new Date().toISOString();
  const data = body.data && typeof body.data === "object" ? body.data : {};
  const bootFields = normalizeBootFields(body, data);
  const entry = {
    id: body.id || `log_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`,
    at: body.at || now,
    deviceId: body.deviceId || body.id || "unknown-device",
    level: body.level || "info",
    source: body.source || "device",
    message: String(body.message || "").slice(0, 240),
    data,
    ...Object.fromEntries(Object.entries(bootFields).filter(([, value]) => value !== "" && value !== null))
  };
  const board = data.board && typeof data.board === "object" ? data.board : {};
  const status = data.status && typeof data.status === "object" ? data.status : {};
  const network = status.network && typeof status.network === "object" ? status.network : {};
  const deviceId = entry.deviceId;
  if (deviceId && deviceId !== "unknown-device") {
    let device = state.devices.find((item) => item.id === deviceId);
    if (!device) {
      device = {
        id: deviceId,
        name: body.name || "Family Round Screen",
        profile: data.profile || body.profile || "waveshare-esp32-s3-touch-lcd-1.85b",
        createdAt: now
      };
      state.devices.push(device);
    }
    device.lastSeenAt = entry.at;
    device.profile = data.profile || body.profile || device.profile;
    device.logicalDeviceId = data.logicalDeviceId || device.logicalDeviceId || "";
    device.ip = board.ip || body.ip || device.ip || "";
    device.ssid = board.ssid || network.ssid || device.ssid || "";
    device.rssi = board.rssi ?? device.rssi ?? null;
    device.channel = board.channel ?? device.channel ?? null;
    device.lastWakeReason = data.wakeReason || device.lastWakeReason || "";
    device.lastResetReason = bootFields.resetReason || data.resetReason || device.lastResetReason || "";
    device.lastBootId = bootFields.bootId || device.lastBootId || "";
    device.bootSequence = bootFields.bootSequence ?? device.bootSequence ?? null;
    device.firmwareBuild = bootFields.firmwareBuild || device.firmwareBuild || "";
    device.uptimeSec = bootFields.uptimeSec ?? device.uptimeSec ?? null;
    device.panicSummary = bootFields.panicSummary || device.panicSummary || "";
    upsertBootSession(state, entry, bootFields);
    device.health = deviceHealthFor(state, deviceId, entry);
  }
  state.deviceLogs.unshift(entry);
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  state.deviceLogs = state.deviceLogs
    .filter((log) => {
      const time = Date.parse(log.at || "");
      return !Number.isFinite(time) || time >= cutoff;
    })
    .slice(0, 20000);
  return entry;
}

function deviceDiagnostics(state, deviceId) {
  ensureDeviceModels(state);
  const id = String(deviceId || "").trim();
  const device = state.devices.find((item) => item.id === id) || null;
  const logs = state.deviceLogs.filter((item) => item.deviceId === id).slice(0, 200);
  const latestLog = logs[0] || null;
  const bootSessions = state.deviceBoots.filter((item) => item.deviceId === id).slice(0, 50);
  return {
    device,
    health: deviceHealthFor(state, id, latestLog),
    latestLog,
    bootSessions,
    panicSessionsLast10m: recentPanicSessionCount(state, id),
    logs
  };
}

function buildAdminDashboard(state) {
  ensureDeviceModels(state);
  return {
    familyMode: state.familyMode,
    devices: {
      count: state.devices.length,
      items: state.devices.slice(0, 20)
    },
    logs: {
      count: state.deviceLogs.length,
      recent: state.deviceLogs.slice(0, 20)
    },
    sync: state.sync?.stats || {},
    security: {
      deniedCount: state.security?.deniedCount || 0,
      recentAudit: state.security?.audit?.slice(0, 10) || []
    },
    resources: state.resources,
    product: state.product
  };
}

function buildOtaManifest(state, config) {
  ensureDeviceModels(state);
  return {
    schema: 1,
    backend: {
      name: config.name,
      version: config.version,
      api: state.product.backendApi
    },
    firmware: state.ota.firmware,
    resources: {
      manifestUrl: `${config.publicBaseUrl}/api/resources/manifest`,
      version: state.resources?.manifestVersion || "unknown",
      policy: state.product.upgradePolicy.resources
    },
    compatibility: {
      deviceProfile: state.resources?.deviceProfile || "waveshare-esp32-s3-touch-lcd-1.85b",
      minFirmware: state.product.minFirmware,
      remoteUiSchema: state.product.remoteUiSchema
    }
  };
}

function buildCompatibility(state) {
  ensureDeviceModels(state);
  return {
    schema: 1,
    backendApi: state.product.backendApi,
    remoteUiSchema: state.product.remoteUiSchema,
    minFirmware: state.product.minFirmware,
    actionsPolicyVersion: state.security?.policyVersion || 1,
    supportedProfiles: [state.resources?.deviceProfile || "waveshare-esp32-s3-touch-lcd-1.85b"],
    upgradePolicy: state.product.upgradePolicy
  };
}

module.exports = {
  appendDeviceLog,
  buildAdminDashboard,
  buildCompatibility,
  buildOtaManifest,
  deviceDiagnostics,
  ensureDeviceModels,
  registerDevice
};

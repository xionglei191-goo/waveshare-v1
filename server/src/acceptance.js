const ACCEPTANCE_DEFINITIONS = [
  {
    id: "blufi-new-wifi",
    title: "新 Wi-Fi 配网 (SoftAP 网页 / BluFi)",
    phase: "Phase 13/20",
    requirement: "手机通过 SoftAP 热点网页(或 EspBlufi)写入新 Wi-Fi，设备联网后小智 OTA/MQTT/唤醒词和后端连接仍正常。",
    evidenceRequired: [
      "手机完成配网:连接 Xiaozhi 热点填写并提交 Wi-Fi(或 EspBlufi 返回成功)",
      "圆屏设置页显示新 SSID/IP/RSSI",
      "/api/device/summary 更新时间正常",
      "串口确认小智 OTA/MQTT/唤醒词恢复且无 panic"
    ]
  },
  {
    id: "home-assistant-real-scene",
    title: "Home Assistant 真实场景控制",
    phase: "Phase 7/19",
    requirement: "配置真实 HOME_ASSISTANT_URL/TOKEN 后，通过工具触发 scene 并确认 HA 侧状态变化。",
    evidenceRequired: [
      "后端 integrations 显示 Home Assistant configured",
      "工具调用 history 记录 sent",
      "HA 侧场景或实体状态实际变化",
      "权限拒绝和审计仍正常"
    ]
  },
  {
    id: "real-family-content",
    title: "真实家庭素材导入",
    phase: "Phase 12",
    requirement: "导入真实家庭相册、播客、英语包和小游戏素材，并在设备端完成显示/播放/入口验收。",
    evidenceRequired: [
      "资源 manifest 包含真实素材 sha256/size/contentType/version",
      "相册页能显示真实照片或屏保资源",
      "音乐页能播放真实播客/音频",
      "英语/应用页能进入对应真实资源"
    ]
  },
  {
    id: "openclaw-default-music",
    title: "OpenClaw default/music 真实任务",
    phase: "Phase 11/19",
    requirement: "为 OPENCLAW_TARGET_DEFAULT_COMMAND 和 OPENCLAW_TARGET_MUSIC_COMMAND 配置真实家庭任务并验收控制效果。",
    evidenceRequired: [
      "远端环境配置具体 target command",
      "default 和 music target 至少各有一次 success job",
      "实际家庭程序或媒体流程被触发",
      "未确认/儿童/访客拒绝仍正常"
    ]
  }
];

const VALID_STATUSES = new Set(["pending", "passed", "failed", "blocked"]);
const MAX_DATA_BYTES = 3000;
const MAX_DATA_DEPTH = 4;
const MAX_DATA_ARRAY_ITEMS = 20;
const MAX_DATA_OBJECT_KEYS = 30;
const SENSITIVE_DATA_KEY = /token|password|passwd|secret|authorization|cookie|credential|api[_-]?key/i;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function safeText(value, fallback = "", limit = 500) {
  return String(value || fallback).replace(/[<>]/g, "").trim().slice(0, limit);
}

function safeDataValue(value, depth = 0) {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string") {
    return safeText(value, "", 500);
  }
  if (depth >= MAX_DATA_DEPTH) {
    return "[truncated]";
  }
  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_DATA_ARRAY_ITEMS).map((item) => safeDataValue(item, depth + 1));
    if (value.length > MAX_DATA_ARRAY_ITEMS) {
      items.push({ truncatedItems: value.length - MAX_DATA_ARRAY_ITEMS });
    }
    return items;
  }
  if (typeof value === "object") {
    const output = {};
    const entries = Object.entries(value).slice(0, MAX_DATA_OBJECT_KEYS);
    for (const [rawKey, rawValue] of entries) {
      const key = safeText(rawKey, "field", 64);
      if (!key) {
        continue;
      }
      output[key] = SENSITIVE_DATA_KEY.test(key) ? "[redacted]" : safeDataValue(rawValue, depth + 1);
    }
    if (Object.keys(value).length > MAX_DATA_OBJECT_KEYS) {
      output.truncatedKeys = Object.keys(value).length - MAX_DATA_OBJECT_KEYS;
    }
    return output;
  }
  return safeText(value, "", 120);
}

function safeData(value) {
  if (!value || typeof value !== "object") {
    return {};
  }
  const sanitized = safeDataValue(value);
  const serialized = JSON.stringify(sanitized);
  if (Buffer.byteLength(serialized, "utf8") <= MAX_DATA_BYTES) {
    return sanitized;
  }
  return {
    truncated: true,
    preview: safeText(serialized, "", MAX_DATA_BYTES)
  };
}

function definitionFor(id) {
  return ACCEPTANCE_DEFINITIONS.find((item) => item.id === id) || null;
}

function ensureAcceptanceState(state) {
  state.acceptance = state.acceptance && typeof state.acceptance === "object" ? state.acceptance : {};
  state.acceptance.items = Array.isArray(state.acceptance.items) ? state.acceptance.items : [];

  for (const definition of ACCEPTANCE_DEFINITIONS) {
    let item = state.acceptance.items.find((entry) => entry.id === definition.id);
    if (!item) {
      item = {
        id: definition.id,
        status: "pending",
        updatedAt: null,
        evidence: []
      };
      state.acceptance.items.push(item);
    }
    item.title = definition.title;
    item.phase = definition.phase;
    item.requirement = definition.requirement;
    item.evidenceRequired = clone(definition.evidenceRequired);
    item.status = VALID_STATUSES.has(item.status) ? item.status : "pending";
    item.evidence = Array.isArray(item.evidence) ? item.evidence.slice(0, 40) : [];
  }

  state.acceptance.items = state.acceptance.items.filter((item) => definitionFor(item.id));
  state.acceptance.updatedAt = state.acceptance.updatedAt || null;
  return state.acceptance;
}

function buildAcceptanceStatus(state) {
  const stateCopy = clone(state || {});
  const acceptance = ensureAcceptanceState(stateCopy);
  const items = acceptance.items.map((item) => ({
    ...item,
    latestEvidence: item.evidence[0] || null,
    evidenceCount: item.evidence.length
  }));
  return {
    updatedAt: acceptance.updatedAt,
    counts: {
      total: items.length,
      passed: items.filter((item) => item.status === "passed").length,
      pending: items.filter((item) => item.status === "pending").length,
      failed: items.filter((item) => item.status === "failed").length,
      blocked: items.filter((item) => item.status === "blocked").length
    },
    items
  };
}

function recordAcceptanceEvidence(state, id, body = {}) {
  const definition = definitionFor(id);
  if (!definition) {
    const error = new Error("acceptance item not found");
    error.statusCode = 404;
    throw error;
  }
  const acceptance = ensureAcceptanceState(state);
  const item = acceptance.items.find((entry) => entry.id === id);
  const status = VALID_STATUSES.has(body.status) ? body.status : item.status || "pending";
  const now = new Date().toISOString();
  const evidence = {
    id: `acc_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`,
    at: now,
    status,
    actor: safeText(body.actor, "admin", 64),
    source: safeText(body.source, "companion", 64),
    note: safeText(body.note || body.message, "", 1000),
    reference: safeText(body.reference || body.url || "", 240),
    data: safeData(body.data)
  };
  item.status = status;
  item.updatedAt = now;
  item.evidence.unshift(evidence);
  item.evidence = item.evidence.slice(0, 40);
  acceptance.updatedAt = now;
  return { item, evidence, status: buildAcceptanceStatus(state) };
}

module.exports = {
  ACCEPTANCE_DEFINITIONS,
  buildAcceptanceStatus,
  ensureAcceptanceState,
  recordAcceptanceEvidence
};

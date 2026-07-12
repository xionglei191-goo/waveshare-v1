const crypto = require("crypto");

const PAGE_KEYS = new Set(["home", "weather", "schedule", "ai", "music", "album", "apps", "settings", "english"]);
const FAMILY_MODES = new Set(["默认", "儿童", "访客"]);

function nowIso() {
  return new Date().toISOString();
}

function safeText(value, limit = 160) {
  return String(value || "").replace(/[<>]/g, "").trim().slice(0, limit);
}

function safeId(value, prefix = "trace") {
  const normalized = String(value || "")
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 96);
  return normalized || `${prefix}_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
}

function safeNumber(value, fallback = 0, min = 0, max = 600000) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function sanitizePageState(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const output = {};
  for (const [key, raw] of Object.entries(value).slice(0, 12)) {
    const safeKey = safeText(key, 40).replace(/[^a-zA-Z0-9._-]/g, "");
    if (!safeKey) {
      continue;
    }
    if (typeof raw === "boolean") {
      output[safeKey] = raw;
    } else if (typeof raw === "number" && Number.isFinite(raw)) {
      output[safeKey] = raw;
    } else if (typeof raw === "string") {
      output[safeKey] = safeText(raw, 120);
    }
  }
  return output;
}

function ensureAiRuntimeState(state) {
  state.aiRuntime = state.aiRuntime || {};
  state.aiRuntime.deviceContexts = state.aiRuntime.deviceContexts && typeof state.aiRuntime.deviceContexts === "object"
    ? state.aiRuntime.deviceContexts
    : {};
  state.aiRuntime.traces = Array.isArray(state.aiRuntime.traces) ? state.aiRuntime.traces : [];
  state.aiRuntime.stats = state.aiRuntime.stats || {
    turns: 0,
    handled: 0,
    fallback: 0,
    failed: 0,
    lastTurnAt: null
  };
  return state.aiRuntime;
}

function normalizePage(value) {
  const page = safeText(value, 32).toLowerCase();
  return PAGE_KEYS.has(page) ? page : "";
}

function normalizeFamilyMode(value) {
  const mode = safeText(value, 16);
  return FAMILY_MODES.has(mode) ? mode : "";
}

function updateDeviceContext(state, body = {}) {
  const runtime = ensureAiRuntimeState(state);
  const deviceId = safeId(body.deviceId || body.device_id || "esp32-185b", "device");
  const page = normalizePage(body.page);
  const familyMode = normalizeFamilyMode(body.familyMode || body.family_mode || body.mode);
  if (!page || !familyMode) {
    const error = new Error("valid page and familyMode are required");
    error.statusCode = 400;
    throw error;
  }
  const previous = runtime.deviceContexts[deviceId] || {};
  const context = {
    deviceId,
    page,
    familyMode,
    pageState: sanitizePageState(body.pageState || body.page_state),
    version: Math.max(Number(previous.version || 0) + 1, safeNumber(body.version, 0, 0, Number.MAX_SAFE_INTEGER)),
    source: safeText(body.source || "device", 48),
    updatedAt: nowIso()
  };
  runtime.deviceContexts[deviceId] = context;
  return context;
}

function deviceContext(state, deviceId, maxAgeMs = 120000) {
  const runtime = ensureAiRuntimeState(state);
  const id = safeId(deviceId || "esp32-185b", "device");
  const context = runtime.deviceContexts[id];
  if (!context) {
    return { context: null, fresh: false, ageMs: null };
  }
  const ageMs = Math.max(0, Date.now() - Date.parse(context.updatedAt || ""));
  const fresh = Number.isFinite(ageMs) && ageMs <= Math.max(1000, Number(maxAgeMs) || 120000);
  return { context: { ...context }, fresh, ageMs: Number.isFinite(ageMs) ? ageMs : null };
}

function agentBodyWithDeviceContext(state, body = {}, maxAgeMs = 120000) {
  const deviceId = safeId(body.deviceId || body.device_id || "esp32-185b", "device");
  const requestedPage = normalizePage(body.page);
  const requestedMode = normalizeFamilyMode(body.familyMode || body.family_mode || body.mode);
  if (requestedPage || requestedMode) {
    const effectivePage = requestedPage || "ai";
    const effectiveMode = requestedMode || normalizeFamilyMode(state.familyMode) || "默认";
    return {
      body: { ...body, deviceId, page: effectivePage, familyMode: effectiveMode },
      contextSource: "request",
      contextFresh: true,
      contextAgeMs: 0
    };
  }
  const cached = deviceContext(state, deviceId, maxAgeMs);
  if (!cached.context || !cached.fresh) {
    return {
      body: { ...body, deviceId },
      contextSource: cached.context ? "stale" : "missing",
      contextFresh: false,
      contextAgeMs: cached.ageMs
    };
  }
  return {
    body: {
      ...body,
      deviceId,
      page: requestedPage || cached.context.page,
      familyMode: requestedMode || cached.context.familyMode,
      pageState: body.pageState && typeof body.pageState === "object" ? body.pageState : cached.context.pageState
    },
    contextSource: "device_cache",
    contextFresh: true,
    contextAgeMs: cached.ageMs
  };
}

function modelTierForFallback(utterance, fallbackReason = "general_query") {
  const text = safeText(utterance, 400).toLowerCase();
  const complex = text.length > 80 || [
    "分析", "比较", "推理", "为什么", "方案", "代码", "设计", "规划", "总结", "解释",
    "量子", "纠缠", "证明", "算法", "架构",
    "analyze", "compare", "reason", "design", "plan", "code", "explain"
  ].some((marker) => text.includes(marker));
  if (fallbackReason === "unsupported_intent" || complex) {
    return "complex";
  }
  return "lightweight";
}

function sanitizeTimings(value) {
  const source = value && typeof value === "object" ? value : {};
  const output = {};
  for (const [key, raw] of Object.entries(source).slice(0, 24)) {
    const safeKey = safeText(key, 40).replace(/[^a-zA-Z0-9._-]/g, "");
    if (safeKey) {
      output[safeKey] = safeNumber(raw);
    }
  }
  return output;
}

function upsertAiTrace(state, body = {}, options = {}) {
  const runtime = ensureAiRuntimeState(state);
  const traceId = safeId(body.traceId || body.trace_id, "trace");
  const existing = runtime.traces.find((item) => item.traceId === traceId);
  const previousStatus = existing?.status || "";
  const storeText = options.storeText === true;
  const utterance = safeText(body.utterance || body.text || body.transcript || "", 300);
  const next = {
    ...(existing || {}),
    traceId,
    sessionId: safeId(body.sessionId || body.session_id || existing?.sessionId || "", "session"),
    deviceId: safeId(body.deviceId || body.device_id || existing?.deviceId || "esp32-185b", "device"),
    page: normalizePage(body.page) || existing?.page || "",
    familyMode: normalizeFamilyMode(body.familyMode || body.family_mode) || existing?.familyMode || "",
    stage: safeText(body.stage || existing?.stage || "received", 48),
    status: safeText(body.status || existing?.status || "active", 32),
    agent: safeText(body.agent || existing?.agent || "", 32),
    intent: safeText(body.intent || existing?.intent || "", 80),
    handled: body.handled === undefined ? existing?.handled : Boolean(body.handled),
    fallbackReason: safeText(body.fallbackReason || body.fallback_reason || existing?.fallbackReason || "", 48),
    modelTier: safeText(body.modelTier || body.model_tier || existing?.modelTier || "", 24),
    modelName: safeText(body.modelName || body.model_name || existing?.modelName || "", 64),
    timings: { ...(existing?.timings || {}), ...sanitizeTimings(body.timings) },
    utteranceLength: utterance ? utterance.length : Number(existing?.utteranceLength || 0),
    utterance: storeText && utterance ? utterance : (existing?.utterance || ""),
    errorType: safeText(body.errorType || body.error_type || existing?.errorType || "", 64),
    contextSource: safeText(body.contextSource || body.context_source || existing?.contextSource || "", 32),
    startedAt: body.startedAt || body.started_at || existing?.startedAt || nowIso(),
    updatedAt: nowIso()
  };
  if (!storeText) {
    delete next.utterance;
  }
  if (existing) {
    Object.assign(existing, next);
  } else {
    runtime.traces.unshift(next);
    runtime.stats.turns += 1;
  }
  runtime.traces = runtime.traces.slice(0, Math.max(20, Math.min(Number(options.limit) || 200, 1000)));
  runtime.stats.lastTurnAt = next.updatedAt;
  if (next.status === "handled" && previousStatus !== "handled") {
    runtime.stats.handled += 1;
  } else if (next.status === "fallback" && previousStatus !== "fallback") {
    runtime.stats.fallback += 1;
  } else if (next.status === "failed" && previousStatus !== "failed") {
    runtime.stats.failed += 1;
  }
  return { ...next };
}

function listAiTraces(state, filters = {}) {
  const runtime = ensureAiRuntimeState(state);
  const deviceId = safeText(filters.deviceId || filters.device_id || "", 96);
  const sessionId = safeText(filters.sessionId || filters.session_id || "", 96);
  const status = safeText(filters.status || "", 32);
  const fromMs = Date.parse(filters.from || filters.startedAfter || "");
  const toMs = Date.parse(filters.to || filters.startedBefore || "");
  const limit = Math.max(1, Math.min(Number(filters.limit) || 100, 300));
  return runtime.traces
    .filter((item) => !deviceId || item.deviceId === deviceId)
    .filter((item) => !sessionId || item.sessionId === sessionId)
    .filter((item) => !status || item.status === status)
    .filter((item) => !Number.isFinite(fromMs) || Date.parse(item.startedAt || item.updatedAt || "") >= fromMs)
    .filter((item) => !Number.isFinite(toMs) || Date.parse(item.startedAt || item.updatedAt || "") <= toMs)
    .slice(0, limit)
    .map((item) => ({ ...item }));
}

function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p / 100) - 1))];
}

function summarizeAiLatency(state, limit = 100) {
  const traces = listAiTraces(state, { limit: Math.max(1, Math.min(Number(limit) || 100, 300)) });
  const groups = { deterministic: [], lightweight: [], complex: [] };
  for (const trace of traces) {
    const group = trace.modelTier === "complex" ? "complex" : trace.modelTier === "lightweight" ? "lightweight" : "deterministic";
    groups[group].push(trace);
  }
  return Object.fromEntries(Object.entries(groups).map(([name, items]) => {
    const firstAudio = items.map((item) => Number(item.timings?.firstAudioMs)).filter(Number.isFinite);
    const failed = items.filter((item) => item.status === "failed" || item.errorType).length;
    return [name, {
      samples: items.length,
      firstAudioP50Ms: percentile(firstAudio, 50),
      firstAudioP95Ms: percentile(firstAudio, 95),
      failureRate: items.length ? Math.round(failed * 1000 / items.length) / 1000 : 0
    }];
  }));
}

module.exports = {
  agentBodyWithDeviceContext,
  deviceContext,
  ensureAiRuntimeState,
  listAiTraces,
  modelTierForFallback,
  summarizeAiLatency,
  updateDeviceContext,
  upsertAiTrace
};

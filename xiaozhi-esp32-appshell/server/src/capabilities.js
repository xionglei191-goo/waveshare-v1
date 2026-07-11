const childProcess = require("child_process");
const fs = require("fs");
const path = require("path");

const { enqueueXiaozhiToolCommand, resolveServerMediaForCommand } = require("./device-commands");
const {
  addSchedule,
  applyMusicTrack,
  deviceSummary,
  nextSchedule,
  pushNotification,
  setEnglishProgress
} = require("./domain");
const { recommendContent } = require("./content");
const { listMediaProgress, listResumeCandidates, listServerTracks } = require("./media");
const { addLearningRecord, createMemory, listLearningRecords, listMemory } = require("./memory");
const { normalizeFamilyMode, resolveMember } = require("./member-context");
const { buildResourceManifest } = require("./resources");
const { actionCategory, auditAction, ensureSecurityState, evaluateAction } = require("./security");
const { runHomeAssistantService } = require("./home-assistant");
const { refreshWeatherState } = require("./weather");

const DEFAULT_DEVICE_ID = "esp32-185b";

const AGENT_REGISTRY = [
  {
    id: "home",
    page: "home",
    status: "active",
    description: "Home overview: time, weather, next schedule, media and device state, plus router fallback to other agents.",
    tools: [
      "family.home.overview",
      "family.content.recommend",
      "family.memory.remember",
      "family.memory.search"
    ]
  },
  {
    id: "media",
    page: "music",
    status: "active",
    description: "Media playback, server podcasts, queue, resume and favorites.",
    tools: [
      "family.media.play",
      "family.media.resume",
      "family.media.next",
      "family.media.stop",
      "family.media.favorite"
    ]
  },
  {
    id: "device",
    page: "settings",
    status: "active",
    description: "Device status, diagnostics, network, storage and backend health.",
    tools: [
      "family.device.status",
      "family.device.diagnostics"
    ]
  },
  {
    id: "general",
    page: "ai",
    status: "active",
    description: "General entry and router fallback for cross-page requests.",
    tools: [
      "family.memory.remember",
      "family.memory.search",
      "family.media.play",
      "family.media.resume",
      "family.device.status",
      "family.schedule.today",
      "family.weather.today"
    ]
  },
  {
    id: "weather",
    page: "weather",
    status: "active",
    description: "Weather summary, air quality and refresh status.",
    tools: ["family.weather.today"]
  },
  {
    id: "schedule",
    page: "schedule",
    status: "active",
    description: "Family schedule lookup, add, completion and snooze.",
    tools: ["family.schedule.today", "family.schedule.add", "family.schedule.complete", "family.schedule.snooze"]
  },
  {
    id: "english",
    page: "english",
    status: "active",
    description: "English speaking practice status and start actions.",
    tools: ["family.english.status", "family.english.start", "family.english.record"]
  },
  {
    id: "album",
    page: "album",
    status: "active",
    description: "Album status and screensaver slideshow control.",
    tools: ["family.album.status", "family.album.slideshow_start", "family.album.slideshow_stop"]
  },
  {
    id: "tools",
    page: "apps",
    status: "active",
    description: "Safe OpenClaw, Home Assistant, Xiaomi speaker, NAS and tool status actions.",
    tools: [
      "family.openclaw.run",
      "family.homeassistant.scene",
      "family.speaker.command",
      "family.speaker.say",
      "family.speaker.volume",
      "family.speaker.play",
      "family.speaker.pause",
      "family.nas.music.scan",
      "family.tools.status"
    ]
  }
];

const TOOL_REGISTRY = {
  "family.home.overview": {
    name: "family.home.overview",
    action: "home.overview",
    description: "Return a compact home overview: time, weather, next schedule, active media and device/backend state.",
    risk: "low",
    modes: ["默认", "儿童", "访客"],
    roles: ["parent", "child", "member", "guest"],
    inputSchema: {
      type: "object",
      properties: {
        deviceId: { type: "string" }
      },
      additionalProperties: false
    }
  },
  "family.media.play": {
    name: "family.media.play",
    action: "music.server.play",
    description: "Play a local server track, subscribed podcast episode, queued media item or safe online audio fallback.",
    risk: "medium",
    modes: ["默认", "儿童"],
    roles: ["parent", "child", "member"],
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string" },
        query: { type: "string" },
        trackId: { type: "string" },
        url: { type: "string" },
        deviceId: { type: "string" }
      },
      additionalProperties: false
    }
  },
  "family.media.resume": {
    name: "family.media.resume",
    action: "music.server.play",
    description: "Continue the most recent unfinished family audio item.",
    risk: "low",
    modes: ["默认", "儿童"],
    roles: ["parent", "child", "member"],
    inputSchema: {
      type: "object",
      properties: {
        trackId: { type: "string" },
        deviceId: { type: "string" }
      },
      additionalProperties: false
    }
  },
  "family.media.next": {
    name: "family.media.next",
    action: "music.server.next",
    description: "Skip to the next server podcast or queued media item.",
    risk: "low",
    modes: ["默认", "儿童"],
    roles: ["parent", "child", "member"],
    inputSchema: {
      type: "object",
      properties: {
        deviceId: { type: "string" }
      },
      additionalProperties: false
    }
  },
  "family.media.stop": {
    name: "family.media.stop",
    action: "music.server.stop",
    description: "Stop the current server podcast or media stream.",
    risk: "low",
    modes: ["默认", "儿童", "访客"],
    roles: ["parent", "child", "member", "guest"],
    inputSchema: {
      type: "object",
      properties: {
        deviceId: { type: "string" }
      },
      additionalProperties: false
    }
  },
  "family.media.favorite": {
    name: "family.media.favorite",
    action: "music.server.favorite",
    description: "Favorite the current server podcast or media item.",
    risk: "low",
    modes: ["默认", "儿童"],
    roles: ["parent", "child", "member"],
    inputSchema: {
      type: "object",
      properties: {
        deviceId: { type: "string" }
      },
      additionalProperties: false
    }
  },
  "family.device.status": {
    name: "family.device.status",
    action: "device.status",
    description: "Return a compact device, network, backend, power and media status summary.",
    risk: "low",
    modes: ["默认"],
    roles: ["parent", "member"],
    inputSchema: {
      type: "object",
      properties: {
        deviceId: { type: "string" }
      },
      additionalProperties: false
    }
  },
  "family.device.diagnostics": {
    name: "family.device.diagnostics",
    action: "device.diagnostics",
    description: "Return a diagnostic summary with device commands, resource state, media progress and recent logs.",
    risk: "medium",
    modes: ["默认"],
    roles: ["parent", "member"],
    inputSchema: {
      type: "object",
      properties: {
        deviceId: { type: "string" }
      },
      additionalProperties: false
    }
  },
  "family.weather.today": {
    name: "family.weather.today",
    action: "weather.today",
    description: "Return today's local weather, temperature, humidity and air quality.",
    risk: "low",
    modes: ["默认", "儿童", "访客"],
    roles: ["parent", "child", "member", "guest"],
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false
    }
  },
  "family.schedule.today": {
    name: "family.schedule.today",
    action: "schedule.today",
    description: "Return today's family schedule and next unfinished item.",
    risk: "low",
    modes: ["默认", "儿童"],
    roles: ["parent", "child", "member"],
    inputSchema: {
      type: "object",
      properties: {
        memberId: { type: "string" }
      },
      additionalProperties: false
    }
  },
  "family.schedule.add": {
    name: "family.schedule.add",
    action: "schedule.add",
    description: "Add a family schedule item such as a reminder. Defaults to no fixed time.",
    risk: "low",
    modes: ["默认", "儿童"],
    roles: ["parent", "member"],
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        time: { type: "string" },
        note: { type: "string" },
        memberId: { type: "string" }
      },
      additionalProperties: false
    }
  },
  "family.schedule.complete": {
    name: "family.schedule.complete",
    action: "schedule.complete",
    description: "Mark a schedule item completed. Defaults to the next unfinished item.",
    risk: "low",
    modes: ["默认", "儿童"],
    roles: ["parent", "child", "member"],
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        memberId: { type: "string" }
      },
      additionalProperties: false
    }
  },
  "family.schedule.snooze": {
    name: "family.schedule.snooze",
    action: "schedule.snooze",
    description: "Snooze the next schedule item for a short time.",
    risk: "low",
    modes: ["默认", "儿童"],
    roles: ["parent", "child", "member"],
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        minutes: { type: "number" },
        memberId: { type: "string" }
      },
      additionalProperties: false
    }
  },
  "family.english.status": {
    name: "family.english.status",
    action: "english.status",
    description: "Return English practice topic, prompt, progress and recent records.",
    risk: "low",
    modes: ["默认", "儿童"],
    roles: ["parent", "child", "member"],
    inputSchema: {
      type: "object",
      properties: {
        memberId: { type: "string" }
      },
      additionalProperties: false
    }
  },
  "family.english.start": {
    name: "family.english.start",
    action: "english.start",
    description: "Start one English speaking practice session and record progress.",
    risk: "low",
    modes: ["默认", "儿童"],
    roles: ["parent", "child", "member"],
    inputSchema: {
      type: "object",
      properties: {
        memberId: { type: "string" }
      },
      additionalProperties: false
    }
  },
  "family.english.record": {
    name: "family.english.record",
    action: "english.record",
    description: "Record the result of an English practice session, such as how many prompts were completed correctly.",
    risk: "low",
    modes: ["默认", "儿童"],
    roles: ["parent", "child", "member"],
    inputSchema: {
      type: "object",
      properties: {
        correct: { type: "number" },
        total: { type: "number" },
        topic: { type: "string" },
        memberId: { type: "string" }
      },
      additionalProperties: false
    }
  },
  "family.album.status": {
    name: "family.album.status",
    action: "screensaver.status",
    description: "Return album and screensaver resource status.",
    risk: "low",
    modes: ["默认", "儿童", "访客"],
    roles: ["parent", "child", "member", "guest"],
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false
    }
  },
  "family.album.slideshow_start": {
    name: "family.album.slideshow_start",
    action: "screensaver.start",
    description: "Start album slideshow or screensaver on the round screen.",
    risk: "low",
    modes: ["默认", "儿童", "访客"],
    roles: ["parent", "child", "member", "guest"],
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false
    }
  },
  "family.album.slideshow_stop": {
    name: "family.album.slideshow_stop",
    action: "screensaver.stop",
    description: "Stop album slideshow or screensaver.",
    risk: "low",
    modes: ["默认", "儿童", "访客"],
    roles: ["parent", "child", "member", "guest"],
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false
    }
  },
  "family.openclaw.run": {
    name: "family.openclaw.run",
    action: "openclaw.run",
    description: "Run an allowlisted OpenClaw target on the backend after parent/admin confirmation.",
    risk: "high",
    modes: ["默认"],
    roles: ["parent", "admin"],
    inputSchema: {
      type: "object",
      properties: {
        target: { type: "string" },
        deviceId: { type: "string" },
        confirm: { type: "boolean" },
        confirmed: { type: "boolean" }
      },
      additionalProperties: false
    }
  },
  "family.homeassistant.scene": {
    name: "family.homeassistant.scene",
    action: "homeassistant.scene",
    description: "Turn on an allowlisted Home Assistant scene after parent/admin confirmation.",
    risk: "high",
    modes: ["默认"],
    roles: ["parent", "admin"],
    inputSchema: {
      type: "object",
      properties: {
        entityId: { type: "string" },
        entity_id: { type: "string" },
        scene: { type: "string" },
        deviceId: { type: "string" },
        confirm: { type: "boolean" },
        confirmed: { type: "boolean" }
      },
      additionalProperties: false
    }
  },
  "family.speaker.command": {
    name: "family.speaker.command",
    action: "speaker.command",
    description: "Send a text directive to the Xiaomi/XiaoAi speaker so its own assistant executes it (e.g. play a song, set a timer, control other home devices).",
    risk: "medium",
    modes: ["默认"],
    roles: ["parent", "member"],
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string" },
        deviceId: { type: "string" }
      },
      required: ["text"],
      additionalProperties: false
    }
  },
  "family.speaker.say": {
    name: "family.speaker.say",
    action: "speaker.say",
    description: "Make the Xiaomi/XiaoAi speaker speak a given text out loud (TTS) without executing it as a command.",
    risk: "medium",
    modes: ["默认"],
    roles: ["parent", "member"],
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string" },
        deviceId: { type: "string" }
      },
      required: ["text"],
      additionalProperties: false
    }
  },
  "family.speaker.volume": {
    name: "family.speaker.volume",
    action: "speaker.volume",
    description: "Set the Xiaomi/XiaoAi speaker volume. Accepts a percentage 0-100 or a 0-1 level.",
    risk: "low",
    modes: ["默认"],
    roles: ["parent", "member"],
    inputSchema: {
      type: "object",
      properties: {
        level: { type: "number" },
        deviceId: { type: "string" }
      },
      additionalProperties: false
    }
  },
  "family.speaker.play": {
    name: "family.speaker.play",
    action: "speaker.play",
    description: "Resume playback on the Xiaomi/XiaoAi speaker.",
    risk: "low",
    modes: ["默认"],
    roles: ["parent", "member"],
    inputSchema: {
      type: "object",
      properties: {
        deviceId: { type: "string" }
      },
      additionalProperties: false
    }
  },
  "family.speaker.pause": {
    name: "family.speaker.pause",
    action: "speaker.pause",
    description: "Pause playback on the Xiaomi/XiaoAi speaker.",
    risk: "low",
    modes: ["默认"],
    roles: ["parent", "member"],
    inputSchema: {
      type: "object",
      properties: {
        deviceId: { type: "string" }
      },
      additionalProperties: false
    }
  },
  "family.nas.music.scan": {
    name: "family.nas.music.scan",
    action: "nas.music.scan",
    description: "Scan the configured NAS or server music directory into the backend media library.",
    risk: "medium",
    modes: ["默认"],
    roles: ["parent", "member"],
    inputSchema: {
      type: "object",
      properties: {
        deviceId: { type: "string" }
      },
      additionalProperties: false
    }
  },
  "family.tools.status": {
    name: "family.tools.status",
    action: "app.status",
    description: "Return OpenClaw, Home Assistant and NAS integration status for the tools page.",
    risk: "low",
    modes: ["默认"],
    roles: ["parent", "member"],
    inputSchema: {
      type: "object",
      properties: {
        deviceId: { type: "string" }
      },
      additionalProperties: false
    }
  },
  "family.content.recommend": {
    name: "family.content.recommend",
    action: "content.recommend",
    description: "Recommend one catalog item such as a story, album, English pack or game.",
    risk: "low",
    modes: ["默认", "儿童"],
    roles: ["parent", "child", "member"],
    inputSchema: {
      type: "object",
      properties: {
        type: { type: "string" },
        memberId: { type: "string" }
      },
      additionalProperties: false
    }
  },
  "family.memory.remember": {
    name: "family.memory.remember",
    action: "memory.add",
    description: "Store a family memory or preference with role and mode policy.",
    risk: "medium",
    modes: ["默认", "儿童"],
    roles: ["parent", "child", "member"],
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string" },
        title: { type: "string" },
        memberId: { type: "string" },
        visibility: { type: "string" },
        tags: { type: "array", items: { type: "string" } }
      },
      required: ["text"],
      additionalProperties: false
    }
  },
  "family.memory.search": {
    name: "family.memory.search",
    action: "memory.search",
    description: "Read visible family memories for the current role and member context.",
    risk: "low",
    modes: ["默认", "儿童"],
    roles: ["parent", "child", "member"],
    inputSchema: {
      type: "object",
      properties: {
        memberId: { type: "string" },
        visibility: { type: "string" }
      },
      additionalProperties: false
    }
  }
};

function normalizeText(value, limit = 240) {
  return String(value || "").trim().slice(0, limit);
}

function normalizeDeviceId(value) {
  return normalizeText(value || DEFAULT_DEVICE_ID, 80).replace(/[^a-zA-Z0-9._-]/g, "_") || DEFAULT_DEVICE_ID;
}

function truthyFlag(value) {
  if (value === true || value === 1) {
    return true;
  }
  return ["1", "true", "yes", "y", "confirmed", "confirm"].includes(String(value || "").trim().toLowerCase());
}

function normalizeArgs(args = {}) {
  const source = args && typeof args === "object" ? args : {};
  return {
    ...source,
    deviceId: normalizeDeviceId(source.deviceId || source.device_id)
  };
}

function normalizeContext(state, input = {}) {
  const user = input.user && typeof input.user === "object" ? input.user : {};
  const modeContext = normalizeFamilyMode(input.familyMode || input.modeContext || input.mode || state.familyMode);
  const member = resolveMember(
    state,
    input.memberId || input.member || input.userId || user.id || "device",
    modeContext,
    input.role || user.role || ""
  );
  return {
    source: normalizeText(input.source || "agent", 48),
    page: normalizeText(input.page || "", 32),
    inputType: normalizeText(input.inputType || input.input_type || "text", 24),
    memberId: member.id,
    role: normalizeText(member.role || input.role || user.role || "", 32),
    memoryEnabled: member.memoryPolicy?.enabled !== false,
    modeContext,
    confirmed: truthyFlag(input.confirmed || input.confirm || input.confirmationConfirmed),
    requestId: normalizeText(input.requestId || input.request_id || "", 96),
    traceId: normalizeText(input.traceId || input.trace_id || "", 96)
  };
}

function listCapabilities() {
  return {
    schemaVersion: 1,
    agents: AGENT_REGISTRY,
    tools: Object.values(TOOL_REGISTRY).map((tool) => ({
      name: tool.name,
      description: tool.description,
      risk: tool.risk,
      roles: tool.roles,
      modes: tool.modes,
      action: tool.action,
      inputSchema: tool.inputSchema
    }))
  };
}

function capabilityMeta(name) {
  return TOOL_REGISTRY[String(name || "")] || null;
}

function isParentRole(role) {
  return role === "parent" || role === "admin";
}

function containsUrl(args) {
  const text = [
    args.url,
    args.audioUrl,
    args.audio_url,
    args.streamUrl,
    args.stream_url,
    args.query,
    args.text
  ].filter(Boolean).join(" ");
  return /https?:\/\//i.test(text);
}

function normalizeOpenClawTarget(value) {
  const raw = normalizeText(value || "default", 48);
  const safe = raw.replace(/[^a-zA-Z0-9._-]/g, "_");
  return safe || "default";
}

function configuredOpenClawTargets(config = {}) {
  return new Set((config.openclawTargets || ["default", "music", "diagnostics"]).map(String));
}

function openClawTargetDeniedReason(config, args) {
  const raw = normalizeText(args.target || "default", 48) || "default";
  const target = normalizeOpenClawTarget(raw);
  if (raw !== target) {
    return `OpenClaw target 不安全: ${raw}`;
  }
  if (!configuredOpenClawTargets(config).has(target)) {
    return `OpenClaw target 未允许: ${target}`;
  }
  return "";
}

function normalizeSceneEntityId(value) {
  const raw = normalizeText(value || "scene.family", 96).replace(/\s+/g, "_").toLowerCase();
  if (!/^scene\.[a-z0-9_]+$/.test(raw)) {
    return "";
  }
  return raw;
}

function configuredHomeAssistantScenes(config = {}) {
  const defaults = [
    "scene.family",
    "scene.home",
    "scene.evening",
    "scene.good_night",
    "scene.morning",
    "scene.away"
  ];
  return new Set((config.homeAssistantScenes || defaults).map((item) => normalizeSceneEntityId(item)).filter(Boolean));
}

function homeAssistantSceneDeniedReason(config, args) {
  const entityId = normalizeSceneEntityId(args.entityId || args.entity_id || args.scene || "scene.family");
  if (!entityId) {
    return "Home Assistant 场景名称不安全";
  }
  if (!configuredHomeAssistantScenes(config).has(entityId)) {
    return `Home Assistant 场景未允许: ${entityId}`;
  }
  return "";
}

function nasScanDeniedReason(args) {
  if (args.path || args.root || args.dir || args.directory) {
    return "NAS 扫描目录只能使用后端安全配置";
  }
  return "";
}

function capabilityDeniedReason(state, tool, args, context, config) {
  if (!tool) {
    return "unknown capability";
  }
  if (tool.modes?.length && !tool.modes.includes(context.modeContext) && !isParentRole(context.role)) {
    return `${context.modeContext} 模式暂不开放 ${tool.name}`;
  }
  if (tool.roles?.length && context.role && !tool.roles.includes(context.role) && !isParentRole(context.role)) {
    return `${context.role} 角色暂不开放 ${tool.name}`;
  }
  if (toolRequiresConfirmation(tool) && !isParentRole(context.role)) {
    return "高风险工具需要家长权限";
  }
  if (tool.name === "family.memory.remember" && (context.modeContext === "访客" || context.role === "guest")) {
    return "访客模式不写入家庭记忆";
  }
  if ((tool.name === "family.memory.remember" || tool.name === "family.memory.search") && !context.memoryEnabled) {
    return "当前成员已关闭家庭记忆";
  }
  if (tool.name === "family.media.play" && containsUrl(args) && !isParentRole(context.role)) {
    return "外部直链播放需要家长权限";
  }
  if (tool.name === "family.openclaw.run") {
    return openClawTargetDeniedReason(config, args);
  }
  if (tool.name === "family.homeassistant.scene") {
    return homeAssistantSceneDeniedReason(config, args);
  }
  if (tool.name === "family.nas.music.scan") {
    return nasScanDeniedReason(args);
  }
  return "";
}

function denyCapability(state, tool, args, context, reason, decision = null) {
  const auditDecision = decision || {
    allowed: false,
    mode: context.modeContext,
    category: actionCategory(tool?.action || tool?.name || "agent.unknown"),
    reason
  };
  auditAction(state, tool?.action || tool?.name || "agent.unknown", {
    ...args,
    memberId: context.memberId,
    role: context.role,
    modeContext: context.modeContext
  }, auditDecision, "denied");
  return {
    accepted: false,
    denied: true,
    status: "denied",
    tool: tool?.name || "",
    reason,
    speech: reason,
    display: {
      toast: "权限限制"
    }
  };
}

function toolRequiresConfirmation(tool) {
  return tool?.risk === "high";
}

function hasConfirmation(args, context) {
  return truthyFlag(args.confirmed || args.confirm || context.confirmed || context.confirm);
}

function confirmationRequiredCapability(state, tool, args, context, decision) {
  auditAction(state, tool.action, {
    ...args,
    memberId: context.memberId,
    role: context.role,
    modeContext: context.modeContext
  }, decision, "confirmation_required");
  return {
    accepted: true,
    status: "requires_confirmation",
    tool: tool.name,
    requiresConfirmation: true,
    confirmationRequired: true,
    speech: "这个家庭工具需要家长确认后才能执行。",
    display: {
      page: "apps",
      toast: "需要家长确认"
    },
    result: {
      action: tool.action,
      risk: tool.risk
    }
  };
}

async function prepareCapability(name, args, state, config) {
  const tool = capabilityMeta(name);
  const normalized = normalizeArgs(args);
  if (!tool) {
    return {};
  }
  if (name === "family.media.play") {
    const body = {
      tool: "family.media.play",
      text: normalized.text || normalized.query || "播放媒体",
      params: normalized
    };
    return {
      resolvedMedia: await resolveServerMediaForCommand(state, config, body)
    };
  }
  if (name === "family.weather.today") {
    const preparedState = { weather: JSON.parse(JSON.stringify(state.weather || {})) };
    return {
      weatherRefresh: await refreshWeatherState(preparedState, config),
      weather: preparedState.weather
    };
  }
  return {};
}

function executeGatewayMediaTool(state, config, gatewayTool, args, prepared, context = {}) {
  return enqueueXiaozhiToolCommand(state, config, {
    tool: gatewayTool,
    text: args.text || args.query || gatewayTool,
    params: args,
    _resolvedMedia: prepared?.resolvedMedia || null,
    idempotencyKey: context.requestId || context.traceId || ""
  });
}

function mediaCapabilityResult(name, result, toast) {
  return {
    ...result,
    tool: name,
    status: result?.accepted ? "accepted" : "failed",
    display: { page: "music", toast }
  };
}

function compactStatusSpeech(summary) {
  const backend = summary.backend?.publicBaseUrl || "后端";
  const wifi = summary.connectivity?.wifi?.status || summary.connectivity?.network?.status || "已连接";
  const music = summary.music?.server?.available
    ? `服务器媒体 ${summary.music.server.trackCount} 项`
    : "服务器媒体暂无";
  return `设备在线，${wifi}，${music}，后端 ${backend} 正常。`;
}

function executeHomeOverview(state, config) {
  const summary = deviceSummary(state, config);
  const weather = summary.weather || {};
  const next = summary.schedule?.next || {};
  const music = summary.music?.server?.playing
    ? `正在播放 ${summary.music.server.title || "服务器媒体"}`
    : (summary.music?.sd?.playing ? `正在播放 ${summary.music.sd.title || "本地音乐"}` : "音乐未播放");
  const hasNext = next.id && next.id !== "none";
  const scheduleLine = hasNext ? `下一项日程 ${next.time} ${next.title}` : "今天没有待办日程";
  const speech = `${weather.summary || weather.condition || "天气暂无数据"}，${scheduleLine}，${music}。`;
  return {
    accepted: true,
    status: "accepted",
    tool: "family.home.overview",
    speech,
    display: {
      page: "home",
      toast: "首页概览"
    },
    result: {
      weather,
      schedule: {
        next,
        remaining: Array.isArray(summary.schedule?.today)
          ? summary.schedule.today.filter((item) => !item.done).length
          : 0
      },
      music: summary.music,
      familyMode: summary.familyMode,
      device: {
        backend: summary.backend?.publicBaseUrl || "",
        notifications: (summary.notifications || []).slice(0, 3)
      }
    }
  };
}

function executeDeviceStatus(state, config) {
  const summary = deviceSummary(state, config);
  return {
    accepted: true,
    status: "accepted",
    tool: "family.device.status",
    speech: compactStatusSpeech(summary),
    display: {
      page: "settings",
      toast: "设备状态已更新"
    },
    result: {
      summary
    }
  };
}

function executeDeviceDiagnostics(state, config, args) {
  const summary = deviceSummary(state, config);
  const manifest = buildResourceManifest(state, config);
  const deviceId = normalizeDeviceId(args.deviceId);
  return {
    accepted: true,
    status: "accepted",
    tool: "family.device.diagnostics",
    speech: `诊断完成：资源 ${manifest.packs?.length || 0} 个包，待执行命令 ${(state.deviceCommands?.queue || []).length} 条。`,
    display: {
      page: "settings",
      toast: "诊断完成"
    },
    result: {
      summary,
      resourceStatus: {
        version: manifest.version,
        packCount: manifest.packs?.length || 0,
        diagnostics: manifest.diagnostics || {}
      },
      commandStatus: {
        pending: (state.deviceCommands?.queue || []).filter((command) => command.deviceId === deviceId || command.deviceId === "all").slice(0, 8),
        stats: state.deviceCommands?.stats || {}
      },
      mediaProgress: listMediaProgress(state, config, { deviceId, limit: 8 }),
      resumeCandidates: listResumeCandidates(state, config, { deviceId, limit: 5 }),
      recentLogs: state.deviceLogs?.slice(0, 10) || []
    }
  };
}

function executeWeatherToday(state, prepared = {}) {
  if (prepared.weather) {
    state.weather = prepared.weather;
  }
  const weather = state.weather || {};
  const refreshFailed = prepared.weatherRefresh && !prepared.weatherRefresh.ok;
  const staleSuffix = refreshFailed && weather.updatedAt ? `，使用 ${String(weather.updatedAt).slice(11, 16)} 的缓存数据` : "";
  const speech = `今天${weather.location || "家"}${weather.summary || weather.condition || "天气暂无数据"}，体感 ${weather.apparentTemperature ?? "--"}℃，湿度 ${weather.humidity ?? "--"}%，${weather.air || ""}${staleSuffix}`.trim();
  return {
    accepted: true,
    status: "accepted",
    tool: "family.weather.today",
    speech,
    display: {
      page: "weather",
      toast: refreshFailed ? "更新失败 · 使用缓存" : "天气已更新"
    },
    result: {
      weather
    }
  };
}

function executeScheduleToday(state) {
  const next = nextSchedule(state);
  const today = Array.isArray(state.schedule) ? state.schedule : [];
  const undone = today.filter((item) => !item.done).length;
  return {
    accepted: true,
    status: "accepted",
    tool: "family.schedule.today",
    speech: undone > 0
      ? `今天还有 ${undone} 个日程，下一项是 ${next.time} ${next.title}。`
      : "今天的日程都完成了。",
    display: {
      page: "schedule",
      toast: "今日日程"
    },
    result: {
      next,
      today
    }
  };
}

function executeScheduleAdd(state, args) {
  const title = normalizeText(args.title || args.text || args.name || "", 80);
  if (!title) {
    return {
      accepted: false,
      status: "failed",
      tool: "family.schedule.add",
      reason: "schedule title is required",
      speech: "请告诉我要添加的日程内容。",
      display: { page: "schedule", toast: "缺少日程内容" }
    };
  }
  const item = addSchedule(state, {
    title,
    time: normalizeText(args.time || args.at || "", 40),
    note: normalizeText(args.note || args.detail || "", 120)
  });
  pushNotification(state, "日程", `新增日程：${item.title}`);
  const timeLabel = item.time && item.time !== "--:--" ? `${item.time} ` : "";
  return {
    accepted: true,
    status: "accepted",
    tool: "family.schedule.add",
    speech: `好的，已添加日程：${timeLabel}${item.title}。`,
    display: {
      page: "schedule",
      toast: "日程已添加"
    },
    result: {
      item,
      next: nextSchedule(state),
      today: state.schedule
    }
  };
}

function findScheduleTarget(state, args = {}) {
  const today = Array.isArray(state.schedule) ? state.schedule : [];
  const id = normalizeText(args.id || args.scheduleId || args.schedule_id || "", 80);
  return (id ? today.find((item) => item.id === id) : null) || today.find((item) => !item.done) || today[0] || null;
}

function executeScheduleComplete(state, args) {
  const target = findScheduleTarget(state, args);
  if (!target) {
    return {
      accepted: false,
      status: "failed",
      tool: "family.schedule.complete",
      reason: "schedule is empty",
      speech: "今天没有可完成的日程。",
      display: { page: "schedule", toast: "暂无日程" }
    };
  }
  target.done = true;
  target.completedAt = new Date().toISOString();
  pushNotification(state, "日程", `${target.title} 已完成`);
  return {
    accepted: true,
    status: "accepted",
    tool: "family.schedule.complete",
    speech: `${target.title} 已完成。`,
    display: {
      page: "schedule",
      toast: "日程已完成"
    },
    result: {
      item: target,
      next: nextSchedule(state),
      today: state.schedule
    }
  };
}

function executeScheduleSnooze(state, args) {
  const target = findScheduleTarget(state, args);
  if (!target) {
    return {
      accepted: false,
      status: "failed",
      tool: "family.schedule.snooze",
      reason: "schedule is empty",
      speech: "今天没有可稍后提醒的日程。",
      display: { page: "schedule", toast: "暂无日程" }
    };
  }
  const minutes = Math.max(1, Math.min(Number(args.minutes || 10) || 10, 120));
  target.snoozedAt = new Date().toISOString();
  target.snoozeMinutes = minutes;
  pushNotification(state, "日程", `${target.title} 稍后 ${minutes} 分钟提醒`, "warn");
  return {
    accepted: true,
    status: "accepted",
    tool: "family.schedule.snooze",
    speech: `好的，${target.title} 稍后 ${minutes} 分钟提醒。`,
    display: {
      page: "schedule",
      toast: "已稍后提醒"
    },
    result: {
      item: target,
      minutes,
      today: state.schedule
    }
  };
}

function executeEnglishStatus(state, args, context) {
  const memberId = args.memberId || context.memberId;
  const records = listLearningRecords(state, { memberId, type: "english" }).slice(0, 8);
  const english = state.english || {};
  return {
    accepted: true,
    status: "accepted",
    tool: "family.english.status",
    speech: `今天英语主题是 ${english.topic || "口语练习"}，进度 ${english.progress || "0/5"}。`,
    display: {
      page: "english",
      toast: "英语状态"
    },
    result: {
      english,
      records
    }
  };
}

function executeEnglishStart(state, args, context) {
  state.english = state.english || {};
  state.english.history = Array.isArray(state.english.history) ? state.english.history : [];
  const done = Number(String(state.english.progress || "0/5").split("/")[0] || 0) + 1;
  setEnglishProgress(state, done);
  state.english.lastStartedAt = new Date().toISOString();
  state.english.history.unshift({
    at: state.english.lastStartedAt,
    topic: state.english.topic || "Daily Talk",
    source: "agent"
  });
  state.english.history = state.english.history.slice(0, 20);
  const record = addLearningRecord(state, {
    memberId: args.memberId || context.memberId || "child",
    type: "english",
    title: state.english.topic || "Daily Talk",
    score: state.english.score,
    progress: state.english.progress,
    source: "agent",
    metadata: { prompt: state.english.prompt || "" }
  });
  pushNotification(state, "英语", "已开始一次口语练习");
  return {
    accepted: true,
    status: "accepted",
    tool: "family.english.start",
    speech: `好的，开始英语练习：${state.english.prompt || state.english.topic || "跟读一句话"}。`,
    display: {
      page: "english",
      toast: "开始练习"
    },
    result: {
      english: state.english,
      record
    }
  };
}

function executeEnglishRecord(state, args, context) {
  state.english = state.english || {};
  const memberId = args.memberId || context.memberId || "child";
  const correct = Math.max(0, Math.min(Number(args.correct ?? args.done ?? args.score ?? 0) || 0, 5));
  setEnglishProgress(state, correct);
  const topic = normalizeText(args.topic || state.english.topic || "Daily Talk", 80);
  const record = addLearningRecord(state, {
    memberId,
    type: "english",
    title: topic,
    score: state.english.score,
    progress: state.english.progress,
    source: "agent",
    metadata: { correct }
  });
  pushNotification(state, "英语", `记录一次口语练习：答对 ${correct} 句`);
  return {
    accepted: true,
    status: "accepted",
    tool: "family.english.record",
    speech: `好的，记录本次练习，答对 ${correct} 句，进度 ${state.english.progress}。`,
    display: {
      page: "english",
      toast: "记录练习"
    },
    result: {
      english: state.english,
      record
    }
  };
}

function albumItems(state) {
  return (state.content?.catalog || []).filter((item) => item.type === "album").slice(0, 20);
}

function executeAlbumStatus(state, config) {
  const manifest = buildResourceManifest(state, config);
  const albums = albumItems(state);
  return {
    accepted: true,
    status: "accepted",
    tool: "family.album.status",
    speech: albums.length > 0
      ? `相册里有 ${albums.length} 个资源，屏保${state.screensaver?.active ? "正在运行" : "未开启"}。`
      : `相册暂无已导入照片，屏保${state.screensaver?.active ? "正在运行" : "未开启"}。`,
    display: {
      page: "album",
      toast: "相册状态"
    },
    result: {
      screensaver: state.screensaver || {},
      albums,
      resourceStatus: {
        version: manifest.version,
        packCount: manifest.packs?.length || 0,
        diagnostics: manifest.diagnostics || {}
      }
    }
  };
}

function executeAlbumSlideshow(state, active) {
  state.screensaver = state.screensaver || {};
  state.screensaver.active = Boolean(active);
  state.screensaver.mode = state.screensaver.mode || "album";
  state.screensaver.updatedAt = new Date().toISOString();
  pushNotification(state, "相册", active ? "开始家庭相册屏保" : "停止家庭相册屏保");
  return {
    accepted: true,
    status: "accepted",
    tool: active ? "family.album.slideshow_start" : "family.album.slideshow_stop",
    speech: active ? "好的，开始播放家庭相册。" : "好的，已停止家庭相册。",
    display: {
      page: "album",
      toast: active ? "开始相册" : "停止相册"
    },
    result: {
      screensaver: state.screensaver,
      albums: albumItems(state)
    }
  };
}

function executeContentRecommend(state, args, context) {
  const recommendation = recommendContent(state, {
    ...args,
    memberId: args.memberId || context.memberId
  });
  return {
    accepted: Boolean(recommendation.itemId),
    status: recommendation.itemId ? "accepted" : "failed",
    tool: "family.content.recommend",
    speech: recommendation.itemId ? recommendation.reason : "内容库现在还是空的。",
    display: {
      page: "ai",
      toast: "内容推荐"
    },
    result: {
      recommendation
    }
  };
}

function executeMemoryRemember(state, args, context) {
  const item = createMemory(state, {
    ...args,
    memberId: args.memberId || context.memberId,
    source: "agent"
  });
  return {
    accepted: true,
    status: "accepted",
    tool: "family.memory.remember",
    speech: `我记住了：${item.title}`,
    display: {
      toast: "已写入家庭记忆"
    },
    result: {
      item
    }
  };
}

function executeMemorySearch(state, args, context) {
  const items = listMemory(state, {
    ...args,
    memberId: args.memberId || (context.role === "parent" ? "" : context.memberId)
  }).slice(0, 10);
  return {
    accepted: true,
    status: "accepted",
    tool: "family.memory.search",
    speech: items.length > 0 ? `找到 ${items.length} 条相关家庭记忆。` : "暂时没有找到相关家庭记忆。",
    display: {
      toast: "家庭记忆"
    },
    result: {
      items
    }
  };
}

function ensureOpenClawState(state) {
  state.openclaw = state.openclaw || { jobs: [], tasks: [], lastRunAt: null };
  state.openclaw.jobs = Array.isArray(state.openclaw.jobs) ? state.openclaw.jobs : [];
  state.openclaw.tasks = Array.isArray(state.openclaw.tasks) ? state.openclaw.tasks : [];
}

function ensureIntegrationState(state) {
  state.integrations = state.integrations || {};
  state.integrations.homeAssistant = state.integrations.homeAssistant || {
    configured: false,
    lastActionAt: null,
    history: []
  };
  state.integrations.homeAssistant.history = Array.isArray(state.integrations.homeAssistant.history)
    ? state.integrations.homeAssistant.history
    : [];
  state.integrations.nas = state.integrations.nas || {
    configured: false,
    lastScanAt: null,
    history: []
  };
  state.integrations.nas.history = Array.isArray(state.integrations.nas.history)
    ? state.integrations.nas.history
    : [];
}

function pushOpenClawJob(state, job) {
  state.openclaw.jobs.unshift(job);
  state.openclaw.jobs = state.openclaw.jobs.slice(0, 80);
  state.openclaw.lastRunAt = job.finishedAt || job.startedAt || job.createdAt;
}

function executableStatus(command) {
  if (!command) {
    return "missing command";
  }
  try {
    fs.accessSync(command, fs.constants.X_OK);
    return "";
  } catch (error) {
    return error.code === "ENOENT" ? "command not found" : "command not executable";
  }
}

function outputSummary(value) {
  return String(value || "").trim().slice(0, 600);
}

function appendLimited(buffer, chunk, limit = 128 * 1024) {
  const next = `${buffer}${chunk}`;
  return next.length > limit ? next.slice(0, limit) : next;
}

function spawnCommand(command, args, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let child = null;

    const finish = (result) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve({
        pid: child?.pid || null,
        stdout,
        stderr,
        timedOut,
        ...result
      });
    };

    try {
      child = childProcess.spawn(command, args, {
        stdio: ["ignore", "pipe", "pipe"]
      });
    } catch (error) {
      finish({ status: null, signal: null, error });
      return;
    }

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 500).unref();
    }, timeoutMs).unref();

    child.stdout.on("data", (chunk) => {
      stdout = appendLimited(stdout, chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr = appendLimited(stderr, chunk);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      finish({ status: null, signal: null, error });
    });
    child.on("close", (status, signal) => {
      clearTimeout(timer);
      finish({ status, signal, error: null });
    });
  });
}

async function executeOpenClawRun(state, config, args, context) {
  ensureOpenClawState(state);
  const target = normalizeOpenClawTarget(args.target || "default");
  const createdAt = new Date().toISOString();
  const job = {
    id: `oc_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`,
    target,
    status: "queued",
    command: config.openclawCommand || "",
    createdAt,
    queuedAt: createdAt,
    startedAt: null,
    finishedAt: null,
    durationMs: 0,
    pid: null,
    exitCode: null,
    signal: null,
    stdout: "",
    stderr: "",
    memberId: context.memberId,
    mode: context.modeContext,
    requestId: context.requestId || context.traceId || "",
    message: ""
  };

  const preflight = executableStatus(config.openclawCommand);
  if (preflight) {
    job.sourceStatus = "unavailable";
    job.status = "failed";
    job.finishedAt = new Date().toISOString();
    job.message = `OpenClaw ${preflight}: ${config.openclawCommand || "(empty)"}`;
    pushOpenClawJob(state, job);
    pushNotification(state, "OpenClaw", job.message, "warn");
    return {
      accepted: true,
      status: "accepted",
      tool: "family.openclaw.run",
      speech: job.message,
      display: { page: "apps", toast: "OpenClaw 任务已记录" },
      result: { executed: false, job },
      job
    };
  }

  job.status = "started";
  job.sourceStatus = "real";
  job.startedAt = new Date().toISOString();
  const start = Date.now();
  const result = await spawnCommand(config.openclawCommand, [target], config.openclawTimeoutMs || 10000);
  job.finishedAt = new Date().toISOString();
  job.durationMs = Date.now() - start;
  job.pid = result.pid || null;
  job.exitCode = typeof result.status === "number" ? result.status : null;
  job.signal = result.signal || null;
  job.stdout = outputSummary(result.stdout);
  job.stderr = outputSummary(result.stderr || result.error?.message || "");
  if (result.timedOut) {
    job.status = "timeout";
    job.message = `OpenClaw 超时: ${target}`;
  } else if (result.status === 0) {
    job.status = "success";
    job.message = `OpenClaw 完成: ${target}`;
  } else {
    job.status = "failed";
    job.message = `OpenClaw 失败: ${target} exit=${job.exitCode ?? "unknown"}`;
  }
  pushOpenClawJob(state, job);
  config.observability?.recordDependency("openclaw", { ok: job.status === "success", status: job.status, durationMs: job.durationMs, error: job.status === "success" ? "" : job.message });
  pushNotification(state, "OpenClaw", job.message, job.status === "success" ? "info" : "warn");
  return {
    accepted: true,
    status: "accepted",
    tool: "family.openclaw.run",
    speech: job.message,
    display: { page: "apps", toast: "OpenClaw 任务已执行" },
    result: { executed: job.status === "success", job },
    job
  };
}

function sendHomeAssistantScene(state, config, args) {
  ensureIntegrationState(state);
  const now = new Date().toISOString();
  const entityId = normalizeSceneEntityId(args.entityId || args.entity_id || args.scene || "scene.family") || "scene.family";
  const record = {
    id: `ha_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`,
    at: now,
    domain: "scene",
    service: "turn_on",
    serviceData: { entity_id: entityId },
    status: "simulated",
    sourceStatus: "simulated",
    requestId: args.requestId || args.request_id || "",
    message: ""
  };

  if (!config.homeAssistantUrl || !config.homeAssistantToken) {
    record.message = `模拟 HA scene.turn_on ${entityId}`;
    state.integrations.homeAssistant.configured = false;
    state.integrations.homeAssistant.history.unshift(record);
    state.integrations.homeAssistant.history = state.integrations.homeAssistant.history.slice(0, 50);
    return { executed: false, record, message: record.message };
  }

  const url = `${config.homeAssistantUrl.replace(/\/$/, "")}/api/services/scene/turn_on`;
  const response = runHomeAssistantService(config, "scene", "turn_on", record.serviceData);
  config.observability?.recordDependency("home-assistant", { ok: response.ok, statusCode: response.httpCode, durationMs: response.durationMs, error: response.ok ? "" : response.stderr });
  record.status = response.ok ? "success" : "failed";
  record.sourceStatus = response.ok ? "real" : "unavailable";
  record.url = url;
  record.httpCode = response.httpCode;
  record.exitCode = response.exitCode;
  record.signal = response.signal;
  record.durationMs = response.durationMs;
  record.stdout = response.stdout;
  record.stderr = response.stderr;
  record.message = response.ok
    ? `HA scene.turn_on ${entityId} 已确认 http ${response.httpCode}`
    : `HA scene.turn_on ${entityId} 失败 http ${response.httpCode || "--"} exit=${response.exitCode ?? "--"}`;
  state.integrations.homeAssistant.configured = true;
  state.integrations.homeAssistant.lastActionAt = now;
  state.integrations.homeAssistant.history.unshift(record);
  state.integrations.homeAssistant.history = state.integrations.homeAssistant.history.slice(0, 50);
  return { executed: response.ok, record, message: record.message };
}

function executeHomeAssistantScene(state, config, args) {
  const result = sendHomeAssistantScene(state, config, args);
  pushNotification(state, "Home Assistant", result.message, result.executed ? "info" : "warn");
  return {
    accepted: true,
    status: "accepted",
    tool: "family.homeassistant.scene",
    speech: result.message,
    display: { page: "apps", toast: "家庭场景已处理" },
    result,
    record: result.record
  };
}

function normalizeVolumeLevel(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return null;
  }
  // Accept either a 0-100 percentage or a 0-1 level.
  const level = n > 1 ? Math.round(n) / 100 : n;
  return Math.max(0, Math.min(level, 1));
}

function speakerServiceParts(config) {
  const raw = String(config.speakerService || "xiaomi_miot.intelligent_speaker");
  const idx = raw.indexOf(".");
  if (idx <= 0) {
    return { domain: "xiaomi_miot", service: "intelligent_speaker" };
  }
  return { domain: raw.slice(0, idx), service: raw.slice(idx + 1) };
}

function buildSpeakerCall(config, mode, args) {
  const entityId = config.speakerEntity;
  if (mode === "volume") {
    const level = normalizeVolumeLevel(args.level ?? args.volume ?? args.value);
    const applied = level == null ? 0.3 : level;
    return {
      domain: "media_player",
      service: "volume_set",
      serviceData: { entity_id: entityId, volume_level: applied },
      label: `音量 ${Math.round(applied * 100)}%`
    };
  }
  if (mode === "play") {
    return { domain: "media_player", service: "media_play", serviceData: { entity_id: entityId }, label: "继续播放" };
  }
  if (mode === "pause") {
    return { domain: "media_player", service: "media_pause", serviceData: { entity_id: entityId }, label: "暂停" };
  }
  const { domain, service } = speakerServiceParts(config);
  const text = normalizeText(args.text || "", 240);
  return {
    domain,
    service,
    serviceData: { entity_id: entityId, text, execute: mode === "command" },
    label: mode === "command" ? `执行指令：${text}` : `播报：${text}`
  };
}

function sendHomeAssistantSpeaker(state, config, mode, args) {
  ensureIntegrationState(state);
  const now = new Date().toISOString();
  const call = buildSpeakerCall(config, mode, args);
  const record = {
    id: `spk_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`,
    at: now,
    domain: call.domain,
    service: call.service,
    serviceData: call.serviceData,
    speakerMode: mode,
    status: "simulated",
    sourceStatus: "simulated",
    requestId: args.requestId || args.request_id || "",
    message: ""
  };

  if (!config.homeAssistantUrl || !config.homeAssistantToken || !config.speakerEntity) {
    const missing = !config.speakerEntity ? "未配置音箱实体" : "未配置 Home Assistant";
    record.message = `模拟音箱${call.label}（${missing}）`;
    state.integrations.homeAssistant.history.unshift(record);
    state.integrations.homeAssistant.history = state.integrations.homeAssistant.history.slice(0, 50);
    return { executed: false, configured: false, record, message: record.message };
  }

  const response = runHomeAssistantService(config, call.domain, call.service, call.serviceData);
  config.observability?.recordDependency("home-assistant", { ok: response.ok, statusCode: response.httpCode, durationMs: response.durationMs, error: response.ok ? "" : response.stderr });
  record.status = response.ok ? "success" : "failed";
  record.sourceStatus = response.ok ? "real" : "unavailable";
  record.httpCode = response.httpCode;
  record.exitCode = response.exitCode;
  record.signal = response.signal;
  record.durationMs = response.durationMs;
  record.stdout = response.stdout;
  record.stderr = response.stderr;
  record.message = response.ok
    ? `音箱${call.label} 已确认 http ${response.httpCode}`
    : `音箱${call.label} 失败 http ${response.httpCode || "--"} exit=${response.exitCode ?? "--"}`;
  state.integrations.homeAssistant.configured = true;
  state.integrations.homeAssistant.lastActionAt = now;
  state.integrations.homeAssistant.history.unshift(record);
  state.integrations.homeAssistant.history = state.integrations.homeAssistant.history.slice(0, 50);
  return { executed: response.ok, configured: true, record, message: record.message };
}

function executeSpeaker(state, config, mode, args) {
  if ((mode === "say" || mode === "command") && !normalizeText(args.text || "", 240)) {
    return {
      accepted: false,
      status: "failed",
      tool: `family.speaker.${mode}`,
      reason: "speaker text required",
      speech: mode === "command" ? "请告诉我要让音箱做什么。" : "请告诉我要让音箱说什么。",
      display: { page: "apps", toast: "缺少内容" }
    };
  }
  const result = sendHomeAssistantSpeaker(state, config, mode, args);
  pushNotification(state, "小米音箱", result.message, result.executed ? "info" : "warn");
  return {
    accepted: true,
    status: "accepted",
    tool: `family.speaker.${mode}`,
    speech: result.message,
    display: { page: "apps", toast: "音箱已处理" },
    result,
    record: result.record
  };
}

function scanNasMusic(config) {
  if (!config.nasMusicDir) {
    return { executed: false, tracks: [], message: "NAS 音乐目录未配置" };
  }
  const root = path.resolve(config.nasMusicDir);
  if (!fs.existsSync(root)) {
    return { executed: false, tracks: [], message: `NAS 目录不存在: ${root}` };
  }

  const audioExt = new Set([".mp3", ".ogg", ".opus", ".wav", ".m4a", ".flac"]);
  const tracks = [];
  const walk = (dir) => {
    if (tracks.length >= 100) {
      return;
    }
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (audioExt.has(path.extname(entry.name).toLowerCase())) {
        tracks.push({
          title: path.basename(entry.name, path.extname(entry.name)),
          artist: "NAS",
          path: path.relative(root, fullPath),
          durationSec: 0
        });
      }
      if (tracks.length >= 100) {
        return;
      }
    }
  };
  walk(root);
  return { executed: true, sourceStatus: "real", tracks, message: `NAS 扫描到 ${tracks.length} 首音频` };
}

function scanServerMusic(config) {
  const tracks = listServerTracks(config);
  return { executed: true, sourceStatus: "real", tracks, message: `服务器媒体扫描到 ${tracks.length} 条音频` };
}

function executeNasMusicScan(state, config) {
  ensureIntegrationState(state);
  const result = config.nasMusicDir ? scanNasMusic(config) : scanServerMusic(config);
  if (result.tracks.length > 0) {
    state.music.server.tracks = result.tracks;
    state.music.server.available = true;
    state.music.server.source = "NAS/服务器播客";
    state.music.server.detail = result.message;
    state.music.server.currentIndex = 0;
    applyMusicTrack(state.music.server);
  }
  state.integrations.nas.configured = Boolean(config.nasMusicDir);
  state.integrations.nas.lastScanAt = new Date().toISOString();
  state.integrations.nas.history.unshift({
    id: `nas_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`,
    at: state.integrations.nas.lastScanAt,
    configured: Boolean(config.nasMusicDir),
    tracks: result.tracks.length,
    message: result.message
  });
  state.integrations.nas.history = state.integrations.nas.history.slice(0, 50);
  pushNotification(state, "NAS 音乐", result.message, result.tracks.length > 0 ? "info" : "warn");
  return {
    accepted: true,
    status: "accepted",
    tool: "family.nas.music.scan",
    speech: result.message,
    display: { page: "apps", toast: "NAS 扫描完成" },
    result: {
      ...result,
      history: state.integrations.nas.history.slice(0, 5)
    }
  };
}

function executeToolsStatus(state, config) {
  ensureOpenClawState(state);
  ensureIntegrationState(state);
  const openclawReady = !executableStatus(config.openclawCommand);
  const haConfigured = Boolean(config.homeAssistantUrl && config.homeAssistantToken);
  const nasConfigured = Boolean(config.nasMusicDir);
  return {
    accepted: true,
    status: "accepted",
    tool: "family.tools.status",
    speech: `工具状态：OpenClaw ${openclawReady ? "可用" : "未配置"}，HA ${haConfigured ? "已配置" : "模拟模式"}，NAS ${nasConfigured ? "已配置" : "使用服务器媒体"}。`,
    display: { page: "apps", toast: "工具状态" },
    result: {
      openclaw: {
        configured: openclawReady,
        command: config.openclawCommand,
        allowedTargets: Array.from(configuredOpenClawTargets(config)),
        latestJob: state.openclaw.jobs[0] || null,
        tasks: state.openclaw.tasks
      },
      homeAssistant: {
        configured: haConfigured,
        lastActionAt: state.integrations.homeAssistant.lastActionAt,
        latest: state.integrations.homeAssistant.history[0] || null
      },
      nas: {
        configured: nasConfigured,
        lastScanAt: state.integrations.nas.lastScanAt,
        latest: state.integrations.nas.history[0] || null
      }
    }
  };
}

async function executeCapability(state, config, name, args = {}, contextInput = {}, prepared = {}) {
  ensureSecurityState(state);
  const tool = capabilityMeta(name);
  const context = normalizeContext(state, contextInput);
  const normalizedArgs = {
    ...normalizeArgs(args),
    requestId: args?.requestId || args?.request_id || context.requestId || context.traceId || ""
  };
  if (!tool) {
    return denyCapability(state, { name: String(name || ""), action: "agent.unknown" }, normalizedArgs, context, "未知能力工具");
  }

  const customReason = capabilityDeniedReason(state, tool, normalizedArgs, context, config);
  if (customReason) {
    return denyCapability(state, tool, normalizedArgs, context, customReason);
  }

  const decision = evaluateAction(state, tool.action, {
    ...normalizedArgs,
    memberId: context.memberId,
    role: context.role,
    modeContext: context.modeContext
  });
  if (!decision.allowed) {
    return denyCapability(state, tool, normalizedArgs, context, decision.reason, decision);
  }
  if (toolRequiresConfirmation(tool) && !hasConfirmation(normalizedArgs, context)) {
    return confirmationRequiredCapability(state, tool, normalizedArgs, context, decision);
  }
  auditAction(state, tool.action, {
    ...normalizedArgs,
    memberId: context.memberId,
    role: context.role,
    modeContext: context.modeContext
  }, decision);

  switch (name) {
    case "family.home.overview":
      return executeHomeOverview(state, config);
    case "family.media.play":
      return mediaCapabilityResult(
        name,
        executeGatewayMediaTool(state, config, "family.media.play", normalizedArgs, prepared, context),
        "播放媒体"
      );
    case "family.media.resume":
      return mediaCapabilityResult(
        name,
        executeGatewayMediaTool(state, config, "family.podcast.resume", normalizedArgs, prepared, context),
        "继续播放"
      );
    case "family.media.next":
      return mediaCapabilityResult(
        name,
        executeGatewayMediaTool(state, config, "family.podcast.next", normalizedArgs, prepared, context),
        "下一集"
      );
    case "family.media.stop":
      return mediaCapabilityResult(
        name,
        executeGatewayMediaTool(state, config, "family.podcast.stop", normalizedArgs, prepared, context),
        "停止播放"
      );
    case "family.media.favorite":
      return mediaCapabilityResult(
        name,
        executeGatewayMediaTool(state, config, "family.podcast.favorite", normalizedArgs, prepared),
        "已收藏"
      );
    case "family.device.status":
      return executeDeviceStatus(state, config);
    case "family.device.diagnostics":
      return executeDeviceDiagnostics(state, config, normalizedArgs);
    case "family.weather.today":
      return executeWeatherToday(state, prepared);
    case "family.schedule.today":
      return executeScheduleToday(state);
    case "family.schedule.add":
      return executeScheduleAdd(state, normalizedArgs);
    case "family.schedule.complete":
      return executeScheduleComplete(state, normalizedArgs);
    case "family.schedule.snooze":
      return executeScheduleSnooze(state, normalizedArgs);
    case "family.english.status":
      return executeEnglishStatus(state, normalizedArgs, context);
    case "family.english.start":
      return executeEnglishStart(state, normalizedArgs, context);
    case "family.english.record":
      return executeEnglishRecord(state, normalizedArgs, context);
    case "family.album.status":
      return executeAlbumStatus(state, config);
    case "family.album.slideshow_start":
      return executeAlbumSlideshow(state, true);
    case "family.album.slideshow_stop":
      return executeAlbumSlideshow(state, false);
    case "family.openclaw.run":
      return executeOpenClawRun(state, config, normalizedArgs, context);
    case "family.homeassistant.scene":
      return executeHomeAssistantScene(state, config, normalizedArgs);
    case "family.speaker.command":
      return executeSpeaker(state, config, "command", normalizedArgs);
    case "family.speaker.say":
      return executeSpeaker(state, config, "say", normalizedArgs);
    case "family.speaker.volume":
      return executeSpeaker(state, config, "volume", normalizedArgs);
    case "family.speaker.play":
      return executeSpeaker(state, config, "play", normalizedArgs);
    case "family.speaker.pause":
      return executeSpeaker(state, config, "pause", normalizedArgs);
    case "family.nas.music.scan":
      return executeNasMusicScan(state, config);
    case "family.tools.status":
      return executeToolsStatus(state, config);
    case "family.content.recommend":
      return executeContentRecommend(state, normalizedArgs, context);
    case "family.memory.remember":
      return executeMemoryRemember(state, normalizedArgs, context);
    case "family.memory.search":
      return executeMemorySearch(state, normalizedArgs, context);
    default:
      return denyCapability(state, tool, normalizedArgs, context, "能力工具尚未实现");
  }
}

module.exports = {
  AGENT_REGISTRY,
  TOOL_REGISTRY,
  capabilityMeta,
  executeCapability,
  listCapabilities,
  normalizeArgs,
  normalizeContext,
  prepareCapability
};

const childProcess = require("child_process");
const fs = require("fs");
const path = require("path");

const {
  applyMusicTrack,
  clamp,
  musicChannel,
  musicSourceName,
  nextSchedule,
  pauseOtherMusic,
  pushNotification,
  setEnglishProgress,
  setMusicSource
} = require("./domain");
const { createMemory, addLearningRecord } = require("./memory");
const { recommendContent } = require("./content");
const { resolveVoiceIntent } = require("./intent");
const { listKnownServerTracks, listServerTracks } = require("./media");
const { auditAction, ensureSecurityState, evaluateAction } = require("./security");
const { runHomeAssistantService } = require("./home-assistant");

const ACTIONS = new Set([
  "ai.toggle",
  "ai.start",
  "ai.stop",
  "weather.refresh",
  "music.play_pause",
  "music.next",
  "music.volume",
  "music.set_source",
  "music.source",
  "music.sd.scan",
  "music.sd.play_pause",
  "music.sd.next",
  "music.server.play_pause",
  "music.server.next",
  "music.server.cache",
  "schedule.complete",
  "schedule.snooze",
  "english.start",
  "english.reset",
  "app.open",
  "screensaver.start",
  "screensaver.stop",
  "openclaw.run",
  "content.recommend",
  "memory.add",
  "homeassistant.call",
  "homeassistant.scene",
  "nas.music.scan",
  "toast",
  "dialog.open",
  "notification.push",
  "family.mode",
  "family.member.active",
  "family.member.status",
  "voice.intent"
]);

function normalizeActionName(body) {
  if (typeof body?.name === "string") {
    return body.name;
  }
  if (body?.type === "action.call" && typeof body?.action === "string") {
    return body.action;
  }
  if (typeof body?.action === "string") {
    return body.action;
  }
  return "";
}

function normalizeParams(body) {
  return body?.params && typeof body.params === "object" ? body.params : {};
}

function playPauseMusic(state, source) {
  const channel = musicChannel(state, source);
  setMusicSource(state, source);
  if (!channel.available) {
    pushNotification(state, "音乐", `${musicSourceName(source)} 暂不可用`, "warn");
    return;
  }
  channel.playing = !channel.playing;
  if (channel.playing) {
    pauseOtherMusic(state, source);
  }
  pushNotification(state, musicSourceName(source), channel.playing ? "开始播放" : "暂停播放");
}

function nextMusic(state, source) {
  const channel = musicChannel(state, source);
  setMusicSource(state, source);
  if (!channel.available) {
    pushNotification(state, "音乐", `${musicSourceName(source)} 暂不可用`, "warn");
    return;
  }
  channel.currentIndex = (channel.currentIndex + 1) % Math.max(channel.tracks.length, 1);
  applyMusicTrack(channel);
  channel.playing = true;
  pauseOtherMusic(state, source);
  pushNotification(state, musicSourceName(source), `切换到 ${channel.title}`);
}

function changeMusicVolume(state, delta, source = state.music.activeSource) {
  const channel = musicChannel(state, source);
  channel.volume = clamp(channel.volume + Number(delta || 0), 0, 100);
  pushNotification(state, musicSourceName(source), `音量 ${channel.volume}`);
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

function runOpenClaw(state, config, params) {
  ensureOpenClawState(state);
  const target = String(params.target || "default").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 48) || "default";
  const allowedTargets = new Set((config.openclawTargets || ["default", "music", "diagnostics"]).map(String));
  if (!allowedTargets.has(target)) {
    const error = new Error(`openclaw target rejected: ${target}`);
    error.statusCode = 400;
    throw error;
  }

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
    memberId: params.memberId || "device",
    mode: params.mode || state.familyMode || "默认",
    requestId: params.requestId || "",
    message: ""
  };

  const preflight = executableStatus(config.openclawCommand);
  if (preflight) {
    job.sourceStatus = "unavailable";
    job.status = "failed";
    job.finishedAt = new Date().toISOString();
    job.message = `OpenClaw ${preflight}: ${config.openclawCommand || "(empty)"}`;
    pushOpenClawJob(state, job);
    return { executed: false, job, message: job.message };
  }

  job.status = "started";
  job.sourceStatus = "real";
  job.startedAt = new Date().toISOString();
  const start = Date.now();
  const result = childProcess.spawnSync(config.openclawCommand, [target], {
    encoding: "utf8",
    timeout: config.openclawTimeoutMs || 10000,
    maxBuffer: 128 * 1024
  });
  job.finishedAt = new Date().toISOString();
  job.durationMs = Date.now() - start;
  job.pid = result.pid || null;
  job.exitCode = typeof result.status === "number" ? result.status : null;
  job.signal = result.signal || null;
  job.stdout = outputSummary(result.stdout);
  job.stderr = outputSummary(result.stderr || result.error?.message || "");
  if (result.error?.code === "ETIMEDOUT") {
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
  return { executed: job.status === "success", job, message: job.message };
}

function runHomeAssistant(state, config, params) {
  ensureIntegrationState(state);
  const now = new Date().toISOString();
  const domain = String(params.domain || "homeassistant").replace(/[^a-zA-Z0-9_]/g, "") || "homeassistant";
  const service = String(params.service || "turn_on").replace(/[^a-zA-Z0-9_]/g, "") || "turn_on";
  const serviceData = params.serviceData || params.data || {};
  const record = {
    id: `ha_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`,
    at: now,
    domain,
    service,
    serviceData,
    status: "simulated",
    sourceStatus: "simulated",
    requestId: params.requestId || "",
    message: ""
  };

  if (!config.homeAssistantUrl || !config.homeAssistantToken) {
    record.message = `模拟 HA ${domain}.${service}`;
    state.integrations.homeAssistant.history.unshift(record);
    state.integrations.homeAssistant.history = state.integrations.homeAssistant.history.slice(0, 50);
    state.integrations.homeAssistant.configured = false;
    return { executed: false, record, message: record.message };
  }

  const url = `${config.homeAssistantUrl.replace(/\/$/, "")}/api/services/${domain}/${service}`;
  const response = runHomeAssistantService(config, domain, service, serviceData);
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
    ? `HA ${domain}.${service} 已确认 http ${response.httpCode}`
    : `HA ${domain}.${service} 失败 http ${response.httpCode || "--"} exit=${response.exitCode ?? "--"}`;
  state.integrations.homeAssistant.configured = true;
  state.integrations.homeAssistant.lastActionAt = now;
  state.integrations.homeAssistant.history.unshift(record);
  state.integrations.homeAssistant.history = state.integrations.homeAssistant.history.slice(0, 50);
  return { executed: response.ok, record, message: record.message };
}

function scanNasMusic(config) {
  if (!config.nasMusicDir) {
    return { executed: false, sourceStatus: "unavailable", tracks: [], message: "NAS 音乐目录未配置" };
  }
  const root = path.resolve(config.nasMusicDir);
  if (!fs.existsSync(root)) {
    return { executed: false, sourceStatus: "unavailable", tracks: [], message: `NAS 目录不存在: ${root}` };
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

function syncServerMusicTracks(state, config) {
  const tracks = listKnownServerTracks(state, config);
  const channel = state.music.server;
  if (tracks.length === 0) {
    channel.available = false;
    channel.tracks = [];
    channel.detail = "未发现服务器音频";
    return;
  }
  channel.tracks = tracks;
  channel.available = true;
  channel.source = "服务器播客";
  channel.detail = `服务器媒体 ${tracks.length} 项`;
  channel.currentIndex = clamp(channel.currentIndex || 0, 0, tracks.length - 1);
  applyMusicTrack(channel);
}

function denyAction(state, name, params, decision) {
  auditAction(state, name, params, decision, "denied");
  pushNotification(state, "权限限制", `${decision.reason}: ${name}`, "warn");
}

function handleAction(state, name, params, config) {
  if (!ACTIONS.has(name)) {
    const error = new Error(`unsupported action: ${name || "empty"}`);
    error.statusCode = 400;
    throw error;
  }
  ensureSecurityState(state);
  ensureIntegrationState(state);
  ensureOpenClawState(state);

  const decision = evaluateAction(state, name, params);
  if (!decision.allowed) {
    denyAction(state, name, params, decision);
    return;
  }
  auditAction(state, name, params, decision);

  switch (name) {
    case "ai.toggle":
    case "ai.start":
    case "ai.stop":
      pushNotification(state, "AI", "AI 仍走小智官方链路，后端仅记录动作");
      break;
    case "weather.refresh":
      break;
    case "music.set_source":
    case "music.source":
      if (!setMusicSource(state, params.source)) {
        const error = new Error(`unsupported music source: ${params.source || "empty"}`);
        error.statusCode = 400;
        throw error;
      }
      pushNotification(state, "音乐", `切换到 ${musicSourceName(state.music.activeSource)}`);
      break;
    case "music.play_pause":
      if (state.music.activeSource === "server") {
        syncServerMusicTracks(state, config);
      }
      playPauseMusic(state, state.music.activeSource);
      break;
    case "music.next":
      if (state.music.activeSource === "server") {
        syncServerMusicTracks(state, config);
      }
      nextMusic(state, state.music.activeSource);
      break;
    case "music.volume":
      changeMusicVolume(state, params.delta);
      break;
    case "music.sd.scan":
      state.music.sd.available = true;
      state.music.sd.detail = `已发现 ${state.music.sd.tracks.length} 首本地音乐`;
      applyMusicTrack(state.music.sd);
      pushNotification(state, "SD 卡音乐", state.music.sd.detail);
      break;
    case "music.sd.play_pause":
      playPauseMusic(state, "sd");
      break;
    case "music.sd.next":
      nextMusic(state, "sd");
      break;
    case "music.server.play_pause":
      syncServerMusicTracks(state, config);
      playPauseMusic(state, "server");
      break;
    case "music.server.next":
      syncServerMusicTracks(state, config);
      nextMusic(state, "server");
      break;
    case "music.server.cache":
      syncServerMusicTracks(state, config);
      setMusicSource(state, "server");
      pushNotification(state, "服务器播客", "设备正在缓存当前音频到 SD 卡");
      break;
    case "schedule.complete": {
      const target = state.schedule.find((item) => item.id === params.id) || nextSchedule(state);
      target.done = true;
      pushNotification(state, "日程", `${target.title} 已完成`);
      break;
    }
    case "schedule.snooze": {
      const target = state.schedule.find((item) => item.id === params.id) || nextSchedule(state);
      pushNotification(state, "日程", `${target.title} 稍后 ${params.minutes || 10} 分钟提醒`, "warn");
      break;
    }
    case "english.start": {
      const done = Number(String(state.english.progress).split("/")[0] || 0) + 1;
      setEnglishProgress(state, done);
      state.english.lastStartedAt = new Date().toISOString();
      state.english.history.unshift({ at: state.english.lastStartedAt, topic: state.english.topic });
      state.english.history = state.english.history.slice(0, 20);
      addLearningRecord(state, {
        memberId: params.memberId || "child",
        type: "english",
        title: state.english.topic,
        score: state.english.score,
        progress: state.english.progress,
        source: "device",
        metadata: { prompt: state.english.prompt }
      });
      pushNotification(state, "英语", "已开始一次口语练习");
      break;
    }
    case "english.reset":
      setEnglishProgress(state, 0);
      state.english.score = 0;
      pushNotification(state, "英语", "今日练习已重置");
      break;
    case "app.open":
      pushNotification(state, "应用", `打开 ${params.id || "first"}`);
      break;
    case "screensaver.start":
      state.screensaver.active = true;
      state.screensaver.updatedAt = new Date().toISOString();
      pushNotification(state, "屏保", "进入家庭相册");
      break;
    case "screensaver.stop":
      state.screensaver.active = false;
      state.screensaver.updatedAt = new Date().toISOString();
      pushNotification(state, "屏保", "退出家庭相册");
      break;
    case "openclaw.run": {
      const result = runOpenClaw(state, config, params);
      pushNotification(state, "OpenClaw", result.message);
      break;
    }
    case "content.recommend": {
      const recommendation = recommendContent(state, params);
      pushNotification(state, "内容推荐", recommendation.reason, recommendation.itemId ? "info" : "warn");
      break;
    }
    case "memory.add": {
      const item = createMemory(state, {
        ...params,
        text: params.text || params.value || params.note || params.message,
        source: params.source || "action"
      });
      pushNotification(state, "家庭记忆", `已记住: ${item.title}`);
      break;
    }
    case "homeassistant.call": {
      const result = runHomeAssistant(state, config, params);
      pushNotification(state, "Home Assistant", result.message, result.executed ? "info" : "warn");
      break;
    }
    case "homeassistant.scene": {
      const result = runHomeAssistant(state, config, {
        requestId: params.requestId || "",
        domain: "scene",
        service: "turn_on",
        serviceData: { entity_id: params.entityId || params.entity_id || "scene.family" }
      });
      pushNotification(state, "Home Assistant", result.message, result.executed ? "info" : "warn");
      break;
    }
    case "nas.music.scan": {
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
      break;
    }
    case "toast":
      pushNotification(state, "提示", params.message || "收到设备动作");
      break;
    case "dialog.open":
      state.dialogs.unshift({
        id: `d_${Date.now()}`,
        title: params.title || "弹窗",
        message: params.message || "",
        createdAt: new Date().toISOString()
      });
      state.dialogs = state.dialogs.slice(0, 10);
      pushNotification(state, "弹窗", params.title || "打开弹窗");
      break;
    case "notification.push":
      pushNotification(
        state,
        params.title || "通知",
        params.audience || params.memberId ? `[${params.audience || params.memberId}] ${params.message || ""}` : params.message || "",
        params.level || "info"
      );
      break;
    case "family.mode":
      if (params.mode && state.family?.policies?.[params.mode]) {
        state.familyMode = params.mode;
      }
      pushNotification(state, "家庭模式", `切换到 ${state.familyMode}`);
      break;
    case "family.member.active": {
      const mode = params.mode || state.familyMode || "默认";
      const expectedRole = mode === "儿童" ? "child" : mode === "访客" ? "guest" : "parent";
      const member = (state.family?.members || []).find((item) => item.id === params.memberId && item.role === expectedRole);
      if (!member) {
        const error = new Error(`member does not belong to ${mode} mode`);
        error.statusCode = 400;
        throw error;
      }
      state.family.activeMembers = state.family.activeMembers || {};
      state.family.activeMembers[mode] = member.id;
      state.familyMode = mode;
      pushNotification(state, "当前用户", `${mode}: ${member.name}`);
      break;
    }
    case "family.member.status": {
      state.family = state.family || { members: [], policies: {} };
      const id = params.id || "member";
      let member = state.family.members.find((item) => item.id === id);
      if (!member) {
        member = { id, name: params.name || id, role: params.role || "member", status: "unknown" };
        state.family.members.push(member);
      }
      member.name = params.name || member.name;
      member.role = params.role || member.role;
      member.status = params.status || member.status;
      member.updatedAt = new Date().toISOString();
      pushNotification(state, "家庭成员", `${member.name} ${member.status}`);
      break;
    }
    case "voice.intent": {
      const text = params.text || params.transcript || params.intent || "";
      const intent = resolveVoiceIntent(text, params);
      state.voice = state.voice || { history: [] };
      state.voice.history.unshift({
        id: `voice_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`,
        at: new Date().toISOString(),
        text,
        matched: intent.matched,
        action: intent.action || "",
        reason: intent.reason
      });
      state.voice.history = state.voice.history.slice(0, 50);
      if (!intent.matched) {
        pushNotification(state, "语音意图", `未匹配: ${text}`, "warn");
        break;
      }
      pushNotification(state, "语音意图", `${text} -> ${intent.action}`);
      handleAction(state, intent.action, { ...intent.params, memberId: params.memberId, role: params.role }, config);
      break;
    }
  }
}

module.exports = {
  ACTIONS,
  handleAction,
  normalizeActionName,
  normalizeParams
};

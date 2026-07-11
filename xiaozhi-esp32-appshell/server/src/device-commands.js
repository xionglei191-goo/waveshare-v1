const crypto = require("crypto");

const {
  applyMusicTrack,
  pauseOtherMusic,
  pushNotification,
  setMusicSource
} = require("./domain");
const {
  addMediaFavorite,
  compactQuery,
  listKnownServerTracks,
  toDeviceTrack,
  nextMediaQueueItem,
  registerOnlineTrack,
  resolveResumeCandidate,
  resolveMediaSearch,
  stopMediaQueue
} = require("./media");

const DEVICE_COMMAND_TYPES = new Set([
  "media.server.play",
  "media.server.next",
  "media.server.stop",
  "media.server.cache",
  "ui.toast"
]);

function nowIso() {
  return new Date().toISOString();
}

function normalizeDeviceId(value) {
  return String(value || "esp32-185b").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80) || "esp32-185b";
}

function normalizeToolName(body) {
  return String(body?.tool || body?.toolName || body?.function || body?.name || body?.action || body?.type || "").trim();
}

function normalizeToolParams(body) {
  if (body?.params && typeof body.params === "object") {
    return body.params;
  }
  if (body?.arguments && typeof body.arguments === "object") {
    return body.arguments;
  }
  if (typeof body?.arguments === "string") {
    try {
      const parsed = JSON.parse(body.arguments);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (error) {
      return {};
    }
  }
  return {};
}

function commandView(command) {
  if (!command) {
    return null;
  }
  return {
    id: command.id,
    type: command.type,
    deviceId: command.deviceId,
    status: command.status,
    createdAt: command.createdAt,
    source: command.source,
    requestId: command.requestId || command.payload?.requestId || "",
    idempotencyKey: command.idempotencyKey || "",
    payload: command.payload || {}
  };
}

function ensureDeviceCommandState(state) {
  state.deviceCommands = state.deviceCommands || {};
  state.deviceCommands.queue = Array.isArray(state.deviceCommands.queue) ? state.deviceCommands.queue : [];
  state.deviceCommands.history = Array.isArray(state.deviceCommands.history) ? state.deviceCommands.history : [];
  state.deviceCommands.stats = state.deviceCommands.stats || {
    created: 0,
    acked: 0,
    rejected: 0,
    lastCreatedAt: null,
    lastAckAt: null
  };
  return state.deviceCommands;
}

function enqueueDeviceCommand(state, command) {
  const commands = ensureDeviceCommandState(state);
  const type = String(command.type || "");
  if (!DEVICE_COMMAND_TYPES.has(type)) {
    const error = new Error(`unsupported device command: ${type || "empty"}`);
    error.statusCode = 400;
    throw error;
  }
  const createdAt = nowIso();
  const idempotencyKey = String(command.idempotencyKey || "").replace(/[^a-zA-Z0-9._:-]/g, "-").slice(0, 120);
  if (idempotencyKey) {
    const existing = [...commands.queue, ...commands.history].find((item) => item.idempotencyKey === idempotencyKey);
    if (existing) {
      return existing;
    }
  }
  const item = {
    id: command.id || `cmd_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`,
    type,
    deviceId: normalizeDeviceId(command.deviceId),
    status: "pending",
    createdAt,
    deliveredAt: null,
    ackedAt: null,
    source: String(command.source || "backend").slice(0, 80),
    idempotencyKey,
    requestId: String(command.requestId || command.payload?.requestId || "").slice(0, 96),
    payload: command.payload && typeof command.payload === "object" ? command.payload : {}
  };
  commands.queue.push(item);
  commands.queue = commands.queue.slice(-80);
  commands.stats.created += 1;
  commands.stats.lastCreatedAt = createdAt;
  return item;
}

function pendingDeviceCommands(state, deviceId = "esp32-185b", limit = 1) {
  const commands = ensureDeviceCommandState(state);
  const target = normalizeDeviceId(deviceId);
  return commands.queue
    .filter((command) => command.status === "pending" && (command.deviceId === target || command.deviceId === "all"))
    .slice(0, Math.max(1, Math.min(Number(limit) || 1, 8)))
    .map(commandView);
}

function ackDeviceCommand(state, commandId, body = {}) {
  const commands = ensureDeviceCommandState(state);
  const id = String(commandId || "");
  const index = commands.queue.findIndex((command) => command.id === id);
  if (index < 0) {
    return { found: false, command: null };
  }
  const now = nowIso();
  const command = commands.queue[index];
  command.status = String(body.status || "accepted").slice(0, 40);
  command.ackedAt = now;
  command.message = String(body.message || "").slice(0, 240);
  command.deviceId = normalizeDeviceId(body.deviceId || command.deviceId);
  commands.queue.splice(index, 1);
  commands.history.unshift(command);
  commands.history = commands.history.slice(0, 120);
  commands.stats.acked += 1;
  commands.stats.lastAckAt = now;
  if (command.status === "rejected" || command.status === "failed") {
    commands.stats.rejected += 1;
  }
  return { found: true, command: commandView(command) };
}

function includesAny(text, needles) {
  return needles.some((needle) => text.includes(needle));
}

function mediaQueryFromBody(body, params = normalizeToolParams(body)) {
  return compactQuery(
    params.query ||
    params.keyword ||
    params.title ||
    params.text ||
    body?.query ||
    body?.title ||
    body?.text ||
    body?.transcript ||
    ""
  );
}

function resolveGatewayCommand(body) {
  const params = normalizeToolParams(body);
  const tool = normalizeToolName(body).toLowerCase();
  const text = String(body?.text || body?.transcript || body?.query || params.text || "").toLowerCase();
  const combined = `${tool} ${text}`;

  if (includesAny(combined, ["favorite", "收藏", "喜欢"])) {
    return { type: "media.favorite", reason: "favorite current podcast" };
  }
  if (includesAny(combined, ["resume", "continue", "继续播放", "继续听", "接着听", "上次没听完", "没听完"])) {
    return { type: "media.server.resume", reason: "resume unfinished podcast" };
  }
  if (includesAny(combined, ["cache", "缓存", "下载"])) {
    return { type: "media.server.cache", reason: "cache server podcast" };
  }
  if (includesAny(combined, ["next", "下一首", "下一集", "下一个"])) {
    return { type: "media.server.next", reason: "next server podcast" };
  }
  if (includesAny(combined, ["stop", "pause", "暂停", "停止", "关掉"])) {
    return { type: "media.server.stop", reason: "stop server podcast" };
  }
  if (
    includesAny(combined, [
      "podcast",
      "播客",
      "服务器音乐",
      "服务器上的音乐",
      "服务器后台",
      "后台文件",
      "server music",
      "server_podcast",
      "media.server.play",
      "family.podcast.play",
      "family.media.play"
    ])
  ) {
    return { type: "media.server.play", reason: "play server podcast" };
  }
  if (tool === "ui.toast" || tool === "toast") {
    return { type: "ui.toast", reason: "toast" };
  }
  return { type: "", reason: "no safe gateway mapping" };
}

function pickServerTrack(state, config, params) {
  const tracks = listKnownServerTracks(state, config);
  if (tracks.length === 0) {
    return { tracks, track: null, index: 0 };
  }
  const requestedId = String(params.trackId || params.track_id || params.id || "");
  let index = requestedId ? tracks.findIndex((track) => track.id === requestedId) : -1;
  const query = String(params.query || params.title || params.text || "").trim().toLowerCase();
  if (index < 0 && query) {
    index = tracks.findIndex((track) => `${track.title} ${track.artist} ${track.path}`.toLowerCase().includes(query));
  }
  if (index < 0 && query) {
    return { tracks, track: null, index: 0 };
  }
  if (index < 0) {
    index = Math.min(Math.max(Number(state.music?.server?.currentIndex || 0), 0), tracks.length - 1);
  }
  return { tracks, track: tracks[index], index };
}

async function resolveServerMediaForCommand(state, config, body) {
  if (resolveGatewayCommand(body).type !== "media.server.play") {
    return null;
  }
  const params = normalizeToolParams(body);
  const requestedId = String(params.trackId || params.track_id || params.id || "");
  const explicitUrl = String(params.url || params.audioUrl || params.audio_url || params.streamUrl || params.stream_url || "");
  if (explicitUrl) {
    const search = await resolveMediaSearch(config, explicitUrl, state);
    if (search.source === "online" && search.tracks[0]) {
      const track = registerOnlineTrack(state, config, search.tracks[0], explicitUrl);
      const tracks = listKnownServerTracks(state, config);
      const index = Math.max(0, tracks.findIndex((item) => item.id === track?.id));
      return { tracks, track, index, origin: "online", query: explicitUrl };
    }
  }
  const query = mediaQueryFromBody(body, params);
  const localPick = pickServerTrack(state, config, { ...params, query });
  if (localPick.track && (!query || requestedId || localPick.track.origin !== "online")) {
    return { ...localPick, origin: localPick.track.origin || "local", query };
  }
  if (!query && localPick.track) {
    return { ...localPick, origin: localPick.track.origin || "local", query };
  }
  const search = await resolveMediaSearch(config, query || params.url || params.audioUrl || params.streamUrl || body?.text || "", state);
  if (search.source === "local" && search.tracks[0]) {
    const track = search.tracks[0];
    const tracks = listKnownServerTracks(state, config);
    const index = Math.max(0, tracks.findIndex((item) => item.id === track.id));
    return { tracks, track, index, origin: "local", query: search.query };
  }
  if ((search.source === "queue" || search.source === "podcast") && search.tracks[0]) {
    const track = search.tracks[0];
    const tracks = listKnownServerTracks(state, config);
    const index = Math.max(0, tracks.findIndex((item) => item.id === track.id));
    return { tracks, track, index, origin: search.source, query: search.query };
  }
  if (search.source === "online" && search.tracks[0]) {
    const track = registerOnlineTrack(state, config, search.tracks[0], search.query);
    const tracks = listKnownServerTracks(state, config);
    const index = Math.max(0, tracks.findIndex((item) => item.id === track?.id));
    return { tracks, track, index, origin: "online", query: search.query };
  }
  return { tracks: localPick.tracks, track: localPick.track, index: localPick.index, origin: "none", query };
}

function enqueueXiaozhiToolCommand(state, config, body) {
  const params = normalizeToolParams(body);
  const deviceId = normalizeDeviceId(body?.deviceId || body?.device_id || params.deviceId || params.device_id);
  const idempotencyKey = String(body?.idempotencyKey || body?.idempotency_key || params.idempotencyKey || "").slice(0, 120);
  const requestId = String(body?.requestId || body?.request_id || params.requestId || params.request_id || "").slice(0, 96);
  const resolved = resolveGatewayCommand(body);
  if (!resolved.type) {
    pushNotification(state, "小智工具", resolved.reason, "warn");
    return {
      accepted: false,
      reason: resolved.reason,
      speech: "这个家庭工具还没有开放。"
    };
  }
  if (idempotencyKey) {
    const commands = ensureDeviceCommandState(state);
    const existing = [...commands.queue, ...commands.history].find((item) => item.idempotencyKey === idempotencyKey);
    if (existing) {
      return {
        accepted: true,
        idempotent: true,
        command: commandView(existing),
        speech: "这个请求已经处理过了。"
      };
    }
  }

  if (resolved.type === "ui.toast") {
    const command = enqueueDeviceCommand(state, {
      type: "ui.toast",
      deviceId,
      source: "xiaozhi.tool",
      idempotencyKey,
      requestId,
      payload: {
        message: String(params.message || body?.text || "收到小智工具调用").slice(0, 120)
      }
    });
    pushNotification(state, "小智工具", "已下发提示");
    return {
      accepted: true,
      command: commandView(command),
      speech: "好的，已发送到圆屏。"
    };
  }

  if (resolved.type === "media.favorite") {
    const currentTrack = state.music?.server?.tracks?.[state.music.server.currentIndex || 0] || null;
    if (!currentTrack?.id) {
      pushNotification(state, "服务器播客", "当前没有可收藏的节目", "warn");
      return {
        accepted: false,
        reason: "no current media track",
        speech: "现在没有正在播放的节目可以收藏。"
      };
    }
    const favorite = addMediaFavorite(state, config, { track: currentTrack });
    pushNotification(state, "服务器播客", `已收藏: ${favorite.title}`);
    return {
      accepted: true,
      favorite,
      speech: `已收藏${favorite.title}。`
    };
  }

  if (resolved.type === "media.server.play") {
    const media = body._resolvedMedia || pickServerTrack(state, config, params);
    let { tracks, track, index } = media;
    if (media.origin === "online" && track) {
      track = registerOnlineTrack(state, config, track, media.query) || track;
      tracks = listKnownServerTracks(state, config);
      index = Math.max(0, tracks.findIndex((item) => item.id === track.id));
    }
    if (!track) {
      pushNotification(state, "服务器播客", "没有可播放的服务器音频", "warn");
      return {
        accepted: false,
        reason: "no server audio tracks",
        speech: media.query ? `本地和网络都没有找到${media.query}。` : "服务器里还没有找到可以播放的音频。"
      };
    }
    state.music.server.tracks = tracks;
    state.music.server.available = true;
    state.music.server.currentIndex = index;
    const remote = track.origin === "online" || media.origin === "online" || media.origin === "podcast" || media.origin === "queue";
    state.music.server.detail = remote ? `${track.source || track.provider || "网络媒体"} ${tracks.length} 项` : `服务器媒体 ${tracks.length} 项`;
    state.music.server.source = remote ? (track.source || "网络音频") : "服务器播客";
    applyMusicTrack(state.music.server);
    state.music.server.playing = true;
    setMusicSource(state, "server");
    pauseOtherMusic(state, "server");
    const command = enqueueDeviceCommand(state, {
      type: "media.server.play",
      deviceId,
      source: "xiaozhi.tool",
      idempotencyKey,
      requestId,
      payload: {
        track: toDeviceTrack(track, config),
        reason: resolved.reason
      }
    });
    pushNotification(state, "小智工具", `${remote ? "网络播放" : "播放服务器播客"}: ${track.title}`);
    return {
      accepted: true,
      command: commandView(command),
      track,
      speech: remote
        ? `本地没找到，已从网络找到${track.title}，开始播放。`
        : `好的，开始播放${track.title}。`
    };
  }

  if (resolved.type === "media.server.resume") {
    const candidate = resolveResumeCandidate(state, config, {
      ...params,
      deviceId
    });
    if (!candidate?.track) {
      pushNotification(state, "服务器播客", "没有找到未听完的节目", "warn");
      return {
        accepted: false,
        reason: "no unfinished media",
        speech: "没有找到上次没听完的节目。"
      };
    }
    const tracks = listKnownServerTracks(state, config);
    const index = Math.max(0, tracks.findIndex((item) => item.id === candidate.track.id));
    state.music.server.tracks = tracks;
    state.music.server.available = true;
    state.music.server.currentIndex = index;
    state.music.server.detail = `${candidate.track.source || "服务器播客"} ${tracks.length} 项`;
    state.music.server.source = candidate.track.source || "服务器播客";
    applyMusicTrack(state.music.server);
    state.music.server.playing = true;
    setMusicSource(state, "server");
    pauseOtherMusic(state, "server");
    const command = enqueueDeviceCommand(state, {
      type: "media.server.play",
      deviceId,
      source: "xiaozhi.tool",
      idempotencyKey,
      requestId,
      payload: {
        track: {
          ...toDeviceTrack(candidate.track, config),
          resumePositionSec: candidate.positionSec
        },
        progress: {
          positionSec: candidate.positionSec,
          durationSec: candidate.durationSec,
          percent: candidate.percent,
          updatedAt: candidate.updatedAt
        },
        reason: resolved.reason
      }
    });
    pushNotification(state, "服务器播客", `继续播放: ${candidate.track.title}`);
    return {
      accepted: true,
      command: commandView(command),
      track: candidate.track,
      progress: {
        positionSec: candidate.positionSec,
        durationSec: candidate.durationSec,
        percent: candidate.percent
      },
      speech: `好的，继续播放${candidate.track.title}。`
    };
  }

  if (resolved.type === "media.server.next") {
    const queued = nextMediaQueueItem(state, config, params);
    const queueTrack = queued?.track || null;
    const { tracks } = queueTrack ? { tracks: listKnownServerTracks(state, config) } : pickServerTrack(state, config, params);
    if (queueTrack) {
      state.music.server.tracks = tracks;
      state.music.server.available = true;
      state.music.server.currentIndex = Math.max(0, tracks.findIndex((item) => item.id === queueTrack.id));
      applyMusicTrack(state.music.server);
      state.music.server.playing = true;
      setMusicSource(state, "server");
      pauseOtherMusic(state, "server");
    } else if (tracks.length > 0) {
      state.music.server.tracks = tracks;
      state.music.server.available = true;
      state.music.server.currentIndex = (Number(state.music.server.currentIndex || 0) + 1) % tracks.length;
      applyMusicTrack(state.music.server);
      state.music.server.playing = true;
      setMusicSource(state, "server");
      pauseOtherMusic(state, "server");
    }
    const command = enqueueDeviceCommand(state, {
      type: "media.server.next",
      deviceId,
      source: "xiaozhi.tool",
      idempotencyKey,
      requestId,
      payload: { reason: resolved.reason, track: queueTrack ? toDeviceTrack(queueTrack, config) : null }
    });
    pushNotification(state, "小智工具", queueTrack ? `切换到 ${queueTrack.title}` : "切换服务器播客");
    return {
      accepted: true,
      command: commandView(command),
      track: queueTrack || null,
      speech: queueTrack ? `好的，切到${queueTrack.title}。` : "好的，切到下一集。"
    };
  }

  if (resolved.type === "media.server.stop") {
    state.music.server.playing = false;
    stopMediaQueue(state);
    const command = enqueueDeviceCommand(state, {
      type: "media.server.stop",
      deviceId,
      source: "xiaozhi.tool",
      idempotencyKey,
      requestId,
      payload: { reason: resolved.reason }
    });
    pushNotification(state, "小智工具", "停止服务器播客");
    return {
      accepted: true,
      command: commandView(command),
      speech: "好的，已停止服务器播客。"
    };
  }

  const command = enqueueDeviceCommand(state, {
    type: resolved.type,
    deviceId,
    source: "xiaozhi.tool",
    idempotencyKey,
    requestId,
    payload: { reason: resolved.reason }
  });
  pushNotification(state, "小智工具", `已下发 ${resolved.type}`);
  return {
    accepted: true,
    command: commandView(command),
    speech: "好的，已经下发到设备。"
  };
}

module.exports = {
  ackDeviceCommand,
  commandView,
  enqueueDeviceCommand,
  enqueueXiaozhiToolCommand,
  ensureDeviceCommandState,
  pendingDeviceCommands,
  resolveGatewayCommand,
  resolveServerMediaForCommand
};

const { buildCompatibility, buildOtaManifest, ensureDeviceModels } = require("./device-registry");
const { filterProductionContent } = require("./content-policy");
const { ensureSecurityState, policySummary } = require("./security");
const { weatherView } = require("./weather");

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function pushNotification(state, title, message, level = "info") {
  state.notifications.unshift({
    id: `n_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`,
    title,
    message,
    level,
    createdAt: new Date().toISOString()
  });
  state.notifications = state.notifications.slice(0, 12);
}

function nextSchedule(state) {
  return state.schedule.find((item) => !item.done) || {
    id: "none",
    title: "暂无日程",
    time: "--:--",
    note: "",
    done: false
  };
}

function scheduleSortKey(time) {
  const match = String(time || "").match(/(\d{1,2}):(\d{2})/);
  if (!match) {
    // Non-HH:MM times such as "明天 08:00" sort after concrete same-day times.
    return Number.MAX_SAFE_INTEGER;
  }
  return Number(match[1]) * 60 + Number(match[2]);
}

function sortSchedule(state) {
  state.schedule = state.schedule
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const keyDelta = scheduleSortKey(a.item.time) - scheduleSortKey(b.item.time);
      return keyDelta !== 0 ? keyDelta : a.index - b.index;
    })
    .map((entry) => entry.item);
  return state.schedule;
}

function addSchedule(state, { title, time, note } = {}) {
  if (!Array.isArray(state.schedule)) {
    state.schedule = [];
  }
  const safeTitle = String(title || "").trim().slice(0, 80);
  if (!safeTitle) {
    const error = new Error("schedule title is required");
    error.statusCode = 400;
    throw error;
  }
  const item = {
    id: `evt_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`,
    title: safeTitle,
    time: String(time || "").trim().slice(0, 40) || "--:--",
    note: String(note || "").trim().slice(0, 120),
    done: false,
    createdAt: new Date().toISOString()
  };
  state.schedule.unshift(item);
  state.schedule = state.schedule.slice(0, 40);
  sortSchedule(state);
  return item;
}

function musicSourceName(source) {
  return source === "sd" ? "SD 卡音乐" : "服务器播客";
}

function musicChannel(state, source) {
  return source === "sd" ? state.music.sd : state.music.server;
}

function otherMusicSource(source) {
  return source === "sd" ? "server" : "sd";
}

function setMusicSource(state, source) {
  if (source !== "sd" && source !== "server") {
    return false;
  }
  state.music.activeSource = source;
  return true;
}

function applyMusicTrack(channel) {
  const track = channel.tracks[channel.currentIndex] || channel.tracks[0];
  if (!track) {
    return;
  }
  channel.title = track.title;
  channel.artist = track.artist;
  channel.detail = channel.detail || `${channel.tracks.length} 项`;
}

function pauseOtherMusic(state, source) {
  musicChannel(state, otherMusicSource(source)).playing = false;
}

function musicChannelView(channel) {
  const track = channel.tracks[channel.currentIndex] || channel.tracks[0] || {};
  return {
    available: Boolean(channel.available),
    playing: Boolean(channel.playing),
    title: channel.title,
    artist: channel.artist,
    source: channel.source,
    detail: channel.detail,
    volume: channel.volume,
    trackCount: channel.tracks.length,
    currentIndex: channel.currentIndex || 0,
    currentTrackId: track.id || "",
    origin: track.origin || "local",
    provider: track.provider || "",
    streamUrl: track.streamUrl || "",
    format: track.format || "",
    contentType: track.contentType || "",
    size: track.size || 0,
    durationSec: Number(track.durationSec || 0) || 0,
    sha256: track.sha256 || "",
    downloadUrl: track.downloadUrl || track.streamUrl || "",
    cachePath: track.cachePath || "",
    cacheable: Boolean(track.cacheable),
    supportsRange: Boolean(track.supportsRange),
    playbackMode: track.playbackMode || "stream"
  };
}

function musicSummary(state) {
  return {
    activeSource: state.music.activeSource,
    activeLabel: musicSourceName(state.music.activeSource),
    sd: musicChannelView(state.music.sd),
    server: musicChannelView(state.music.server)
  };
}

function deviceSummary(state, config) {
  ensureDeviceModels(state);
  ensureSecurityState(state);
  const catalog = filterProductionContent(state.content?.catalog || []);
  return {
    serverTime: new Date().toISOString(),
    backend: {
      name: config.name,
      version: config.version,
      publicBaseUrl: config.publicBaseUrl,
      uptimeSec: Math.floor(process.uptime())
    },
    weather: weatherView(state.weather),
    schedule: {
      next: nextSchedule(state),
      today: state.schedule
    },
    music: musicSummary(state),
    english: state.english,
    notifications: state.notifications.slice(0, 5),
    apps: state.apps,
    screensaver: state.screensaver,
    content: {
      catalogCount: catalog.length,
      packCount: state.content?.packs?.length || 0,
      albums: catalog.filter((item) => item.type === "album").slice(0, 8),
      english: catalog.filter((item) => item.type === "english").slice(0, 8),
      games: catalog.filter((item) => item.type === "game").slice(0, 8),
      podcasts: catalog.filter((item) => item.type === "podcast").slice(0, 8),
      recent: catalog.slice(0, 5),
      recommendations: state.content?.recommendations?.slice(0, 3) || []
    },
    memory: {
      count: state.memory?.items?.filter((item) => !item.deletedAt).length || 0,
      recent: state.memory?.items?.filter((item) => !item.deletedAt).slice(0, 3) || []
    },
    learning: {
      recordCount: state.learning?.records?.length || 0,
      recent: state.learning?.records?.slice(0, 5) || []
    },
    familyMode: state.familyMode,
    family: state.family || { members: [], policies: {} },
    security: policySummary(state),
    openclaw: {
      jobs: state.openclaw?.jobs?.slice(0, 5) || [],
      tasks: state.openclaw?.tasks || []
    },
    integrations: {
      homeAssistant: {
        configured: Boolean(config.homeAssistantUrl && config.homeAssistantToken),
        lastActionAt: state.integrations?.homeAssistant?.lastActionAt || null
      },
      nas: {
        configured: Boolean(config.nasMusicDir),
        lastScanAt: state.integrations?.nas?.lastScanAt || null
      }
    },
    remoteUi: state.remoteUi || {
      schemaVersion: 2,
      deviceProfile: "waveshare-esp32-s3-touch-lcd-1.85b"
    },
    connectivity: state.connectivity || {
      blufi: { available: true, deviceName: "Xiaozhi-Blufi", status: "available" }
    },
    devices: {
      count: state.devices.length,
      recent: state.devices.slice(0, 3)
    },
    logs: {
      count: state.deviceLogs.length,
      recent: state.deviceLogs.slice(0, 3)
    },
    ota: buildOtaManifest(state, config),
    compatibility: buildCompatibility(state)
  };
}

function setEnglishProgress(state, count) {
  const safeCount = clamp(Number(count) || 0, 0, 5);
  state.english.progress = `${safeCount}/5`;
  state.english.score = Math.max(state.english.score, safeCount * 18);
}

module.exports = {
  addSchedule,
  applyMusicTrack,
  clamp,
  deviceSummary,
  musicChannel,
  musicSourceName,
  musicSummary,
  nextSchedule,
  pauseOtherMusic,
  pushNotification,
  setEnglishProgress,
  setMusicSource
};

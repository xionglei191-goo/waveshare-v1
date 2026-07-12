const fs = require("fs");
const crypto = require("crypto");
const path = require("path");
const net = require("net");
const { Readable } = require("stream");
const { filterProductionContent, includeDiagnosticsFlag } = require("./content-policy");

// The ESP32 round screen plays server audio over plain HTTP on the LAN and cannot
// open the public HTTPS tunnel URL. Device-facing stream URLs must therefore point
// at a LAN backend, while web clients keep using the public base URL.
function deviceMediaBase(config) {
  const explicit = String(config?.deviceMediaBaseUrl || "").trim();
  if (explicit) {
    return explicit.replace(/\/$/, "");
  }
  const publicBase = String(config?.publicBaseUrl || "").trim();
  // A plain-HTTP public base is already LAN-reachable, so the device can use it directly.
  if (publicBase && !/^https:/i.test(publicBase)) {
    return publicBase.replace(/\/$/, "");
  }
  // Public base is an HTTPS tunnel: fall back to the documented LAN backend address.
  return "http://192.168.31.246:3100";
}

function toDeviceMediaUrl(url, config) {
  const value = String(url || "");
  const idx = value.indexOf("/api/media/");
  if (idx < 0) {
    return value;
  }
  return deviceMediaBase(config) + value.slice(idx);
}

function toDeviceTrack(track, config) {
  if (!track || typeof track !== "object") {
    return track;
  }
  const next = { ...track };
  if (next.streamUrl) {
    next.streamUrl = toDeviceMediaUrl(next.streamUrl, config);
  }
  if (next.downloadUrl) {
    next.downloadUrl = toDeviceMediaUrl(next.downloadUrl, config);
  }
  return next;
}

const SAMPLE_PODCAST_BASE64 = [
  "T2dnUwACAAAAAAAAAABImfSXAAAAAOp1XGABE09wdXNIZWFkAQE4AYA+AAAAAABPZ2dTAAAAAAAAAAAAAEiZ9JcBAAAA7rwI3AE+",
  "T3B1c1RhZ3MNAAAATGF2ZjU5LjI3LjEwMAEAAAAdAAAAZW5jb2Rlcj1MYXZjNTkuMzcuMTAwIGxpYm9wdXNPZ2dTAABAvwAAAAAA",
  "AEiZ9JcCAAAA+mQjMhE7koOYmoNyeGRWTU5MVkxaVlgi/IdrUtEQr9RM9nX26Q+3eCuE5/4mfgy/c5/GOPFASfPuF0vT2s0ibq20",
  "eNCbXxPPN4Ya8PQImTZQWOgdsD1zbDFC6V2jAElnn/jGyP/aDeB8iahZozqQGaLxYrk4aV5ae3OatDqS9rkaXWvyLtt/JFsIblHQ",
  "APjEjbcJmNF8XJTDON1HXjIpLByqUhSD0KQW/Mf/8kNFXhdXT276kNqFpb+t+9yJCOvOF04svf03amCleZPm813POzu7K4ozxkRj",
  "uSSBtgNsLwp/95BY6buyY0e6Kuyp0qMz0c9d0r7cmyWVIqAyKDuMbDJgDKnFTuermiX0ddoQvIV6pqAVX8nVzexK8aIuyH15YmtI",
  "U/PoIqsgdRCCteWfCiJmSIv4T+TqUEZkID/oQ3+GbzvrowK82x9dYl4+FLTizZFQIo+NzTT1eSQb/0jRYwOcRrxL4FjpaRd/KgX5",
  "d+v9NAJP14eG89FVhwf0LylUX9r8r7C9JFICvNJPyCsiB5fkE311LSphV/3igLUSMWF4gvYHR9zkmoY3j4fS2cUd3MLAF5rf/YOY",
  "308eFPTasGoPvqxlv8POpQoqhyWirubVwAhf8wflQ3iu9AiBXxGonOrQQfgyQpdTemYlaJY+YkGDFsqAuhhBJHBOcpqAWOktaVRo",
  "SLxd40V5FeuNhGVIqp/TzIdm0FHmdcLWzg2rzr7cil92JfASNoHXiaFmwb1cY/LFfadF01GxW/0y+MwC/jhCuPCX9TEFSnQjf79v",
  "39AwInJq/NJ1K7UHg6dS2TfjEH5ImepVsdIfLCa7KUBWrFxY+C26IJrrMSKQuJqq57HpBTsThC2a14eTNpZdjFZ03jkW397NMFjn",
  "vGgdjlz7sbRqPAcgWdDMvmPKc3BJv36iIPFLI3ost7VcTD2BthvN5PMc/T/QfrBOR25lJLCmOpfGHjV9kQeoxUORHcb9qVN6fkT1",
  "tjWJbXnvhcrvFcrTIry0VJ5xh0htw22RZd1K6RR8V2AcsC4mAkfQH6T5y0OtQhtrcjDQTuHgWOc/QfhzCj+MuB36gWDE1OQbcK9j",
  "OlsG3NXhfItQFpthYQQIxaKv41CYaJLEMRf0wDd+Bhlezoc8g1yhFWxE6YzDyqr5i8+l+CKBQIBR9MBBHTbH7uO77vqALJeXPd0a",
  "UibE01ts70bDvTnB661YhzPAWOaFsD26nVFGhMEhj09vcS8qvshGl2l3MLLEXp9qstbQsJe4Rzjl9/Ux1T9RT+ybX7uZfZAwmL8G",
  "FQ/WATSCdJ11uQocZebBeGCmj2FkZdaNRzeRHr6J6D2XsoC86wNh/cq4hkzrne+hJPHEtv7w3kwV7GIofErIWOAwYZ3XZsSLpoFB",
  "oWrEYD1Rq15rFhSZIMav1+cQ9VVm9NifTie/RKNra5bCYUFwxnjXWoKl5NjeiIZtyDEQPyscUeR3jKQiYsvh4NhfHKzPJW7G2010",
  "y9BXuTwvE5E7TAp3gFgAlt0aGXAO6omqBV7Y/oxV9Wot2SmVs2pFVrEMsta9Dc1faSkZXGViOJxgRvfUrYc3nFRduc+xCc2Cw6Tn",
  "c4GZl3oLYsBcTgLWACjBbahCCMMX4dZoWACZF8vr7iCO0xI/bs9UxG2OXBobe2QiuqNsZ0MzAiid/hIZywSj4Su/4xQB5GrDpoI4",
  "glZwldOHVW/vy6kP7KwNyO6IepXhC/RCM0BYAFRlKxGhsh6jBJDH3SLhL6sn1c07WXUAToMj+FBStShJ6do6Yhfihq4TgOZgcsGW",
  "YvK0ZMIkOMUgQAYU6BfdMNSulRw3pG87Ro95xdBYBIqChEicdBPx+nSd1t3y0RDM0HcOG5Ecp+Te9hUT8GyFGuiUtaWis93blnx0",
  "ZMfa9QmY0vMDIAJOgrO/mPeKek/vKoZ+NzuFQnv4WASWxq5gzgY9QqtVJKQr3zH/c34JeSXNaKsRllJKDFH/SIGdwYisjfGK8s5b",
  "Zx1Ab+SietvW4FHZn+kp1w8iOM05XMhKGRHCHE2lQr3MozZnKufJl5BYBJQt6Mf18q553pacvWsbTDfzQNfDHizwsI6CIou884Dj",
  "yuqP4P31jLDVJmOKOxpHVDFr09+KrywGnpqOk+9p51x40z5KKJOxT8m6WASSnfpmCrOz5JqYUx2B2isB2vPAPCEK2W5dtStmn5bB",
  "33wdJ/UdtspL6+fGQAkOql9PS4hKN+ivIZfzEQSCi22WvlqoG3hUeWxL5UI1HniVOg/oxHPb8B6gWAVQq9y8UjnjqjrFrAwc/WEc",
  "5GQptgEQsTJkaKKqATmQoKY7bmpvC3bAeW5uTfDxDc9y6kQDSUOHyncC4VbBtQvkiJHrc8uNXeMtth1Bu7oXB8XB04BPZ2dTAAR4",
  "wAAAAAAAAEiZ9JcDAAAAiDzD3AEpWAD1HWrDKyPtsAXGeD92Y/00L3YLj+EqQ0SB1/RJmNZJa+3BLi4QPOA="
].join("");

const SUPPORTED_AUDIO_EXT = new Set([".ogg", ".opus", ".mp3"]);
const SUPPORTED_AUDIO_TYPES = ["audio/mpeg", "audio/mp3", "audio/ogg", "audio/opus", "application/ogg"];

function encodeTrackId(relativePath) {
  return Buffer.from(relativePath).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeTrackId(id) {
  const normalized = String(id || "").replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(normalized, "base64").toString("utf8");
}

function decodeEntities(value) {
  return String(value || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function normalizeSearchText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[，。！？、]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compactQuery(value) {
  return normalizeSearchText(value)
    .replace(/播放|搜索|帮我|我要听|我想听|来一首|一首|音乐|歌曲|播客|服务器|后台|文件/g, " ")
    .replace(/\b(play|search|music|podcast|server|file|song|audio)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleFromFile(fileName) {
  return path.basename(fileName, path.extname(fileName)).replace(/[-_]+/g, " ");
}

function audioFormat(fileName) {
  const ext = path.extname(fileName).toLowerCase();
  if (ext === ".mp3") {
    return "mp3";
  }
  if (ext === ".opus") {
    return "opus";
  }
  return "ogg";
}

function audioContentType(fileName) {
  const ext = path.extname(fileName).toLowerCase();
  if (ext === ".mp3") {
    return "audio/mpeg";
  }
  if (ext === ".opus") {
    return "audio/ogg; codecs=opus";
  }
  return "audio/ogg";
}

function cachePathFor(relativePath, id) {
  const ext = path.extname(relativePath).toLowerCase() || ".bin";
  return `music/cache/server-${id}${ext}`;
}

function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  const file = fs.openSync(filePath, "r");
  const buffer = Buffer.allocUnsafe(64 * 1024);
  try {
    let read = 0;
    do {
      read = fs.readSync(file, buffer, 0, buffer.length, null);
      if (read > 0) {
        hash.update(buffer.subarray(0, read));
      }
    } while (read > 0);
  } finally {
    fs.closeSync(file);
  }
  return hash.digest("hex");
}

// MPEG audio version/layer/bitrate/samplerate tables, indexed by the bit fields
// packed into a 4-byte frame header. Used to estimate MP3 duration without ffprobe.
const MP3_BITRATE_KBPS = {
  // MPEG1
  "1-3": [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448, 0], // Layer I
  "1-2": [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384, 0], // Layer II
  "1-1": [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0], // Layer III
  // MPEG2 / 2.5
  "2-3": [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256, 0], // Layer I
  "2-2": [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0], // Layer II
  "2-1": [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0] // Layer III
};
const MP3_SAMPLERATE = {
  1: [44100, 48000, 32000, 0], // MPEG1
  2: [22050, 24000, 16000, 0], // MPEG2
  0: [11025, 12000, 8000, 0] // MPEG2.5
};
// Samples per frame by (version, layer). Layer I is always 384; Layer II is 1152;
// Layer III is 1152 for MPEG1 and 576 for MPEG2/2.5.
function mp3SamplesPerFrame(versionId, layerId) {
  if (layerId === 3) {
    return 384; // Layer I
  }
  if (layerId === 2) {
    return 1152; // Layer II
  }
  return versionId === 3 ? 1152 : 576; // Layer III
}

// Estimate an MP3 file's duration in seconds by parsing its first audio frame
// header. Uses a Xing/Info VBR header for accuracy when present, otherwise falls
// back to file-size / bitrate (accurate for CBR). Returns 0 on any parse failure.
function mp3DurationSec(filePath, fileSize) {
  let fd = -1;
  try {
    fd = fs.openSync(filePath, "r");
    const head = Buffer.allocUnsafe(16);
    if (fs.readSync(fd, head, 0, 16, 0) < 10) {
      return 0;
    }

    // Skip an ID3v2 tag if present: "ID3" + version(2) + flags(1) + syncsafe size(4).
    let offset = 0;
    if (head[0] === 0x49 && head[1] === 0x44 && head[2] === 0x33) {
      const size =
        (head[6] & 0x7f) * 0x200000 +
        (head[7] & 0x7f) * 0x4000 +
        (head[8] & 0x7f) * 0x80 +
        (head[9] & 0x7f);
      offset = 10 + size;
    }

    // Scan forward for the first frame sync (11 set bits) within a bounded window.
    const scan = Buffer.allocUnsafe(4096);
    const scanRead = fs.readSync(fd, scan, 0, scan.length, offset);
    let frameStart = -1;
    for (let i = 0; i + 4 <= scanRead; i++) {
      if (scan[i] !== 0xff || (scan[i + 1] & 0xe0) !== 0xe0) {
        continue;
      }
      const versionId = (scan[i + 1] >> 3) & 0x03; // 3=MPEG1, 2=MPEG2, 0=MPEG2.5
      const layerId = (scan[i + 1] >> 1) & 0x03; // 3=LayerI, 2=II, 1=III
      const bitrateIdx = (scan[i + 2] >> 4) & 0x0f;
      const sampleIdx = (scan[i + 2] >> 2) & 0x03;
      if (versionId === 1 || layerId === 0 || bitrateIdx === 0 || bitrateIdx === 15 || sampleIdx === 3) {
        continue; // reserved/invalid fields
      }
      frameStart = i;

      const versionKey = versionId === 3 ? 1 : 2;
      const layerKey = layerId; // 3/2/1 maps to our table suffix
      const bitrate = (MP3_BITRATE_KBPS[`${versionKey}-${layerKey}`] || [])[bitrateIdx] * 1000;
      const srKey = versionId === 3 ? 1 : versionId === 2 ? 2 : 0;
      const sampleRate = (MP3_SAMPLERATE[srKey] || [])[sampleIdx];
      if (!bitrate || !sampleRate) {
        return 0;
      }
      const samplesPerFrame = mp3SamplesPerFrame(versionId, layerId);

      // Look for a Xing/Info VBR header inside this first frame. Its offset from
      // the frame start depends on version and channel mode.
      const channelMode = (scan[i + 3] >> 6) & 0x03; // 3=mono
      const xingOffset = i + 4 + (versionId === 3 ? (channelMode === 3 ? 17 : 32) : (channelMode === 3 ? 9 : 17));
      if (xingOffset + 12 <= scanRead) {
        const tag = scan.toString("ascii", xingOffset, xingOffset + 4);
        if (tag === "Xing" || tag === "Info") {
          const flags = scan.readUInt32BE(xingOffset + 4);
          if (flags & 0x01) {
            const frameCount = scan.readUInt32BE(xingOffset + 8);
            if (frameCount > 0) {
              return Math.round((frameCount * samplesPerFrame) / sampleRate);
            }
          }
        }
      }

      // No VBR header: assume CBR and use file size over bitrate.
      const audioBytes = Math.max(0, (fileSize || 0) - (offset + frameStart));
      if (audioBytes > 0) {
        return Math.round((audioBytes * 8) / bitrate);
      }
      return 0;
    }
    return 0;
  } catch {
    return 0;
  } finally {
    if (fd >= 0) {
      try {
        fs.closeSync(fd);
      } catch {
        // ignore
      }
    }
  }
}

// Best-effort duration for any supported audio file. Only MP3 is parsed locally;
// Ogg/Opus return 0 (the device falls back to track-position display).
function audioDurationSec(filePath, fileSize) {
  if (path.extname(filePath).toLowerCase() === ".mp3") {
    return mp3DurationSec(filePath, fileSize);
  }
  return 0;
}

function isSupportedAudio(fileName) {
  return SUPPORTED_AUDIO_EXT.has(path.extname(fileName).toLowerCase());
}

function formatFromContentType(contentType = "") {
  const value = String(contentType).toLowerCase();
  if (value.includes("mpeg") || value.includes("mp3")) {
    return "mp3";
  }
  if (value.includes("opus")) {
    return "opus";
  }
  if (value.includes("ogg")) {
    return "ogg";
  }
  return "";
}

function formatFromUrl(url, contentType = "") {
  const byType = formatFromContentType(contentType);
  if (byType) {
    return byType;
  }
  try {
    return audioFormat(new URL(url).pathname);
  } catch (error) {
    return "mp3";
  }
}

function safeRemoteMediaUrl(value, options = {}) {
  let url = null;
  try {
    url = new URL(String(value || ""));
  } catch (error) {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return null;
  }
  const host = url.hostname.toLowerCase();
  if (!options.onlineMediaAllowPrivateHosts && (host === "localhost" || host.endsWith(".local"))) {
    return null;
  }
  const ipVersion = net.isIP(host);
  if (!options.onlineMediaAllowPrivateHosts && ipVersion === 4) {
    const parts = host.split(".").map((item) => Number(item));
    if (
      parts[0] === 10 ||
      parts[0] === 127 ||
      (parts[0] === 169 && parts[1] === 254) ||
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
      (parts[0] === 192 && parts[1] === 168)
    ) {
      return null;
    }
  }
  if (!options.onlineMediaAllowPrivateHosts && ipVersion === 6 && (host === "::1" || host.startsWith("fe80:") || host.startsWith("fc") || host.startsWith("fd"))) {
    return null;
  }
  return url;
}

function isAudioContentType(contentType) {
  const value = String(contentType || "").toLowerCase();
  return SUPPORTED_AUDIO_TYPES.some((type) => value.includes(type));
}

function isLikelyAudioUrl(url, contentType = "") {
  if (isAudioContentType(contentType)) {
    return true;
  }
  try {
    return isSupportedAudio(new URL(url).pathname);
  } catch (error) {
    return false;
  }
}

function abortSignal(timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(1000, Number(timeoutMs) || 4500));
  return { controller, timeout };
}

function extractFirstUrl(value) {
  const match = String(value || "").match(/https?:\/\/[^\s"'<>]+/i);
  return match ? match[0] : "";
}

function parseDurationSec(value) {
  const text = String(value || "").trim();
  if (!text) {
    return 0;
  }
  if (/^\d+$/.test(text)) {
    return Number(text) || 0;
  }
  const parts = text.split(":").map((item) => Number(item));
  if (parts.some((item) => !Number.isFinite(item))) {
    return 0;
  }
  return parts.reduce((sum, item) => (sum * 60) + item, 0);
}

function rssTag(block, tag) {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return decodeEntities(new RegExp(`<${escaped}[^>]*>([\\s\\S]*?)<\\/${escaped}>`, "i").exec(block)?.[1] || "");
}

function rssAttr(fragment, attr) {
  const escaped = attr.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return decodeEntities(new RegExp(`${escaped}=["']([^"']+)["']`, "i").exec(fragment || "")?.[1] || "");
}

function ensureServerMediaLibrary(config) {
  fs.mkdirSync(config.serverMusicDir, { recursive: true });
  const tracks = listServerTracks(config);
  if (tracks.length > 0) {
    return;
  }
  fs.writeFileSync(path.join(config.serverMusicDir, "sample-success.ogg"), Buffer.from(SAMPLE_PODCAST_BASE64, "base64"));
}

function listServerTracks(config) {
  const root = path.resolve(config.serverMusicDir);
  if (!fs.existsSync(root)) {
    return [];
  }

  const tracks = [];
  const walk = (dir) => {
    if (tracks.length >= 100) {
      return;
    }
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile() && isSupportedAudio(entry.name)) {
        const relative = path.relative(root, fullPath).replace(/\\/g, "/");
        const stat = fs.statSync(fullPath);
        const id = encodeTrackId(relative);
        const streamUrl = `${config.publicBaseUrl}/api/media/server/stream/${id}`;
        tracks.push({
          id,
          title: titleFromFile(entry.name),
          artist: "Family Server",
          source: "服务器播客",
          path: relative,
          size: stat.size,
          durationSec: audioDurationSec(fullPath, stat.size),
          sha256: sha256File(fullPath),
          format: audioFormat(entry.name),
          contentType: audioContentType(entry.name),
          playbackMode: "stream",
          cacheable: true,
          supportsRange: true,
          cachePath: cachePathFor(relative, id),
          downloadUrl: streamUrl,
          streamUrl
        });
      }
      if (tracks.length >= 100) {
        return;
      }
    }
  };
  walk(root);
  tracks.sort((a, b) => a.path.localeCompare(b.path));
  return tracks;
}

function ensureMediaState(state) {
  state.media = state.media || {};
  state.media.serverProgress = Array.isArray(state.media.serverProgress) ? state.media.serverProgress : [];
  state.media.onlineTracks = Array.isArray(state.media.onlineTracks) ? state.media.onlineTracks : [];
  state.media.searchHistory = Array.isArray(state.media.searchHistory) ? state.media.searchHistory : [];
  state.media.podcastFeeds = Array.isArray(state.media.podcastFeeds) ? state.media.podcastFeeds : [];
  state.media.podcastEpisodes = Array.isArray(state.media.podcastEpisodes) ? state.media.podcastEpisodes : [];
  state.media.favorites = Array.isArray(state.media.favorites) ? state.media.favorites : [];
  state.media.playbackHistory = Array.isArray(state.media.playbackHistory) ? state.media.playbackHistory : [];
  state.media.queue = state.media.queue && typeof state.media.queue === "object" ? state.media.queue : {};
  state.media.queue.items = Array.isArray(state.media.queue.items) ? state.media.queue.items : [];
  state.media.queue.currentId = state.media.queue.currentId || "";
  state.media.queue.updatedAt = state.media.queue.updatedAt || null;
  return state.media;
}

function podcastEpisodeTrackView(config, episode) {
  const id = String(episode.id || "");
  if (!id || !episode.remoteUrl) {
    return null;
  }
  const streamUrl = `${config.publicBaseUrl}/api/media/online/stream/${id}`;
  const format = episode.format || formatFromUrl(episode.remoteUrl, episode.contentType);
  return {
    id,
    title: String(episode.title || "播客节目").slice(0, 120),
    artist: String(episode.artist || episode.feedTitle || "Podcast").slice(0, 120),
    source: String(episode.feedTitle || episode.source || "播客订阅").slice(0, 80),
    origin: "online",
    provider: "rss",
    path: String(episode.remoteUrl || "").slice(0, 600),
    size: Number(episode.size || 0),
    durationSec: Number(episode.durationSec || 0),
    sha256: "",
    format,
    contentType: episode.contentType || audioContentType(episode.remoteUrl),
    playbackMode: "stream",
    cacheable: true,
    supportsRange: true,
    cachePath: cachePathFor(`podcast-${id}.${format || "mp3"}`, id),
    downloadUrl: streamUrl,
    streamUrl,
    remoteUrl: episode.remoteUrl,
    feedId: episode.feedId || "",
    episodeId: id,
    publishedAt: episode.publishedAt || "",
    imageUrl: episode.imageUrl || ""
  };
}

function listPodcastEpisodeTracks(state, config, limit = 80) {
  const media = ensureMediaState(state);
  const enabledFeeds = new Set(media.podcastFeeds.filter((feed) => feed.enabled !== false).map((feed) => feed.id));
  return media.podcastEpisodes
    .filter((episode) => enabledFeeds.has(episode.feedId))
    .sort((a, b) => String(b.publishedAt || b.discoveredAt || "").localeCompare(String(a.publishedAt || a.discoveredAt || "")))
    .slice(0, Math.max(1, limit))
    .map((episode) => podcastEpisodeTrackView(config, episode))
    .filter(Boolean);
}

function onlineTrackView(config, track) {
  const id = String(track.id || "");
  if (!id || !track.remoteUrl) {
    return null;
  }
  const streamUrl = `${config.publicBaseUrl}/api/media/online/stream/${id}`;
  return {
    id,
    title: String(track.title || "网络音频").slice(0, 120),
    artist: String(track.artist || "Online Audio").slice(0, 120),
    source: String(track.source || "网络音频").slice(0, 80),
    origin: "online",
    provider: String(track.provider || "online").slice(0, 40),
    path: String(track.remoteUrl || "").slice(0, 600),
    size: Number(track.size || 0),
    durationSec: Number(track.durationSec || 0),
    sha256: "",
    format: track.format || formatFromUrl(track.remoteUrl, track.contentType),
    contentType: track.contentType || audioContentType(track.remoteUrl),
    playbackMode: "stream",
    cacheable: true,
    supportsRange: true,
    cachePath: cachePathFor(`online-${id}.${track.format || "mp3"}`, id),
    downloadUrl: streamUrl,
    streamUrl,
    remoteUrl: track.remoteUrl
  };
}

function listOnlineTracks(state, config) {
  return (ensureMediaState(state).onlineTracks || [])
    .map((track) => onlineTrackView(config, track))
    .filter(Boolean);
}

function listKnownServerTracks(state, config) {
  const locals = listServerTracks(config);
  const online = state ? [...listOnlineTracks(state, config), ...listPodcastEpisodeTracks(state, config, 80)] : [];
  const seen = new Set(locals.map((track) => track.id));
  return [...locals, ...online.filter((track) => !seen.has(track.id))];
}

function trackSearchHaystack(track) {
  return normalizeSearchText([
    track.title,
    track.artist,
    track.path,
    track.source,
    track.provider,
    track.format
  ].filter(Boolean).join(" "));
}

function searchLocalTracks(config, query, limit = 8) {
  const q = compactQuery(query);
  const tracks = listServerTracks(config);
  if (!q) {
    return tracks.slice(0, Math.max(1, limit));
  }
  const terms = q.split(" ").filter(Boolean);
  return tracks
    .map((track) => {
      const haystack = trackSearchHaystack(track);
      const score = terms.reduce((sum, term) => sum + (haystack.includes(term) ? 1 : 0), 0);
      return { track, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.track.title.localeCompare(b.track.title))
    .slice(0, Math.max(1, limit))
    .map((item) => item.track);
}

function registerOnlineTrack(state, config, track, query = "") {
  const media = ensureMediaState(state);
  const remoteUrl = String(track.remoteUrl || track.url || track.streamUrl || "");
  const safeUrl = safeRemoteMediaUrl(remoteUrl, config);
  if (!safeUrl || !isLikelyAudioUrl(safeUrl.href, track.contentType)) {
    return null;
  }
  const id = track.id && String(track.id).startsWith("online_")
    ? track.id
    : `online_${crypto.createHash("sha256").update(safeUrl.href).digest("hex").slice(0, 24)}`;
  const item = {
    id,
    remoteUrl: safeUrl.href,
    title: String(track.title || titleFromFile(safeUrl.pathname) || "网络音频").slice(0, 120),
    artist: String(track.artist || track.author || track.provider || "Online Audio").slice(0, 120),
    source: String(track.source || "网络音频").slice(0, 80),
    provider: String(track.provider || "online").slice(0, 40),
    contentType: String(track.contentType || audioContentType(safeUrl.pathname)).slice(0, 80),
    format: String(track.format || formatFromUrl(safeUrl.href, track.contentType)).slice(0, 20),
    durationSec: Math.max(0, Number(track.durationSec || 0) || 0),
    size: Math.max(0, Number(track.size || 0) || 0),
    query: String(query || "").slice(0, 160),
    resolvedAt: new Date().toISOString()
  };
  media.onlineTracks = media.onlineTracks.filter((existing) => existing.id !== id);
  media.onlineTracks.unshift(item);
  media.onlineTracks = media.onlineTracks.slice(0, 40);
  return onlineTrackView(config, item);
}

function findOnlineTrack(state, config, id) {
  const media = ensureMediaState(state);
  const item = media.onlineTracks.find((track) => track.id === id);
  if (item) {
    return onlineTrackView(config, item);
  }
  const episode = media.podcastEpisodes.find((track) => track.id === id);
  return episode ? podcastEpisodeTrackView(config, episode) : null;
}

function listPodcastFeeds(state) {
  return ensureMediaState(state).podcastFeeds.map((feed) => ({
    id: feed.id,
    title: feed.title,
    url: feed.url,
    enabled: feed.enabled !== false,
    description: feed.description || "",
    author: feed.author || "",
    imageUrl: feed.imageUrl || "",
    episodeCount: Number(feed.episodeCount || 0),
    lastRefreshAt: feed.lastRefreshAt || null,
    refreshError: feed.refreshError || "",
    createdAt: feed.createdAt || null,
    updatedAt: feed.updatedAt || null
  }));
}

function listPodcastEpisodes(state, config, filter = {}) {
  const media = ensureMediaState(state);
  const feedId = String(filter.feedId || filter.feed_id || "");
  const q = compactQuery(filter.q || filter.query || "");
  const terms = q.split(" ").filter(Boolean);
  return media.podcastEpisodes
    .filter((episode) => !feedId || episode.feedId === feedId)
    .map((episode) => podcastEpisodeTrackView(config, episode))
    .filter(Boolean)
    .filter((track) => {
      if (terms.length === 0) {
        return true;
      }
      const haystack = trackSearchHaystack(track);
      return terms.some((term) => haystack.includes(term));
    })
    .sort((a, b) => String(b.publishedAt || "").localeCompare(String(a.publishedAt || "")));
}

function upsertPodcastFeed(state, config, body = {}, fallbackId = "") {
  const media = ensureMediaState(state);
  const rawUrl = String(body.url || body.feedUrl || body.feed_url || "").trim();
  const safeUrl = safeRemoteMediaUrl(rawUrl, config);
  if (!safeUrl) {
    const error = new Error("podcast feed url must be a safe http(s) URL");
    error.statusCode = 400;
    throw error;
  }
  const now = new Date().toISOString();
  const id = safeId(body.id || fallbackId || `feed-${crypto.createHash("sha256").update(safeUrl.href).digest("hex").slice(0, 16)}`, "feed");
  const existing = media.podcastFeeds.find((feed) => feed.id === id);
  const item = existing || {
    id,
    createdAt: now,
    lastRefreshAt: null,
    refreshError: "",
    episodeCount: 0
  };
  item.url = safeUrl.href;
  item.title = String(body.title || item.title || safeUrl.hostname).slice(0, 120);
  item.description = String(body.description || item.description || "").slice(0, 400);
  item.author = String(body.author || item.author || "").slice(0, 120);
  item.imageUrl = String(body.imageUrl || item.image_url || item.imageUrl || "").slice(0, 600);
  item.enabled = body.enabled === undefined ? item.enabled !== false : Boolean(body.enabled);
  item.updatedAt = now;
  if (!existing) {
    media.podcastFeeds.unshift(item);
  }
  media.podcastFeeds = media.podcastFeeds.slice(0, 80);
  return item;
}

function deletePodcastFeed(state, feedId) {
  const media = ensureMediaState(state);
  const id = String(feedId || "");
  const before = media.podcastFeeds.length;
  media.podcastFeeds = media.podcastFeeds.filter((feed) => feed.id !== id);
  media.podcastEpisodes = media.podcastEpisodes.filter((episode) => episode.feedId !== id);
  media.queue.items = media.queue.items.filter((item) => item.feedId !== id);
  if (media.podcastFeeds.length === before) {
    const error = new Error("podcast feed not found");
    error.statusCode = 404;
    throw error;
  }
  return { id, deleted: true, feedCount: media.podcastFeeds.length, episodeCount: media.podcastEpisodes.length };
}

function parsePodcastFeedXml(xml, feedUrl) {
  const channel = /<channel\b[\s\S]*?<\/channel>/i.exec(String(xml || ""))?.[0] || String(xml || "");
  const imageBlock = /<image\b[\s\S]*?<\/image>/i.exec(channel)?.[0] || "";
  const itunesImage = /<itunes:image\b[^>]*href=["']([^"']+)["'][^>]*>/i.exec(channel)?.[1] || "";
  const feed = {
    title: rssTag(channel, "title") || "Podcast",
    description: rssTag(channel, "description"),
    author: rssTag(channel, "itunes:author") || rssTag(channel, "author"),
    imageUrl: decodeEntities(itunesImage || rssTag(imageBlock, "url"))
  };
  const items = [];
  const itemBlocks = String(xml || "").match(/<item\b[\s\S]*?<\/item>/gi) || [];
  for (const block of itemBlocks) {
    const enclosure = /<enclosure\b[^>]*>/i.exec(block)?.[0] || "";
    const mediaContent = /<media:content\b[^>]*>/i.exec(block)?.[0] || "";
    const rawUrl = rssAttr(enclosure, "url") || rssAttr(mediaContent, "url");
    if (!rawUrl) {
      continue;
    }
    let remoteUrl = rawUrl;
    try {
      remoteUrl = new URL(rawUrl, feedUrl).href;
    } catch (error) {
      continue;
    }
    const guid = rssTag(block, "guid") || remoteUrl;
    const title = rssTag(block, "title") || titleFromFile(remoteUrl);
    const imageUrl = decodeEntities(/<itunes:image\b[^>]*href=["']([^"']+)["'][^>]*>/i.exec(block)?.[1] || feed.imageUrl || "");
    const pubDate = rssTag(block, "pubDate");
    const parsedDate = pubDate ? new Date(pubDate) : null;
    items.push({
      guid,
      title,
      artist: rssTag(block, "itunes:author") || rssTag(block, "author") || feed.author || feed.title,
      description: rssTag(block, "description") || rssTag(block, "itunes:summary"),
      publishedAt: parsedDate && Number.isFinite(parsedDate.getTime()) ? parsedDate.toISOString() : "",
      remoteUrl,
      contentType: rssAttr(enclosure || mediaContent, "type"),
      size: Number(rssAttr(enclosure || mediaContent, "length")) || 0,
      durationSec: parseDurationSec(rssTag(block, "itunes:duration")),
      imageUrl
    });
  }
  return { feed, episodes: items };
}

async function fetchPodcastFeed(config, feed) {
  const safeFeedUrl = safeRemoteMediaUrl(feed.url, config);
  if (!safeFeedUrl) {
    const error = new Error("podcast feed url rejected");
    error.statusCode = 400;
    throw error;
  }
  const xml = await fetchText(safeFeedUrl.href, config.onlineMediaTimeoutMs);
  if (!xml) {
    const error = new Error("podcast feed fetch failed");
    error.statusCode = 502;
    throw error;
  }
  const parsed = parsePodcastFeedXml(xml, safeFeedUrl.href);
  parsed.episodes = parsed.episodes.filter((episode) => {
    const safeUrl = safeRemoteMediaUrl(episode.remoteUrl, config);
    return safeUrl && isLikelyAudioUrl(safeUrl.href, episode.contentType);
  });
  return parsed;
}

function applyPodcastFeedRefresh(state, config, feedId, parsed) {
  const media = ensureMediaState(state);
  const feed = media.podcastFeeds.find((item) => item.id === feedId);
  if (!feed) {
    const error = new Error("podcast feed not found");
    error.statusCode = 404;
    throw error;
  }
  const now = new Date().toISOString();
  feed.title = String(parsed.feed?.title || feed.title).slice(0, 120);
  feed.description = String(parsed.feed?.description || feed.description || "").slice(0, 400);
  feed.author = String(parsed.feed?.author || feed.author || "").slice(0, 120);
  feed.imageUrl = String(parsed.feed?.imageUrl || feed.imageUrl || "").slice(0, 600);
  feed.lastRefreshAt = now;
  feed.refreshError = "";
  feed.updatedAt = now;

  const previous = new Map(media.podcastEpisodes.filter((episode) => episode.feedId === feedId).map((episode) => [episode.id, episode]));
  const nextEpisodes = [];
  for (const episode of parsed.episodes || []) {
    const id = `podcast_${crypto.createHash("sha256").update(`${feed.id}:${episode.guid || episode.remoteUrl}`).digest("hex").slice(0, 24)}`;
    const existing = previous.get(id) || {};
    nextEpisodes.push({
      ...existing,
      id,
      feedId: feed.id,
      feedTitle: feed.title,
      guid: String(episode.guid || episode.remoteUrl || id).slice(0, 240),
      title: String(episode.title || "播客节目").slice(0, 160),
      artist: String(episode.artist || feed.author || feed.title || "Podcast").slice(0, 120),
      description: String(episode.description || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 800),
      publishedAt: episode.publishedAt || "",
      remoteUrl: episode.remoteUrl,
      contentType: String(episode.contentType || audioContentType(episode.remoteUrl)).slice(0, 80),
      format: String(episode.format || formatFromUrl(episode.remoteUrl, episode.contentType)).slice(0, 20),
      size: Math.max(0, Number(episode.size || 0) || 0),
      durationSec: Math.max(0, Number(episode.durationSec || 0) || 0),
      imageUrl: String(episode.imageUrl || feed.imageUrl || "").slice(0, 600),
      provider: "rss",
      source: feed.title,
      discoveredAt: existing.discoveredAt || now,
      updatedAt: now
    });
  }
  const otherEpisodes = media.podcastEpisodes.filter((episode) => episode.feedId !== feedId);
  media.podcastEpisodes = [...nextEpisodes, ...otherEpisodes]
    .sort((a, b) => String(b.publishedAt || b.discoveredAt || "").localeCompare(String(a.publishedAt || a.discoveredAt || "")))
    .slice(0, 500);
  feed.episodeCount = nextEpisodes.length;
  return { feed, episodes: nextEpisodes };
}

function markPodcastFeedRefreshError(state, feedId, message) {
  const media = ensureMediaState(state);
  const feed = media.podcastFeeds.find((item) => item.id === feedId);
  if (feed) {
    feed.refreshError = String(message || "refresh failed").slice(0, 240);
    feed.updatedAt = new Date().toISOString();
  }
  return feed || null;
}

function podcastFeedDue(feed, intervalMinutes, now = Date.now()) {
  if (!feed || feed.enabled === false) {
    return false;
  }
  if (!feed.lastRefreshAt) {
    return true;
  }
  const refreshedAt = new Date(feed.lastRefreshAt).getTime();
  if (!Number.isFinite(refreshedAt)) {
    return true;
  }
  return now - refreshedAt >= Math.max(1, Number(intervalMinutes) || 1) * 60 * 1000;
}

async function refreshPodcastFeeds(store, config, options = {}) {
  const force = Boolean(options.force);
  const intervalMinutes = Number(options.intervalMinutes || config.podcastRefreshIntervalMinutes || 0);
  const batchSize = Math.max(1, Math.min(Number(options.batchSize || config.podcastRefreshBatchSize || 6) || 6, 20));
  const feeds = listPodcastFeeds(store.snapshot())
    .filter((feed) => feed.enabled !== false)
    .filter((feed) => force || podcastFeedDue(feed, intervalMinutes))
    .slice(0, batchSize);
  const result = {
    checkedAt: new Date().toISOString(),
    force,
    intervalMinutes,
    requested: feeds.length,
    refreshed: [],
    failed: []
  };
  for (const feed of feeds) {
    try {
      const parsed = await fetchPodcastFeed(config, feed);
      let applied = null;
      store.update((state) => {
        applied = applyPodcastFeedRefresh(state, config, feed.id, parsed);
      });
      result.refreshed.push({
        id: feed.id,
        title: applied?.feed?.title || feed.title,
        episodeCount: applied?.episodes?.length || 0
      });
    } catch (error) {
      store.update((state) => {
        markPodcastFeedRefreshError(state, feed.id, error.message);
      });
      result.failed.push({
        id: feed.id,
        title: feed.title,
        error: error.message
      });
    }
  }
  return result;
}

function queueTrackView(track) {
  if (!track) {
    return null;
  }
  return {
    id: track.id,
    title: track.title,
    artist: track.artist,
    source: track.source,
    origin: track.origin || "local",
    provider: track.provider || "",
    path: track.path || "",
    streamUrl: track.streamUrl || "",
    downloadUrl: track.downloadUrl || track.streamUrl || "",
    remoteUrl: track.remoteUrl || "",
    contentType: track.contentType || "",
    format: track.format || "",
    size: Number(track.size || 0),
    durationSec: Number(track.durationSec || 0),
    sha256: track.sha256 || "",
    cacheable: Boolean(track.cacheable),
    supportsRange: Boolean(track.supportsRange),
    cachePath: track.cachePath || "",
    playbackMode: track.playbackMode || "stream",
    feedId: track.feedId || "",
    episodeId: track.episodeId || "",
    publishedAt: track.publishedAt || "",
    imageUrl: track.imageUrl || ""
  };
}

function findTrackById(state, config, id) {
  const trackId = String(id || "");
  if (!trackId) {
    return null;
  }
  return listKnownServerTracks(state, config).find((track) => track.id === trackId) || null;
}

function progressPercent(positionSec, durationSec, completed = false) {
  if (completed) {
    return 100;
  }
  const duration = Math.max(0, Number(durationSec || 0) || 0);
  const position = Math.max(0, Number(positionSec || 0) || 0);
  if (duration <= 0 || position <= 0) {
    return 0;
  }
  return Math.min(99, Math.max(1, Math.round((position / duration) * 100)));
}

function progressView(item, track = null) {
  if (!item) {
    return null;
  }
  const durationSec = Math.max(0, Number(item.durationSec || track?.durationSec || 0) || 0);
  const positionSec = Math.max(0, Number(item.positionSec || 0) || 0);
  const completed = Boolean(item.completed);
  const percent = progressPercent(positionSec, durationSec, completed);
  return {
    trackId: item.trackId || track?.id || "",
    deviceId: item.deviceId || "",
    positionSec,
    durationSec,
    percent,
    completed,
    status: completed ? "completed" : (positionSec > 0 ? "in_progress" : "new"),
    updatedAt: item.updatedAt || "",
    track: track || null,
    title: track?.title || item.title || item.trackId || "",
    artist: track?.artist || "",
    source: track?.source || ""
  };
}

function latestProgressForTrack(state, config, trackId, deviceId = "") {
  const media = ensureMediaState(state);
  const id = String(trackId || "");
  const targetDevice = String(deviceId || "");
  const item = (media.serverProgress || [])
    .filter((progress) => progress.trackId === id && (!targetDevice || progress.deviceId === targetDevice))
    .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")))[0];
  return progressView(item, null);
}

function withTrackProgress(state, config, track) {
  if (!track?.id) {
    return track;
  }
  return {
    ...track,
    progress: latestProgressForTrack(state, config, track.id)
  };
}

function listMediaProgress(state, config, filter = {}) {
  const media = ensureMediaState(state);
  const deviceId = String(filter.deviceId || filter.device_id || "");
  const trackId = String(filter.trackId || filter.track_id || filter.id || "");
  const completedFilter = filter.completed === undefined ? null : Boolean(filter.completed === true || filter.completed === "true" || filter.completed === "1");
  const limit = Math.max(1, Math.min(Number(filter.limit || 100) || 100, 200));
  return (media.serverProgress || [])
    .filter((item) => !deviceId || item.deviceId === deviceId)
    .filter((item) => !trackId || item.trackId === trackId)
    .filter((item) => completedFilter === null || Boolean(item.completed) === completedFilter)
    .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")))
    .map((item) => progressView(item, findTrackById(state, config, item.trackId)))
    .filter(Boolean)
    .slice(0, limit);
}

function upsertMediaProgress(state, config, body = {}) {
  const media = ensureMediaState(state);
  const trackId = String(body.trackId || body.track_id || body.id || "").slice(0, 160);
  if (!trackId) {
    const error = new Error("trackId is required");
    error.statusCode = 400;
    throw error;
  }
  const deviceId = String(body.deviceId || body.device_id || "esp32").slice(0, 80);
  const existing = media.serverProgress.find((item) => item.trackId === trackId && item.deviceId === deviceId);
  const track = findTrackById(state, config, trackId);
  const item = existing || { trackId, deviceId };
  const durationSec = Math.max(0, Math.floor(Number(body.durationSec ?? body.duration_sec ?? existing?.durationSec ?? track?.durationSec ?? 0) || 0));
  const positionInput = body.positionSec ?? body.position_sec ?? existing?.positionSec ?? 0;
  let positionSec = Math.max(0, Math.floor(Number(positionInput) || 0));
  let completed = Boolean(body.completed) || (durationSec > 0 && positionSec >= Math.max(0, durationSec - 3));
  if (body.completed === false || body.completed === "false" || body.completed === 0 || body.completed === "0") {
    completed = false;
  }
  if (completed && durationSec > 0 && positionSec < durationSec) {
    positionSec = durationSec;
  }
  item.positionSec = positionSec;
  item.durationSec = durationSec;
  item.completed = completed;
  item.updatedAt = new Date().toISOString();
  if (!existing) {
    media.serverProgress.unshift(item);
  }
  media.serverProgress = media.serverProgress.slice(0, 120);
  return progressView(item, track);
}

function deleteMediaProgress(state, trackId, filter = {}) {
  const media = ensureMediaState(state);
  const id = String(trackId || "");
  const deviceId = String(filter.deviceId || filter.device_id || "");
  const before = media.serverProgress.length;
  media.serverProgress = media.serverProgress.filter((item) => item.trackId !== id || (deviceId && item.deviceId !== deviceId));
  return {
    trackId: id,
    deviceId,
    deleted: before - media.serverProgress.length,
    remaining: media.serverProgress.length
  };
}

function listResumeCandidates(state, config, filter = {}) {
  const media = ensureMediaState(state);
  const deviceId = String(filter.deviceId || filter.device_id || "");
  const limit = Math.max(1, Math.min(Number(filter.limit || 12) || 12, 40));
  return (media.serverProgress || [])
    .filter((item) => !deviceId || item.deviceId === deviceId)
    .filter((item) => !item.completed && Number(item.positionSec || 0) > 0)
    .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")))
    .map((item) => {
      const track = findTrackById(state, config, item.trackId);
      if (!track) {
        return null;
      }
      const progress = progressView(item, track);
      return {
        ...progress,
        track,
        title: track.title,
        artist: track.artist,
        source: track.source
      };
    })
    .filter(Boolean)
    .slice(0, limit);
}

function resolveResumeCandidate(state, config, body = {}) {
  const trackId = String(body.trackId || body.track_id || body.id || "");
  const deviceId = String(body.deviceId || body.device_id || "");
  const candidates = listResumeCandidates(state, config, { deviceId, limit: 40 });
  if (trackId) {
    return candidates.find((item) => item.trackId === trackId) ||
      listResumeCandidates(state, config, { limit: 40 }).find((item) => item.trackId === trackId) ||
      null;
  }
  return candidates[0] || listResumeCandidates(state, config, { limit: 1 })[0] || null;
}

function listMediaQueue(state) {
  const media = ensureMediaState(state);
  return {
    currentId: media.queue.currentId || "",
    updatedAt: media.queue.updatedAt || null,
    items: media.queue.items || []
  };
}

function addMediaQueueItem(state, config, body = {}) {
  const media = ensureMediaState(state);
  const track = body.track || findTrackById(state, config, body.trackId || body.track_id || body.id);
  const view = queueTrackView(track);
  if (!view?.id) {
    const error = new Error("queue track not found");
    error.statusCode = 404;
    throw error;
  }
  const now = new Date().toISOString();
  const item = {
    id: `queue_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`,
    trackId: view.id,
    feedId: view.feedId || "",
    title: view.title,
    artist: view.artist,
    source: view.source,
    status: "queued",
    addedAt: now,
    deviceId: String(body.deviceId || body.device_id || "esp32-185b").slice(0, 80),
    track: view
  };
  media.queue.items.push(item);
  media.queue.items = media.queue.items.slice(-120);
  media.queue.updatedAt = now;
  return item;
}

function removeMediaQueueItem(state, itemId) {
  const media = ensureMediaState(state);
  const id = String(itemId || "");
  const before = media.queue.items.length;
  media.queue.items = media.queue.items.filter((item) => item.id !== id);
  if (media.queue.items.length === before) {
    const error = new Error("queue item not found");
    error.statusCode = 404;
    throw error;
  }
  if (media.queue.currentId === id) {
    media.queue.currentId = "";
  }
  media.queue.updatedAt = new Date().toISOString();
  return listMediaQueue(state);
}

function clearMediaQueue(state, options = {}) {
  const media = ensureMediaState(state);
  const keepPlaying = Boolean(options.keepPlaying || options.keep_playing);
  if (keepPlaying && media.queue.currentId) {
    media.queue.items = media.queue.items.filter((item) => item.id === media.queue.currentId);
  } else {
    media.queue.items = [];
    media.queue.currentId = "";
  }
  media.queue.updatedAt = new Date().toISOString();
  return listMediaQueue(state);
}

function moveMediaQueueItem(state, itemId, direction = "up") {
  const media = ensureMediaState(state);
  const id = String(itemId || "");
  const index = media.queue.items.findIndex((item) => item.id === id);
  if (index < 0) {
    const error = new Error("queue item not found");
    error.statusCode = 404;
    throw error;
  }
  let target = index;
  if (direction === "top") {
    target = 0;
  } else if (direction === "bottom") {
    target = media.queue.items.length - 1;
  } else if (direction === "down") {
    target = Math.min(media.queue.items.length - 1, index + 1);
  } else {
    target = Math.max(0, index - 1);
  }
  if (target !== index) {
    const [item] = media.queue.items.splice(index, 1);
    media.queue.items.splice(target, 0, item);
  }
  media.queue.updatedAt = new Date().toISOString();
  return listMediaQueue(state);
}

function recordPlayback(state, track, source = "queue") {
  const media = ensureMediaState(state);
  const view = queueTrackView(track);
  if (!view?.id) {
    return null;
  }
  const item = {
    id: `play_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`,
    trackId: view.id,
    title: view.title,
    artist: view.artist,
    source: view.source || source,
    origin: view.origin,
    provider: view.provider,
    playedAt: new Date().toISOString(),
    track: view
  };
  media.playbackHistory.unshift(item);
  media.playbackHistory = media.playbackHistory.slice(0, 120);
  return item;
}

function playMediaQueueItem(state, config, body = {}) {
  const media = ensureMediaState(state);
  let item = null;
  const requestedItemId = String(body.itemId || body.queueId || body.id || "");
  const requestedTrackId = String(body.trackId || body.track_id || "");
  if (requestedItemId) {
    item = media.queue.items.find((candidate) => candidate.id === requestedItemId);
  }
  if (!item && requestedTrackId) {
    item = media.queue.items.find((candidate) => candidate.trackId === requestedTrackId);
  }
  if (!item && body.track) {
    item = addMediaQueueItem(state, config, body);
  }
  if (!item && media.queue.items.length > 0) {
    item = media.queue.items.find((candidate) => candidate.id === media.queue.currentId) || media.queue.items[0];
  }
  if (!item) {
    const error = new Error("media queue is empty");
    error.statusCode = 404;
    throw error;
  }
  const now = new Date().toISOString();
  for (const candidate of media.queue.items) {
    candidate.status = candidate.id === item.id ? "playing" : (candidate.status === "playing" ? "queued" : candidate.status);
  }
  item.status = "playing";
  item.startedAt = now;
  media.queue.currentId = item.id;
  media.queue.updatedAt = now;
  recordPlayback(state, item.track, "queue");
  return { item, track: item.track, queue: listMediaQueue(state) };
}

function nextMediaQueueItem(state, config, body = {}) {
  const media = ensureMediaState(state);
  if (media.queue.items.length === 0) {
    return null;
  }
  const currentIndex = Math.max(0, media.queue.items.findIndex((item) => item.id === media.queue.currentId));
  const nextIndex = (currentIndex + 1) % media.queue.items.length;
  return playMediaQueueItem(state, config, { ...body, itemId: media.queue.items[nextIndex].id });
}

function stopMediaQueue(state) {
  const media = ensureMediaState(state);
  for (const item of media.queue.items) {
    if (item.status === "playing") {
      item.status = "queued";
    }
  }
  media.queue.currentId = "";
  media.queue.updatedAt = new Date().toISOString();
  return listMediaQueue(state);
}

function listMediaFavorites(state) {
  return ensureMediaState(state).favorites || [];
}

function addMediaFavorite(state, config, body = {}) {
  const media = ensureMediaState(state);
  const track = body.track || findTrackById(state, config, body.trackId || body.track_id || body.id);
  const view = queueTrackView(track);
  if (!view?.id) {
    const error = new Error("favorite track not found");
    error.statusCode = 404;
    throw error;
  }
  const now = new Date().toISOString();
  media.favorites = media.favorites.filter((item) => item.trackId !== view.id);
  const item = {
    id: `fav_${view.id}`,
    trackId: view.id,
    title: view.title,
    artist: view.artist,
    source: view.source,
    createdAt: now,
    track: view
  };
  media.favorites.unshift(item);
  media.favorites = media.favorites.slice(0, 120);
  return item;
}

function deleteMediaFavorite(state, favoriteId) {
  const media = ensureMediaState(state);
  const id = String(favoriteId || "");
  const before = media.favorites.length;
  media.favorites = media.favorites.filter((item) => item.id !== id && item.trackId !== id);
  if (media.favorites.length === before) {
    const error = new Error("favorite not found");
    error.statusCode = 404;
    throw error;
  }
  return { id, deleted: true, count: media.favorites.length };
}

function searchQueueTracks(state, query, limit = 8) {
  const q = compactQuery(query);
  if (!q) {
    return [];
  }
  const terms = q.split(" ").filter(Boolean);
  return ensureMediaState(state).queue.items
    .map((item) => item.track)
    .filter(Boolean)
    .map((track) => ({
      track,
      score: terms.reduce((sum, term) => sum + (trackSearchHaystack(track).includes(term) ? 1 : 0), 0)
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.track.title.localeCompare(b.track.title))
    .slice(0, Math.max(1, limit))
    .map((item) => item.track);
}

function searchPodcastEpisodes(state, config, query, limit = 8) {
  const q = compactQuery(query);
  const tracks = listPodcastEpisodes(state, config, { query: q });
  if (!q) {
    return tracks.slice(0, Math.max(1, limit));
  }
  const terms = q.split(" ").filter(Boolean);
  return tracks
    .map((track) => ({
      track,
      score: terms.reduce((sum, term) => sum + (trackSearchHaystack(track).includes(term) ? 1 : 0), 0)
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.track.title.localeCompare(b.track.title))
    .slice(0, Math.max(1, limit))
    .map((item) => item.track);
}

function filterTracksForView(tracks, options = {}) {
  return filterProductionContent(tracks, { includeDiagnostics: includeDiagnosticsFlag(options.includeDiagnostics) });
}

function buildMediaLibrary(state, config, options = {}) {
  const media = ensureMediaState(state);
  const localTracks = filterTracksForView(listServerTracks(config), options).map((track) => withTrackProgress(state, config, track));
  const podcastEpisodes = listPodcastEpisodes(state, config).slice(0, 120).map((track) => withTrackProgress(state, config, track));
  const onlineTracks = listOnlineTracks(state, config).map((track) => withTrackProgress(state, config, track));
  const tracks = filterTracksForView(listKnownServerTracks(state, config), options).map((track) => withTrackProgress(state, config, track));
  const progress = listMediaProgress(state, config, { limit: 120 });
  const resumeCandidates = listResumeCandidates(state, config, { limit: 20 });
  return {
    tracks,
    localTracks,
    podcastFeeds: listPodcastFeeds(state),
    podcastEpisodes,
    onlineTracks,
    onlineCatalog: listOnlineCatalog(config),
    queue: listMediaQueue(state),
    resumeCandidates,
    favorites: listMediaFavorites(state),
    playbackHistory: media.playbackHistory || [],
    progress,
    searchHistory: media.searchHistory || [],
    counts: {
      local: localTracks.length,
      podcastFeeds: media.podcastFeeds.length,
      podcastEpisodes: media.podcastEpisodes.length,
      online: onlineTracks.length,
      catalog: listOnlineCatalog(config).length,
      queue: media.queue.items.length,
      resume: resumeCandidates.length,
      progress: progress.length,
      completed: progress.filter((item) => item.completed).length,
      favorites: media.favorites.length
    }
  };
}

function readOnlineCatalog(config) {
  const filePath = config.onlineMediaCatalogFile;
  if (!filePath || !fs.existsSync(filePath)) {
    return [];
  }
  try {
    const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return Array.isArray(data) ? data : (Array.isArray(data.tracks) ? data.tracks : []);
  } catch (error) {
    return [];
  }
}

function safeId(value, fallback = "online") {
  return String(value || fallback)
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80) || fallback;
}

function writeOnlineCatalog(config, tracks) {
  const filePath = config.onlineMediaCatalogFile;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify({ tracks }, null, 2)}\n`);
}

function listOnlineCatalog(config) {
  return readOnlineCatalog(config).map((item) => ({
    id: safeId(item.id || `catalog-${crypto.createHash("sha256").update(String(item.remoteUrl || item.url || "")).digest("hex").slice(0, 12)}`),
    title: String(item.title || "网络音频").slice(0, 120),
    artist: String(item.artist || item.author || "Online Audio").slice(0, 120),
    remoteUrl: String(item.remoteUrl || item.url || item.streamUrl || "").slice(0, 600),
    contentType: String(item.contentType || "").slice(0, 80),
    format: String(item.format || "").slice(0, 20),
    provider: String(item.provider || "catalog").slice(0, 40),
    source: String(item.source || "网络曲库").slice(0, 80),
    tags: Array.isArray(item.tags) ? item.tags.slice(0, 8) : [],
    createdAt: item.createdAt || null,
    updatedAt: item.updatedAt || null
  }));
}

function upsertOnlineCatalogTrack(config, body = {}) {
  const remoteUrl = String(body.remoteUrl || body.url || body.streamUrl || "").trim();
  const safeUrl = safeRemoteMediaUrl(remoteUrl, config);
  if (!safeUrl || !isLikelyAudioUrl(safeUrl.href, body.contentType)) {
    const error = new Error("online media url must be a safe MP3/Ogg/Opus URL");
    error.statusCode = 400;
    throw error;
  }
  const now = new Date().toISOString();
  const id = safeId(body.id || `catalog-${crypto.createHash("sha256").update(safeUrl.href).digest("hex").slice(0, 16)}`);
  const catalog = listOnlineCatalog(config).filter((item) => item.id !== id);
  const item = {
    id,
    title: String(body.title || titleFromFile(safeUrl.pathname) || "网络音频").slice(0, 120),
    artist: String(body.artist || body.author || safeUrl.hostname).slice(0, 120),
    remoteUrl: safeUrl.href,
    contentType: String(body.contentType || audioContentType(safeUrl.pathname)).slice(0, 80),
    format: String(body.format || formatFromUrl(safeUrl.href, body.contentType)).slice(0, 20),
    provider: "catalog",
    source: String(body.source || "网络曲库").slice(0, 80),
    tags: Array.isArray(body.tags) ? body.tags.slice(0, 8) : [],
    createdAt: body.createdAt || now,
    updatedAt: now
  };
  catalog.unshift(item);
  writeOnlineCatalog(config, catalog.slice(0, 200));
  return item;
}

function deleteOnlineCatalogTrack(config, id) {
  const catalog = listOnlineCatalog(config);
  const next = catalog.filter((item) => item.id !== id);
  writeOnlineCatalog(config, next);
  return { deleted: next.length !== catalog.length, count: next.length };
}

function parseRssItems(xml, feedUrl) {
  const items = [];
  const itemBlocks = String(xml || "").match(/<item\b[\s\S]*?<\/item>/gi) || [];
  for (const block of itemBlocks) {
    const enclosure = /<enclosure\b[^>]*url=["']([^"']+)["'][^>]*>/i.exec(block);
    const mediaContent = /<media:content\b[^>]*url=["']([^"']+)["'][^>]*>/i.exec(block);
    const url = decodeEntities(enclosure?.[1] || mediaContent?.[1] || "");
    if (!url) {
      continue;
    }
    const type = /type=["']([^"']+)["']/i.exec(enclosure?.[0] || mediaContent?.[0] || "")?.[1] || "";
    const length = /length=["']([^"']+)["']/i.exec(enclosure?.[0] || mediaContent?.[0] || "")?.[1] || 0;
    const title = decodeEntities(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(block)?.[1] || titleFromFile(url));
    const author = decodeEntities(/<(?:itunes:author|author)[^>]*>([\s\S]*?)<\/(?:itunes:author|author)>/i.exec(block)?.[1] || "Podcast");
    items.push({
      title,
      artist: author,
      remoteUrl: url,
      contentType: type,
      size: Number(length) || 0,
      provider: "rss",
      source: "网络播客",
      feedUrl
    });
  }
  return items;
}

async function fetchText(url, timeoutMs) {
  const { controller, timeout } = abortSignal(timeoutMs);
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "xiaozhi-family-hub/0.2" },
      signal: controller.signal
    });
    if (!response.ok) {
      return "";
    }
    return await response.text();
  } catch (error) {
    return "";
  } finally {
    clearTimeout(timeout);
  }
}

async function resolveDirectUrl(config, query) {
  if (!config.onlineMediaAllowDirectUrls) {
    return [];
  }
  const rawUrl = extractFirstUrl(query);
  const safeUrl = safeRemoteMediaUrl(rawUrl, config);
  if (!safeUrl) {
    return [];
  }
  let contentType = "";
  let size = 0;
  if (!isLikelyAudioUrl(safeUrl.href)) {
    const { controller, timeout } = abortSignal(config.onlineMediaTimeoutMs);
    try {
      const response = await fetch(safeUrl.href, {
        method: "HEAD",
        headers: { "User-Agent": "xiaozhi-family-hub/0.2" },
        signal: controller.signal
      });
      contentType = response.headers.get("content-type") || "";
      size = Number(response.headers.get("content-length") || 0) || 0;
    } catch (error) {
      return [];
    } finally {
      clearTimeout(timeout);
    }
  }
  if (!isLikelyAudioUrl(safeUrl.href, contentType)) {
    return [];
  }
  return [{
    title: titleFromFile(safeUrl.pathname) || "网络音频",
    artist: safeUrl.hostname,
    remoteUrl: safeUrl.href,
    contentType: contentType || audioContentType(safeUrl.pathname),
    size,
    provider: "direct",
    source: "网络直链"
  }];
}

async function searchRssFeeds(config, query) {
  const q = compactQuery(query);
  const feeds = config.onlineMediaFeeds || [];
  if (!q || feeds.length === 0) {
    return [];
  }
  const terms = q.split(" ").filter(Boolean);
  const results = [];
  for (const feedUrl of feeds.slice(0, 8)) {
    const safeFeedUrl = safeRemoteMediaUrl(feedUrl, config);
    if (!safeFeedUrl) {
      continue;
    }
    const xml = await fetchText(safeFeedUrl.href, config.onlineMediaTimeoutMs);
    const items = parseRssItems(xml, safeFeedUrl.href);
    for (const item of items) {
      if (!safeRemoteMediaUrl(item.remoteUrl, config) || !isLikelyAudioUrl(item.remoteUrl, item.contentType)) {
        continue;
      }
      const haystack = trackSearchHaystack(item);
      const score = terms.reduce((sum, term) => sum + (haystack.includes(term) ? 1 : 0), 0);
      if (score > 0) {
        results.push({ ...item, score });
      }
    }
  }
  return results
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
    .slice(0, config.onlineMediaMaxResults || 6);
}

async function searchArchive(config, query) {
  const q = compactQuery(query);
  if (!q) {
    return [];
  }
  const searchUrl = new URL("https://archive.org/advancedsearch.php");
  searchUrl.searchParams.set("q", `mediatype:audio AND (${q})`);
  searchUrl.searchParams.append("fl[]", "identifier");
  searchUrl.searchParams.append("fl[]", "title");
  searchUrl.searchParams.set("rows", String(Math.max(1, Math.min(config.onlineMediaMaxResults || 6, 10))));
  searchUrl.searchParams.set("page", "1");
  searchUrl.searchParams.set("output", "json");
  const text = await fetchText(searchUrl.href, config.onlineMediaTimeoutMs);
  let payload = null;
  try {
    payload = JSON.parse(text);
  } catch (error) {
    return [];
  }
  const docs = payload?.response?.docs || [];
  const tracks = [];
  for (const doc of docs) {
    const identifier = String(doc.identifier || "").replace(/[^a-zA-Z0-9._-]/g, "");
    if (!identifier) {
      continue;
    }
    const metaText = await fetchText(`https://archive.org/metadata/${identifier}`, config.onlineMediaTimeoutMs);
    let meta = null;
    try {
      meta = JSON.parse(metaText);
    } catch (error) {
      continue;
    }
    const file = (meta.files || []).find((item) => isSupportedAudio(item.name || "") || isAudioContentType(item.format || ""));
    if (!file?.name) {
      continue;
    }
    const remoteUrl = `https://archive.org/download/${identifier}/${encodeURI(file.name)}`;
    tracks.push({
      title: String(doc.title || meta.metadata?.title || titleFromFile(file.name)),
      artist: String(meta.metadata?.creator || "Internet Archive"),
      remoteUrl,
      contentType: audioContentType(file.name),
      size: Number(file.size || 0) || 0,
      provider: "archive",
      source: "公共音频库"
    });
  }
  return tracks;
}

async function searchOnlineMedia(config, query) {
  const providers = new Set((config.onlineMediaProviders || []).map((item) => String(item).toLowerCase()));
  const results = [];
  if (providers.has("direct")) {
    results.push(...await resolveDirectUrl(config, query));
  }
  for (const item of readOnlineCatalog(config)) {
    const haystack = trackSearchHaystack(item);
    const q = compactQuery(query);
    if (!q || q.split(" ").some((term) => haystack.includes(term))) {
      results.push({ ...item, provider: item.provider || "catalog", source: item.source || "网络曲库" });
    }
  }
  if (providers.has("rss")) {
    results.push(...await searchRssFeeds(config, query));
  }
  if (providers.has("archive")) {
    results.push(...await searchArchive(config, query));
  }
  const seen = new Set();
  return results
    .filter((track) => {
      const safeUrl = safeRemoteMediaUrl(track.remoteUrl || track.url || track.streamUrl, config);
      if (!safeUrl || seen.has(safeUrl.href) || !isLikelyAudioUrl(safeUrl.href, track.contentType)) {
        return false;
      }
      seen.add(safeUrl.href);
      track.remoteUrl = safeUrl.href;
      return true;
    })
    .slice(0, Math.max(1, config.onlineMediaMaxResults || 6));
}

async function resolveMediaSearch(config, query, state = null) {
  const local = searchLocalTracks(config, query, config.onlineMediaMaxResults || 6);
  if (local.length > 0) {
    return { source: "local", query: compactQuery(query), tracks: local };
  }
  if (state) {
    const queue = searchQueueTracks(state, query, config.onlineMediaMaxResults || 6);
    if (queue.length > 0) {
      return { source: "queue", query: compactQuery(query), tracks: queue };
    }
    const podcast = searchPodcastEpisodes(state, config, query, config.onlineMediaMaxResults || 6);
    if (podcast.length > 0) {
      return { source: "podcast", query: compactQuery(query), tracks: podcast };
    }
  }
  const online = await searchOnlineMedia(config, query);
  return { source: online.length > 0 ? "online" : "none", query: compactQuery(query), tracks: online };
}

function serverTrackFile(config, id) {
  const root = path.resolve(config.serverMusicDir);
  const relative = decodeTrackId(id);
  if (!relative || relative.includes("..") || path.isAbsolute(relative) || !isSupportedAudio(relative)) {
    return "";
  }
  const fullPath = path.resolve(root, relative);
  if (!fullPath.startsWith(root + path.sep) || !fs.existsSync(fullPath)) {
    return "";
  }
  return fullPath;
}

function safeMediaFileName(value, fallback = "track") {
  return String(value || fallback)
    .replace(/[^\w.\-() \u4e00-\u9fa5]+/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120) || fallback;
}

function deleteServerTrack(config, id) {
  const filePath = serverTrackFile(config, id);
  if (!filePath) {
    const error = new Error("server media track not found");
    error.statusCode = 404;
    throw error;
  }
  fs.unlinkSync(filePath);
  return {
    id,
    path: path.relative(path.resolve(config.serverMusicDir), filePath).replace(/\\/g, "/"),
    deleted: true
  };
}

function renameServerTrack(config, id, title) {
  const filePath = serverTrackFile(config, id);
  if (!filePath) {
    const error = new Error("server media track not found");
    error.statusCode = 404;
    throw error;
  }
  const ext = path.extname(filePath).toLowerCase();
  const dir = path.dirname(filePath);
  const nextName = `${safeMediaFileName(title, path.basename(filePath, ext))}${ext}`;
  const nextPath = path.join(dir, nextName);
  const root = path.resolve(config.serverMusicDir);
  if (!nextPath.startsWith(root + path.sep)) {
    const error = new Error("invalid media destination");
    error.statusCode = 400;
    throw error;
  }
  if (nextPath !== filePath && fs.existsSync(nextPath)) {
    const error = new Error("media destination already exists");
    error.statusCode = 409;
    throw error;
  }
  fs.renameSync(filePath, nextPath);
  const relative = path.relative(root, nextPath).replace(/\\/g, "/");
  return listServerTracks(config).find((track) => track.path === relative) || {
    id: encodeTrackId(relative),
    path: relative,
    title: titleFromFile(nextName)
  };
}

async function proxyRemoteAudio(res, track, reqHeaders = {}, config = {}) {
  const safeUrl = safeRemoteMediaUrl(track?.remoteUrl, config);
  if (!safeUrl) {
    const error = new Error("remote media url rejected");
    error.statusCode = 400;
    throw error;
  }
  const { controller, timeout } = abortSignal(config.onlineMediaTimeoutMs || 4500);
  const headers = {
    "User-Agent": "xiaozhi-family-hub/0.2",
    Accept: track.contentType || "audio/*"
  };
  if (reqHeaders.range) {
    headers.Range = reqHeaders.range;
  }
  const response = await fetch(safeUrl.href, { headers, signal: controller.signal });
  clearTimeout(timeout);
  if (!response.ok && response.status !== 206) {
    const error = new Error(`remote media fetch failed: ${response.status}`);
    error.statusCode = response.status || 502;
    throw error;
  }
  res.status(response.status);
  res.setHeader("Accept-Ranges", response.headers.get("accept-ranges") || "bytes");
  res.setHeader("Cache-Control", "public, max-age=60");
  const contentType = response.headers.get("content-type") || track.contentType || "audio/mpeg";
  res.setHeader("Content-Type", contentType);
  for (const header of ["content-length", "content-range"]) {
    const value = response.headers.get(header);
    if (value) {
      res.setHeader(header, value);
    }
  }
  await new Promise((resolve, reject) => {
    Readable.fromWeb(response.body).on("error", reject).on("end", resolve).pipe(res);
  });
}

module.exports = {
  addMediaFavorite,
  addMediaQueueItem,
  applyPodcastFeedRefresh,
  audioContentType,
  audioDurationSec,
  mp3DurationSec,
  buildMediaLibrary,
  filterTracksForView,
  clearMediaQueue,
  compactQuery,
  deleteMediaProgress,
  deviceMediaBase,
  toDeviceMediaUrl,
  toDeviceTrack,
  ensureServerMediaLibrary,
  deleteMediaFavorite,
  findOnlineTrack,
  fetchPodcastFeed,
  listMediaFavorites,
  listMediaQueue,
  listKnownServerTracks,
  listOnlineCatalog,
  listOnlineTracks,
  listPodcastEpisodes,
  listPodcastFeeds,
  listMediaProgress,
  listResumeCandidates,
  listServerTracks,
  markPodcastFeedRefreshError,
  moveMediaQueueItem,
  nextMediaQueueItem,
  playMediaQueueItem,
  proxyRemoteAudio,
  registerOnlineTrack,
  refreshPodcastFeeds,
  removeMediaQueueItem,
  resolveMediaSearch,
  resolveResumeCandidate,
  searchLocalTracks,
  searchOnlineMedia,
  stopMediaQueue,
  deleteOnlineCatalogTrack,
  deleteServerTrack,
  deletePodcastFeed,
  renameServerTrack,
  upsertPodcastFeed,
  upsertOnlineCatalogTrack,
  upsertMediaProgress,
  serverTrackFile
};

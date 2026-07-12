const fs = require("fs");
const crypto = require("crypto");
const path = require("path");

const { filterProductionContent, includeDiagnosticsFlag, looksLikeRepresentativeContent, validateContentImport } = require("./content-policy");
const { writeResourceFile } = require("./resources");

function nowIso() {
  return new Date().toISOString();
}

function safeId(value, fallback = "item") {
  const text = String(value || fallback).replace(/[^a-zA-Z0-9._-]/g, "-").replace(/-+/g, "-").slice(0, 48);
  return text || fallback;
}

function ensureContentState(state) {
  state.content = state.content || {};
  state.content.catalog = Array.isArray(state.content.catalog) ? state.content.catalog : [];
  state.content.packs = Array.isArray(state.content.packs) ? state.content.packs : [];
  state.content.recommendations = Array.isArray(state.content.recommendations) ? state.content.recommendations : [];
  state.content.lastSeedAt = state.content.lastSeedAt || null;
  state.content.lastImportAt = state.content.lastImportAt || null;
}

function upsertPack(state, pack) {
  ensureContentState(state);
  const id = safeId(pack.id, "pack");
  const existing = state.content.packs.find((item) => item.id === id);
  const next = {
    id,
    type: pack.type || "generic",
    title: pack.title || id,
    version: Number(pack.version || 1),
    description: pack.description || "",
    sourceKind: pack.sourceKind || (looksLikeRepresentativeContent(pack) ? "diagnostic" : "real"),
    namespace: pack.namespace || "",
    manifestVersion: Number(pack.manifestVersion || 1),
    source: pack.source && typeof pack.source === "object" ? pack.source : { kind: "family-owned" },
    license: pack.license || "private-family-use",
    files: Array.isArray(pack.files) ? pack.files.slice(0, 64) : [],
    createdAt: pack.createdAt || nowIso(),
    updatedAt: nowIso()
  };
  if (existing) {
    Object.assign(existing, next, { createdAt: existing.createdAt || next.createdAt });
    return existing;
  }
  state.content.packs.unshift(next);
  state.content.packs = state.content.packs.slice(0, 80);
  return next;
}

function upsertCatalogItem(state, item) {
  ensureContentState(state);
  const id = safeId(item.id, "content");
  const existing = state.content.catalog.find((entry) => entry.id === id);
  const next = {
    id,
    type: item.type || "generic",
    title: item.title || id,
    subtitle: item.subtitle || "",
    tags: Array.isArray(item.tags) ? item.tags.slice(0, 8) : [],
    ageRange: item.ageRange || item.age || "family",
    language: item.language || "zh-CN",
    durationSec: Number(item.durationSec || item.duration || 0),
    cover: item.cover || "",
    assetRole: item.assetRole || (String(item.path || "").toLowerCase().endsWith(".json") ? "lesson" : "media"),
    lessonId: item.lessonId || "",
    path: item.path || "",
    packId: safeId(item.packId || item.pack || "family-base", "family-base"),
    sourceKind: item.sourceKind || (looksLikeRepresentativeContent(item) ? "diagnostic" : "real"),
    namespace: item.namespace || "",
    version: Number(item.version || 1),
    fileSha256: item.fileSha256 || "",
    contentType: item.contentType || "",
    size: Number(item.size || 0),
    entry: item.entry || "",
    createdAt: item.createdAt || nowIso(),
    updatedAt: nowIso()
  };
  if (existing) {
    Object.assign(existing, next, { createdAt: existing.createdAt || next.createdAt });
    return existing;
  }
  state.content.catalog.unshift(next);
  state.content.catalog = state.content.catalog.slice(0, 200);
  return next;
}

function rawRgb565Placeholder(width = 192, height = 104) {
  const buffer = Buffer.alloc(width * height * 2);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const r = Math.floor((x / Math.max(width - 1, 1)) * 31);
      const g = Math.floor((y / Math.max(height - 1, 1)) * 63);
      const b = Math.floor(((x + y) / Math.max(width + height - 2, 1)) * 31);
      const rgb565 = (r << 11) | (g << 5) | b;
      const offset = (y * width + x) * 2;
      buffer[offset] = rgb565 & 0xff;
      buffer[offset + 1] = rgb565 >> 8;
    }
  }
  return buffer;
}

function writeJsonResource(config, relativePath, value) {
  return writeResourceFile(config, relativePath, Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8"));
}

function seedContent(state, config) {
  ensureContentState(state);
  const seededAt = nowIso();
  const packs = [
    { id: "family-album-sample", type: "album", title: "家庭相册示例", description: "圆屏屏保占位图" },
    { id: "english-daily-sample", type: "course", title: "Daily English 示例", description: "英语口语练习种子内容" },
    { id: "family-podcast-sample", type: "podcast", title: "Family Podcast 示例", description: "服务器播客种子内容" },
    { id: "story-sample", type: "story", title: "睡前故事示例", description: "故事内容种子" },
    { id: "game-sample", type: "game", title: "小游戏示例", description: "小游戏元数据" }
  ].map((pack) => upsertPack(state, { ...pack, version: 1, sourceKind: "sample", namespace: "sample" }));

  const album = writeResourceFile(config, "images/family-sample.rgb565.bin", rawRgb565Placeholder());
  const english = writeJsonResource(config, "courses/english/daily-talk.json", {
    title: "Daily Talk",
    prompt: "Tell Xiaozhi one thing you did today.",
    phrases: ["I played today.", "I helped my family.", "I learned a new word."],
    level: "beginner"
  });
  const story = writeJsonResource(config, "courses/stories/bedtime-star.json", {
    title: "Bedtime Star",
    language: "zh-CN",
    paragraphs: ["今晚的小星星在窗边等你。", "它说，今天也要好好休息。"]
  });
  const game = writeJsonResource(config, "games/focus-tap.json", {
    title: "Focus Tap",
    type: "reaction",
    description: "点击练习小游戏元数据"
  });

  const serverOgg = path.join(config.serverMusicDir, "sample-success.ogg");
  const podcastPath = fs.existsSync(serverOgg) ? "music/server/sample-success.ogg" : "";

  const items = [
    {
      id: "album-family-sample",
      type: "album",
      title: "家庭相册示例",
      subtitle: "SD 屏保占位图",
      tags: ["family", "screensaver"],
      cover: album.path,
      path: album.path,
      packId: "family-album-sample"
    },
    {
      id: "english-daily-talk",
      type: "english",
      title: "Daily Talk",
      subtitle: "今日口语练习",
      tags: ["english", "kids"],
      language: "en-US",
      durationSec: 180,
      path: english.path,
      packId: "english-daily-sample"
    },
    {
      id: "podcast-family-sample",
      type: "podcast",
      title: "sample success",
      subtitle: "服务器播客示例",
      tags: ["podcast", "family"],
      durationSec: 10,
      path: podcastPath,
      packId: "family-podcast-sample"
    },
    {
      id: "story-bedtime-star",
      type: "story",
      title: "Bedtime Star",
      subtitle: "睡前故事",
      tags: ["story", "bedtime"],
      language: "zh-CN",
      path: story.path,
      packId: "story-sample"
    },
    {
      id: "game-focus-tap",
      type: "game",
      title: "Focus Tap",
      subtitle: "反应练习",
      tags: ["game", "local"],
      path: game.path,
      packId: "game-sample"
    }
  ].map((item) => upsertCatalogItem(state, { ...item, sourceKind: "sample", namespace: "sample", version: Date.now() }));

  state.content.lastSeedAt = seededAt;
  state.content.lastImportAt = seededAt;
  return { packs, items, seededAt };
}

function importContent(state, config, body) {
  ensureContentState(state);
  const item = body?.item || body || {};
  const validated = validateContentImport(body);
  const pack = body?.pack || {
    id: item.packId || "manual-import",
    type: item.type || "generic",
    title: item.packTitle || "手动导入"
  };
  const savedPack = upsertPack(state, {
    ...pack,
    manifestVersion: pack.manifestVersion || 1,
    source: pack.source || { kind: "family-owned" },
    license: pack.license || "private-family-use"
  });
  const incomingSha256 = crypto.createHash("sha256").update(validated.buffer).digest("hex");
  const duplicate = state.content.catalog.find((entry) => entry.fileSha256 && entry.fileSha256 === incomingSha256);
  if (duplicate) {
    const error = new Error(`duplicate content file already exists as ${duplicate.id}`);
    error.statusCode = 409;
    throw error;
  }
  const targetPath = path.resolve(config.resourceDir, validated.relativePath);
  if (fs.existsSync(targetPath)) {
    const error = new Error(`content path already exists: ${validated.relativePath}`);
    error.statusCode = 409;
    throw error;
  }
  const file = writeResourceFile(config, validated.relativePath, validated.buffer);
  const fileRecord = {
    path: file.path,
    sha256: file.sha256,
    size: file.size,
    entry: item.entry || validated.parsed?.entry || "",
    contentType: file.contentType,
    version: file.version
  };
  savedPack.files = [...(savedPack.files || []).filter((entry) => entry.path !== file.path), fileRecord].slice(-64);
  const savedItem = upsertCatalogItem(state, {
    ...item,
    sourceKind: item.sourceKind || (looksLikeRepresentativeContent({ ...item, path: body?.path }) ? "diagnostic" : "real"),
    path: file.path,
    fileSha256: file.sha256,
    contentType: file.contentType,
    size: file.size,
    packId: savedPack.id
  });
  state.content.lastImportAt = nowIso();
  return { pack: savedPack, item: savedItem, file };
}

function catalogView(state, type = "", options = {}) {
  ensureContentState(state);
  const wanted = String(type || "").trim();
  const includeDiagnostics = includeDiagnosticsFlag(options.includeDiagnostics);
  const sourceCatalog = filterProductionContent(state.content.catalog, { includeDiagnostics });
  const sourcePacks = includeDiagnostics
    ? state.content.packs
    : state.content.packs.filter((pack) => !looksLikeRepresentativeContent(pack));
  const catalog = wanted ? sourceCatalog.filter((item) => item.type === wanted) : sourceCatalog;
  return {
    catalog,
    packs: sourcePacks,
    lastSeedAt: state.content.lastSeedAt,
    lastImportAt: state.content.lastImportAt
  };
}

function memberPreferenceTags(state, memberId) {
  const items = Array.isArray(state.memory?.items) ? state.memory.items : [];
  const tags = new Set();
  for (const memory of items) {
    if (memory.deletedAt) {
      continue;
    }
    if (memberId && memberId !== "device" && memory.memberId && memory.memberId !== memberId && memory.visibility !== "family") {
      continue;
    }
    for (const tag of Array.isArray(memory.tags) ? memory.tags : []) {
      const clean = String(tag || "").trim().toLowerCase();
      if (clean) {
        tags.add(clean);
      }
    }
  }
  return tags;
}

function scoreCatalogItem(item, preferenceTags) {
  if (!preferenceTags.size) {
    return 0;
  }
  const itemTags = Array.isArray(item.tags) ? item.tags : [];
  let score = 0;
  for (const tag of itemTags) {
    if (preferenceTags.has(String(tag || "").trim().toLowerCase())) {
      score += 1;
    }
  }
  return score;
}

function recommendContent(state, params = {}) {
  ensureContentState(state);
  const type = String(params.type || "").trim();
  const memberId = params.memberId || params.member || "device";
  const pool = type ? state.content.catalog.filter((item) => item.type === type) : state.content.catalog;

  // Prefer items the member has not been recommended recently, so repeated
  // asks surface variety instead of always returning the first catalog entry.
  const recentIds = new Set(
    state.content.recommendations
      .filter((rec) => rec.memberId === memberId)
      .slice(0, 10)
      .map((rec) => rec.itemId)
      .filter(Boolean)
  );
  const preferenceTags = memberPreferenceTags(state, memberId);

  const ranked = pool
    .map((item, index) => ({
      item,
      index,
      fresh: recentIds.has(item.id) ? 0 : 1,
      score: scoreCatalogItem(item, preferenceTags)
    }))
    .sort((a, b) => {
      if (a.fresh !== b.fresh) {
        return b.fresh - a.fresh;
      }
      if (a.score !== b.score) {
        return b.score - a.score;
      }
      return a.index - b.index;
    });

  // If every candidate was recently recommended, fall back to the best-scored
  // one rather than returning nothing.
  const item = ranked[0]?.item || pool[0] || state.content.catalog[0] || null;
  const matchedScore = item ? scoreCatalogItem(item, preferenceTags) : 0;
  const reason = item
    ? matchedScore > 0
      ? `根据偏好推荐 ${item.title}`
      : `推荐 ${item.title}`
    : "内容库为空";
  const recommendation = {
    id: `rec_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`,
    at: nowIso(),
    memberId,
    type: type || item?.type || "any",
    itemId: item?.id || "",
    title: item?.title || "暂无内容",
    matchedTags: matchedScore,
    reason
  };
  state.content.recommendations.unshift(recommendation);
  state.content.recommendations = state.content.recommendations.slice(0, 50);
  return recommendation;
}

module.exports = {
  catalogView,
  ensureContentState,
  importContent,
  recommendContent,
  seedContent
};

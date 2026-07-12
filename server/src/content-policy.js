const REPRESENTATIVE_CONTENT_RE = /\b(sample|smoke|representative|test|demo|diagnostic|placeholder|dummy|mock|fixture)\b|示例|占位|测试|诊断/i;
const CONTENT_RULES = {
  album: { dirs: ["images/"], extensions: [".jpg", ".jpeg", ".png", ".bin"] },
  podcast: { dirs: ["music/server/"], extensions: [".mp3", ".ogg", ".opus"] },
  english: { dirs: ["courses/english/"], extensions: [".json", ".mp3", ".ogg", ".opus", ".jpg", ".jpeg", ".png"] },
  game: { dirs: ["games/"], extensions: [".json", ".mp3", ".ogg", ".opus", ".jpg", ".jpeg", ".png"] },
  story: { dirs: ["courses/stories/"], extensions: [".json", ".mp3", ".ogg", ".opus"] }
};

function contentHaystack(item = {}) {
  return [
    item.id,
    item.title,
    item.subtitle,
    item.path,
    item.packId,
    item.sourceKind,
    item.namespace,
    ...(Array.isArray(item.tags) ? item.tags : [])
  ].filter(Boolean).join(" ").toLowerCase();
}

function looksLikeRepresentativeContent(item = {}) {
  const sourceKind = String(item.sourceKind || "").toLowerCase();
  if (["sample", "diagnostic", "demo", "test", "mock", "placeholder"].includes(sourceKind)) {
    return true;
  }
  return REPRESENTATIVE_CONTENT_RE.test(contentHaystack(item));
}

function isProductionContent(item = {}) {
  return !looksLikeRepresentativeContent(item);
}

function filterProductionContent(items = [], options = {}) {
  const list = Array.isArray(items) ? items : [];
  if (options.includeDiagnostics) {
    return list;
  }
  return list.filter(isProductionContent);
}

function includeDiagnosticsFlag(value) {
  return value === true || value === "1" || value === "true" || value === "yes";
}

function importError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function validateJsonContent(type, buffer) {
  if (!buffer || !["english", "game"].includes(type)) return null;
  let value;
  try {
    value = JSON.parse(buffer.toString("utf8"));
  } catch (error) {
    throw importError(`${type} content must be valid JSON`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value) || !String(value.title || "").trim()) {
    throw importError(`${type} content requires a title`);
  }
  if (type === "english" && !Array.isArray(value.lessons) && !Array.isArray(value.phrases) && !value.prompt) {
    throw importError("english content requires lessons, phrases, or prompt");
  }
  if (type === "game" && !Array.isArray(value.levels) && !Array.isArray(value.questions) && !value.type) {
    throw importError("game content requires levels, questions, or type");
  }
  return value;
}

function validateMediaSignature(relativePath, buffer) {
  const lower = relativePath.toLowerCase();
  const starts = (...bytes) => bytes.every((byte, index) => buffer[index] === byte);
  if (lower.endsWith(".mp3")) {
    const id3 = buffer.subarray(0, 3).toString("ascii") === "ID3";
    const frame = buffer.length >= 2 && buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0;
    if (!id3 && !frame) throw importError("MP3 content has an invalid header");
  } else if (lower.endsWith(".ogg") || lower.endsWith(".opus")) {
    if (buffer.subarray(0, 4).toString("ascii") !== "OggS") throw importError("Ogg/Opus content has an invalid header");
  } else if (lower.endsWith(".png")) {
    if (!starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) throw importError("PNG content has an invalid header");
  } else if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) {
    if (!starts(0xff, 0xd8, 0xff)) throw importError("JPEG content has an invalid header");
  }
}

function validateContentImport(body = {}) {
  const item = body.item || body;
  const type = String(item.type || "").trim();
  const rule = CONTENT_RULES[type];
  if (!rule) throw importError(`unsupported content type: ${type || "empty"}`);
  const relativePath = String(body.path || item.path || "").replace(/\\/g, "/");
  if (!relativePath || relativePath.startsWith("/") || relativePath.split("/").includes("..")) {
    throw importError("content path must be a safe relative path");
  }
  const lower = relativePath.toLowerCase();
  if (!rule.dirs.some((dir) => lower.startsWith(dir)) || !rule.extensions.some((ext) => lower.endsWith(ext))) {
    throw importError(`${type} content path or extension is not allowed`);
  }
  const encoded = body.contentBase64 || body.base64 || "";
  if (!encoded) throw importError("contentBase64 is required");
  const buffer = Buffer.from(String(encoded), "base64");
  if (!buffer.length) throw importError("content file is empty");
  if (buffer.length > 5 * 1024 * 1024) throw importError("content file is larger than 5MB", 413);
  const parsed = lower.endsWith(".json") ? validateJsonContent(type, buffer) : null;
  validateMediaSignature(relativePath, buffer);
  return { type, relativePath, buffer, parsed };
}

module.exports = {
  CONTENT_RULES,
  filterProductionContent,
  includeDiagnosticsFlag,
  isProductionContent,
  looksLikeRepresentativeContent,
  validateContentImport,
  validateJsonContent
};

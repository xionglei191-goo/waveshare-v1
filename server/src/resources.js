const fs = require("fs");
const crypto = require("crypto");
const path = require("path");

const DEFAULT_LAYOUT = [
  "icons",
  "images",
  "animations",
  "fonts",
  "music/local",
  "music/server",
  "music/cache",
  "courses/english",
  "courses/math",
  "courses/stories",
  "games",
  "cache",
  "logs",
  "outbox"
];

function safeRelative(input) {
  const relative = String(input || "").replace(/\\/g, "/");
  if (!relative || relative.includes("..") || path.isAbsolute(relative)) {
    return "";
  }
  return relative;
}

function contentTypeFor(filePath) {
  switch (path.extname(filePath).toLowerCase()) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".ogg":
    case ".opus":
      return "audio/ogg";
    case ".mp3":
      return "audio/mpeg";
    case ".bin":
      return "application/octet-stream";
    case ".json":
      return "application/json";
    default:
      return "application/octet-stream";
  }
}

function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

function sha256Buffer(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function ensureResourceLayout(config) {
  for (const dir of DEFAULT_LAYOUT) {
    fs.mkdirSync(path.join(config.resourceDir, dir), { recursive: true });
  }
}

function listResourceFiles(rootDir, dir) {
  const base = path.join(rootDir, dir);
  if (!fs.existsSync(base)) {
    return [];
  }
  const files = [];
  const walk = (currentDir) => {
    if (files.length >= 64) {
      return;
    }
    for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        const stat = fs.statSync(fullPath);
        const relative = path.relative(rootDir, fullPath).replace(/\\/g, "/");
        files.push({
          path: relative,
          size: stat.size,
          sha256: sha256File(fullPath),
          contentType: contentTypeFor(fullPath),
          version: Math.floor(stat.mtimeMs)
        });
      }
      if (files.length >= 64) {
        return;
      }
    }
  };
  walk(base);
  return files;
}

function buildResourceManifest(state, config) {
  const resourceState = state.resources || {};
  const contentState = state.content || {};
  const contentPacks = Array.isArray(contentState.packs) ? contentState.packs : [];
  const catalog = Array.isArray(contentState.catalog) ? contentState.catalog : [];
  const packs = [
    {
      id: "family-base",
      type: "base",
      title: "家庭基础资源包",
      version: resourceState.version || 1,
      files: [
        ...listResourceFiles(config.resourceDir, "icons"),
        ...listResourceFiles(config.resourceDir, "images"),
        ...listResourceFiles(config.resourceDir, "music/local"),
        ...listResourceFiles(config.resourceDir, "music/server"),
        ...listResourceFiles(config.resourceDir, "courses/english"),
        ...listResourceFiles(config.resourceDir, "courses/math"),
        ...listResourceFiles(config.resourceDir, "courses/stories"),
        ...listResourceFiles(config.resourceDir, "games"),
        ...listResourceFiles(config.resourceDir, "cache")
      ]
    }
  ];

  return {
    schema: 2,
    deviceProfile: "waveshare-esp32-s3-touch-lcd-1.85b",
    version: resourceState.manifestVersion || "2026.07.02",
    generatedAt: new Date().toISOString(),
    baseUrl: `${config.publicBaseUrl}/api/resources/file`,
    layout: DEFAULT_LAYOUT,
    packs,
    contentPacks,
    catalog: catalog.slice(0, 120),
    diagnostics: {
      catalogCount: catalog.length,
      packCount: contentPacks.length,
      lastSeedAt: contentState.lastSeedAt || null,
      lastImportAt: contentState.lastImportAt || null
    }
  };
}

function resourceFilePath(config, relativePath) {
  const safe = safeRelative(relativePath);
  if (!safe) {
    return "";
  }
  const fullPath = path.resolve(config.resourceDir, safe);
  const root = path.resolve(config.resourceDir);
  if (!fullPath.startsWith(root + path.sep) && fullPath !== root) {
    return "";
  }
  return fullPath;
}

function writeResourceFile(config, relativePath, buffer) {
  const filePath = resourceFilePath(config, relativePath);
  if (!filePath) {
    const error = new Error("invalid resource path");
    error.statusCode = 400;
    throw error;
  }
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    const error = new Error("empty resource content");
    error.statusCode = 400;
    throw error;
  }
  if (buffer.length > 5 * 1024 * 1024) {
    const error = new Error("resource too large");
    error.statusCode = 413;
    throw error;
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  try {
    fs.writeFileSync(temporaryPath, buffer, { flag: "wx" });
    fs.renameSync(temporaryPath, filePath);
  } catch (error) {
    try {
      if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
    } catch {
      // Preserve the original write error.
    }
    throw error;
  }
  const stat = fs.statSync(filePath);
  return {
    path: path.relative(config.resourceDir, filePath).replace(/\\/g, "/"),
    size: stat.size,
    sha256: sha256Buffer(buffer),
    contentType: contentTypeFor(filePath),
    version: Math.floor(stat.mtimeMs)
  };
}

function deleteResourceFile(config, relativePath) {
  const filePath = resourceFilePath(config, relativePath);
  if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    const error = new Error("resource file not found");
    error.statusCode = 404;
    throw error;
  }
  fs.unlinkSync(filePath);
  return {
    path: path.relative(config.resourceDir, filePath).replace(/\\/g, "/"),
    deleted: true
  };
}

module.exports = {
  DEFAULT_LAYOUT,
  buildResourceManifest,
  deleteResourceFile,
  ensureResourceLayout,
  resourceFilePath,
  writeResourceFile
};

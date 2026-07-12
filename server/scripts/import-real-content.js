const fs = require("fs");
const http = require("http");
const https = require("https");
const path = require("path");

const TYPE_CONFIG = {
  album: {
    dir: "images",
    packType: "album",
    title: "真实家庭相册",
    tags: ["family", "album", "real"],
    extensions: [".jpg", ".jpeg", ".png"]
  },
  podcast: {
    dir: "music/server",
    packType: "podcast",
    title: "真实家庭播客",
    tags: ["family", "podcast", "real"],
    extensions: [".mp3", ".ogg", ".opus"]
  },
  english: {
    dir: "courses/english",
    packType: "course",
    title: "真实英语练习",
    tags: ["english", "speaking", "real"],
    language: "en-US",
    ageRange: "kids",
    extensions: [".json"]
  },
  game: {
    dir: "games",
    packType: "game",
    title: "真实小游戏",
    tags: ["family", "game", "real"],
    extensions: [".json"]
  }
};

function parseArgs(argv) {
  const args = {
    baseUrl: process.env.FAMILY_HUB_URL || "http://192.168.31.246:3100",
    adminToken: process.env.ADMIN_TOKEN || "",
    packId: `real-family-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}`,
    titlePrefix: "真实家庭素材",
    dryRun: false,
    files: {}
  };
  for (const item of argv) {
    if (item === "--dry-run") {
      args.dryRun = true;
    } else if (item.startsWith("--base-url=")) {
      args.baseUrl = item.slice("--base-url=".length);
    } else if (item.startsWith("--admin-token=")) {
      args.adminToken = item.slice("--admin-token=".length);
    } else if (item.startsWith("--pack-id=")) {
      args.packId = safeId(item.slice("--pack-id=".length), args.packId);
    } else if (item.startsWith("--title-prefix=")) {
      args.titlePrefix = item.slice("--title-prefix=".length).trim() || args.titlePrefix;
    } else {
      const match = item.match(/^--(album|podcast|english|game)=(.+)$/);
      if (match) {
        args.files[match[1]] = match[2];
      }
    }
  }
  return args;
}

function usage() {
  return [
    "Usage:",
    "  npm run content:import-real -- \\",
    "    --album=/path/photo.jpg \\",
    "    --podcast=/path/audio.mp3 \\",
    "    --english=/path/session.json \\",
    "    --game=/path/game.json",
    "",
    "Optional:",
    "  --base-url=http://192.168.31.246:3100",
    "  --admin-token=<token>",
    "  --pack-id=real-family-20260707",
    "  --title-prefix=暑假家庭素材",
    "  --dry-run"
  ].join("\n");
}

function safeId(value, fallback = "real-family") {
  const id = String(value || fallback)
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
  return id || fallback;
}

function safeFileName(filePath) {
  return path.basename(filePath).replace(/[^a-zA-Z0-9._-]/g, "-").replace(/-+/g, "-");
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
    case ".json":
      return "application/json";
    default:
      return "application/octet-stream";
  }
}

const REPRESENTATIVE_CONTENT_RE = /\b(sample|smoke|representative|test|demo|diagnostic|placeholder|dummy|mock|fixture)\b|示例|占位|测试|诊断/i;

function looksLikeRepresentative(value) {
  return REPRESENTATIVE_CONTENT_RE.test(String(value || ""));
}

function requestJson(baseUrl, method, pathname, body, adminToken = "") {
  const url = new URL(pathname, baseUrl);
  const payload = body ? JSON.stringify(body) : "";
  const transport = url.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const req = transport.request(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
        ...(adminToken ? { Authorization: `Bearer ${adminToken}`, "X-Admin-Token": adminToken } : {})
      }
    }, (res) => {
      let raw = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { raw += chunk; });
      res.on("end", () => {
        let parsed = null;
        try {
          parsed = raw ? JSON.parse(raw) : null;
        } catch (error) {
          reject(new Error(`${method} ${pathname} returned non-json: ${raw.slice(0, 200)}`));
          return;
        }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on("error", reject);
    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

async function api(args, method, pathname, body, requireOk = true) {
  const result = await requestJson(args.baseUrl, method, pathname, body, args.adminToken);
  if (requireOk && (result.status < 200 || result.status >= 300 || !result.body?.ok)) {
    throw new Error(`${method} ${pathname} failed: ${result.status} ${JSON.stringify(result.body)}`);
  }
  return result.body?.data;
}

function validateFiles(files) {
  const entries = Object.entries(files);
  if (entries.length === 0) {
    throw new Error(`No content files provided.\n\n${usage()}`);
  }
  for (const [type, filePath] of entries) {
    const config = TYPE_CONFIG[type];
    if (!config) {
      throw new Error(`Unsupported content type: ${type}`);
    }
    const fullPath = path.resolve(filePath);
    if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
      throw new Error(`${type} file not found: ${filePath}`);
    }
    const stat = fs.statSync(fullPath);
    if (stat.size <= 0) {
      throw new Error(`${type} file is empty: ${filePath}`);
    }
    if (stat.size > 5 * 1024 * 1024) {
      throw new Error(`${type} file is larger than backend import limit 5MB: ${filePath}`);
    }
    const ext = path.extname(fullPath).toLowerCase();
    if (!config.extensions.includes(ext)) {
      throw new Error(`${type} file extension must be one of ${config.extensions.join(", ")}: ${filePath}`);
    }
  }
}

function buildImportBody(args, type, filePath) {
  const config = TYPE_CONFIG[type];
  const fullPath = path.resolve(filePath);
  const basename = safeFileName(fullPath);
  const remotePath = `${config.dir}/${basename}`;
  const itemId = safeId(`${args.packId}-${type}-${path.parse(basename).name}`, `${args.packId}-${type}`);
  const packId = safeId(`${args.packId}-${type}`, `${args.packId}-${type}`);
  return {
    pack: {
      id: packId,
      type: config.packType,
      title: `${args.titlePrefix} ${config.title}`,
      version: 1,
      manifestVersion: 1,
      source: { kind: "family-owned" },
      license: "private-family-use",
      description: "Family-owned content imported by import-real-content.js"
    },
    item: {
      id: itemId,
      type,
      title: `${args.titlePrefix} ${config.title}`,
      subtitle: basename,
      tags: config.tags,
      ageRange: config.ageRange || "family",
      language: config.language || "zh-CN",
      durationSec: 0
    },
    path: remotePath,
    contentBase64: fs.readFileSync(fullPath).toString("base64")
  };
}

function warnIfRepresentative(local) {
  const haystack = [local.itemId, local.packId, local.remotePath].join(" ");
  if (looksLikeRepresentative(haystack)) {
    console.warn(`Warning: ${local.type} path/id looks like sample content and will not satisfy real-family-content readiness: ${local.remotePath}`);
  }
}

function findReadiness(readiness, id) {
  return (readiness.items || []).find((item) => item.id === id) || null;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  validateFiles(args.files);
  console.log(`Backend: ${args.baseUrl}`);
  console.log(`Pack prefix: ${args.packId}`);

  const imports = [];
  for (const [type, filePath] of Object.entries(args.files)) {
    const body = buildImportBody(args, type, filePath);
    const local = {
      type,
      sourcePath: path.resolve(filePath),
      remotePath: body.path,
      contentType: contentTypeFor(filePath),
      size: fs.statSync(path.resolve(filePath)).size,
      itemId: body.item.id,
      packId: body.pack.id
    };
    warnIfRepresentative(local);
    if (args.dryRun) {
      imports.push({ local, result: null });
      continue;
    }
    const data = await api(args, "POST", "/api/content/import", body);
    imports.push({ local, result: data.result });
    const file = data.result?.file || {};
    console.log(`Imported ${type}: ${file.path || local.remotePath} ${file.contentType || local.contentType} ${file.size || local.size} bytes`);
  }

  if (args.dryRun) {
    console.log("Dry run only; no files were uploaded.");
    console.log(JSON.stringify({ plannedImports: imports.map((item) => item.local) }, null, 2));
    return;
  }

  const [manifest, readiness, status] = await Promise.all([
    api(args, "GET", "/api/resources/manifest"),
    api(args, "GET", "/api/acceptance/readiness"),
    api(args, "GET", "/api/acceptance/status")
  ]);
  const allFiles = (manifest.packs || []).flatMap((pack) => pack.files || []);
  const evidenceItems = imports.map(({ local, result }) => {
    const file = result?.file || allFiles.find((entry) => entry.path === local.remotePath) || {};
    return {
      type: local.type,
      itemId: result?.item?.id || local.itemId,
      packId: result?.pack?.id || local.packId,
      path: file.path || local.remotePath,
      sha256: file.sha256 || "",
      size: file.size || local.size,
      contentType: file.contentType || local.contentType
    };
  });
  const contentReadiness = findReadiness(readiness, "real-family-content");
  const acceptanceItem = (status.items || []).find((item) => item.id === "real-family-content");
  const evidenceDraft = {
    packId: args.packId,
    items: evidenceItems,
    readiness: contentReadiness,
    acceptanceStatus: acceptanceItem?.status || "unknown",
    deviceChecksRequired: {
      albumShownOnDevice: false,
      podcastPlayedOnDevice: false,
      englishEntryOpenedOnDevice: false,
      gameEntryOpenedOnDevice: false
    }
  };

  console.log("\nReadiness:");
  console.log(`real-family-content: ${contentReadiness?.status || "missing"} ${contentReadiness?.okCount || 0}/${contentReadiness?.total || 0}`);
  console.log("\nEvidence data draft (paste only after real device display/playback checks):");
  console.log(JSON.stringify(evidenceDraft, null, 2));
  console.log("\nNext: verify Album/Music/English/Apps on the ESP32, then record evidence in /admin or /companion.");
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});

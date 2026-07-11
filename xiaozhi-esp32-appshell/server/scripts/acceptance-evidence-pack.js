const fs = require("fs");
const http = require("http");
const https = require("https");
const path = require("path");

const DEFAULT_ITEMS = [
  "blufi-new-wifi",
  "home-assistant-real-scene",
  "real-family-content",
  "openclaw-default-music"
];

const ENDPOINTS = [
  ["status", "/api/acceptance/status"],
  ["readiness", "/api/acceptance/readiness"],
  ["diagnostics", "/api/diagnostics/report"],
  ["device-logs", "/api/device/logs"],
  ["integrations", "/api/integrations/status"],
  ["openclaw-jobs", "/api/openclaw/jobs"],
  ["manifest", "/api/resources/manifest"],
  ["catalog", "/api/content/catalog"]
];

function parseArgs(argv) {
  const args = {
    baseUrl: process.env.FAMILY_HUB_URL || "http://192.168.31.246:3100",
    outDir: path.join(process.cwd(), "acceptance-artifacts", new Date().toISOString().replace(/[:.]/g, "-")),
    items: DEFAULT_ITEMS,
    observationsPath: "",
    expectedSsid: "",
    timeoutSec: 0,
    watchBlufi: false
  };
  for (const item of argv) {
    if (item === "--watch-blufi") {
      args.watchBlufi = true;
    } else if (item.startsWith("--base-url=")) {
      args.baseUrl = item.slice("--base-url=".length);
    } else if (item.startsWith("--out=")) {
      args.outDir = item.slice("--out=".length);
    } else if (item.startsWith("--items=")) {
      args.items = item.slice("--items=".length).split(",").map((value) => value.trim()).filter(Boolean);
    } else if (item.startsWith("--observations=")) {
      args.observationsPath = item.slice("--observations=".length);
    } else if (item.startsWith("--expected-ssid=")) {
      args.expectedSsid = item.slice("--expected-ssid=".length);
    } else if (item.startsWith("--timeout=")) {
      args.timeoutSec = Math.max(0, Number(item.slice("--timeout=".length)) || 0);
    }
  }
  args.items = args.items.filter((item) => DEFAULT_ITEMS.includes(item));
  if (args.items.length === 0) {
    args.items = DEFAULT_ITEMS;
  }
  return args;
}

function requestJson(baseUrl, pathname) {
  const url = new URL(pathname, baseUrl);
  const transport = url.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const req = transport.request(url, { method: "GET" }, (res) => {
      let raw = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { raw += chunk; });
      res.on("end", () => {
        let parsed = null;
        try {
          parsed = raw ? JSON.parse(raw) : null;
        } catch (error) {
          reject(new Error(`GET ${pathname} returned non-json: ${raw.slice(0, 200)}`));
          return;
        }
        if (res.statusCode < 200 || res.statusCode >= 300 || !parsed?.ok) {
          reject(new Error(`GET ${pathname} failed: ${res.statusCode} ${JSON.stringify(parsed)}`));
          return;
        }
        resolve(parsed.data);
      });
    });
    req.on("error", reject);
    req.end();
  });
}

function mkdirp(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function readObservations(filePath) {
  if (!filePath) {
    return {};
  }
  const fullPath = path.resolve(filePath);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`observations file not found: ${filePath}`);
  }
  return JSON.parse(fs.readFileSync(fullPath, "utf8"));
}

function itemById(collection, id) {
  return (collection?.items || []).find((item) => item.id === id) || null;
}

function latestBySource(logs, source) {
  return (logs || []).find((log) => log.source === source) || null;
}

function findLatestOpenClawJob(jobs, target) {
  return (jobs || []).find((job) => job.target === target) || null;
}

function latestDeviceCommandAck(commands, type, deviceId = "") {
  return (commands || []).find((command) =>
    command.type === type &&
    command.status !== "pending" &&
    (!deviceId || command.deviceId === deviceId)
  ) || null;
}

function recentOpenClawPolicyAudit(audit) {
  return (audit || [])
    .filter((item) => item.action === "openclaw.run" && (item.status === "denied" || item.status === "confirmation_required"))
    .slice(0, 8)
    .map((item) => ({
      at: item.at,
      status: item.status,
      memberId: item.memberId,
      mode: item.mode,
      reason: item.reason
    }));
}

function latestHa(integrations) {
  return integrations?.homeAssistant?.history?.[0] || null;
}

function manifestFiles(manifest) {
  return (manifest?.packs || []).flatMap((pack) => (pack.files || []).map((file) => ({ ...file, packId: pack.id })));
}

function contentItemsByType(catalog, type) {
  return (catalog?.catalog || []).filter((item) => item.type === type);
}

function summarizeChecks(readinessItem) {
  return (readinessItem?.checks || []).map((check) =>
    `- ${check.ok ? "[x]" : "[ ]"} ${check.label}${check.detail ? `: ${check.detail}` : ""}`).join("\n");
}

function evidenceDraftFor(id, data, observations) {
  const readiness = itemById(data.readiness, id);
  const status = itemById(data.status, id);
  const logs = data.deviceLogs?.logs || [];
  const manifest = data.manifest || {};
  const catalog = data.catalog || {};
  const files = manifestFiles(manifest);
  const observation = observations[id] || {};

  if (id === "blufi-new-wifi") {
    const heartbeat = latestBySource(logs, "appshell.heartbeat");
    const provisioned = latestBySource(logs, "appshell.wifi_provisioned");
    const board = heartbeat?.data?.board || {};
    return {
      status: "pending",
      actor: "parent",
      source: "acceptance-evidence-pack",
      note: "BluFi evidence draft; set status to passed only after phone-side provisioning and Xiaozhi voice path are manually confirmed.",
      reference: observation.reference || "",
      data: {
        readiness,
        heartbeatAt: heartbeat?.at || "",
        provisionedAt: provisioned?.at || "",
        method: provisioned?.data?.method || "",
        ssid: board.ssid || "",
        ip: board.ip || "",
        rssi: board.rssi,
        channel: board.channel,
        xiaozhiVoiceOk: Boolean(observation.xiaozhiVoiceOk),
        settingsPageObserved: Boolean(observation.settingsPageObserved),
        serialPanic: observation.serialPanic === true
      }
    };
  }

  if (id === "home-assistant-real-scene") {
    const ha = latestHa(data.integrations);
    return {
      status: "pending",
      actor: "parent",
      source: "acceptance-evidence-pack",
      note: "Home Assistant evidence draft; set status to passed only after HA-side entity or scene state change is manually confirmed.",
      reference: observation.reference || "",
      data: {
        readiness,
        latestHomeAssistant: ha,
        observedBefore: observation.before || null,
        observedAfter: observation.after || null,
        haSideStateChanged: Boolean(observation.haSideStateChanged),
        auditChecked: Boolean(observation.auditChecked)
      }
    };
  }

  if (id === "real-family-content") {
    const types = ["album", "podcast", "english", "game"];
    return {
      status: "pending",
      actor: "parent",
      source: "acceptance-evidence-pack",
      note: "Real family content evidence draft; set status to passed only after ESP32 display/playback/entry checks are manually confirmed.",
      reference: observation.reference || "",
      data: {
        readiness,
        items: types.map((type) => ({
          type,
          catalog: contentItemsByType(catalog, type).slice(0, 5),
          files: files.filter((file) => contentItemsByType(catalog, type).some((item) => item.path === file.path)).slice(0, 5)
        })),
        deviceObserved: {
          album: Boolean(observation.album),
          podcastPlayback: Boolean(observation.podcastPlayback),
          englishEntry: Boolean(observation.englishEntry),
          gameEntry: Boolean(observation.gameEntry)
        }
      }
    };
  }

  if (id === "openclaw-default-music") {
    const jobs = data.openclaw?.jobs || [];
    const commandHistory = data.diagnostics?.commandStatus?.history || [];
    return {
      status: "pending",
      actor: "parent",
      source: "acceptance-evidence-pack",
      note: "OpenClaw evidence draft; set status to passed only after default/music real household effects are manually confirmed.",
      reference: observation.reference || "",
      data: {
        readiness,
        latestDefaultJob: findLatestOpenClawJob(jobs, "default"),
        latestMusicJob: findLatestOpenClawJob(jobs, "music"),
        latestMediaPlayAck: latestDeviceCommandAck(commandHistory, "media.server.play", "esp32-185b"),
        defaultObservedEffect: observation.defaultObservedEffect || "",
        musicObservedEffect: observation.musicObservedEffect || "",
        policyChecks: observation.policyChecks || {
          recentAudit: recentOpenClawPolicyAudit(data.diagnostics?.recentAudit || [])
        }
      }
    };
  }

  return {
    status: status?.status || "pending",
    actor: "parent",
    source: "acceptance-evidence-pack",
    note: "Unknown acceptance item",
    data: { readiness }
  };
}

function nextActionsFor(id, draft) {
  const checks = draft.data?.readiness?.checks || [];
  const missing = checks.filter((check) => !check.ok).map((check) => `- ${check.label}: ${check.detail || "missing"}`);
  const ok = (checkId) => checks.some((check) => check.id === checkId && check.ok);
  const manual = [];
  if (id === "blufi-new-wifi") {
    if (!ok("wifi-provisioned") || !ok("method")) {
      manual.push("- Use EspBlufi App to provision a new Wi-Fi.");
    }
    manual.push("- Confirm Settings page network fields and Xiaozhi OTA/MQTT/wake word.");
  } else if (id === "home-assistant-real-scene") {
    if (!ok("configured")) {
      manual.push("- Configure real HOME_ASSISTANT_URL/TOKEN.");
    }
    manual.push("- Observe and record the HA-side scene/entity state change.");
  } else if (id === "real-family-content") {
    if (missing.length > 0) {
      manual.push("- Import non-sample album/podcast/english/game assets.");
    }
    manual.push("- Confirm ESP32 Album/Music/English/Apps display, playback and entries.");
  } else if (id === "openclaw-default-music") {
    if (!ok("default-mapping") || !ok("music-mapping")) {
      manual.push("- Configure OPENCLAW_TARGET_DEFAULT_COMMAND and OPENCLAW_TARGET_MUSIC_COMMAND.");
    }
    if (!ok("default-success") || !ok("music-success")) {
      manual.push("- Trigger default/music through family.openclaw.run until both produce success jobs.");
    }
    manual.push("- Confirm default/music real household effects and policy denials.");
  }
  return [...missing, ...manual].join("\n");
}

function buildReport(args, data, drafts) {
  const lines = [
    "# Acceptance Evidence Pack",
    "",
    `Generated: ${new Date().toISOString()}`,
    `Backend: ${args.baseUrl}`,
    "",
    `Acceptance: ${data.status.counts.passed}/${data.status.counts.total} passed, ${data.status.counts.pending} pending`,
    `Readiness: ${data.readiness.counts.ready}/${data.readiness.counts.total} ready, ${data.readiness.counts.partial} partial, ${data.readiness.counts.missing} missing`,
    "",
    "This pack is read-only evidence collection. It does not mark acceptance items as passed.",
    ""
  ];

  for (const id of args.items) {
    const status = itemById(data.status, id);
    const readiness = itemById(data.readiness, id);
    lines.push(`## ${status?.title || id}`);
    lines.push("");
    lines.push(`- id: \`${id}\``);
    lines.push(`- status: \`${status?.status || "unknown"}\``);
    lines.push(`- readiness: \`${readiness?.status || "missing"} ${readiness?.okCount || 0}/${readiness?.total || 0}\``);
    lines.push("");
    lines.push("Readiness checks:");
    lines.push("");
    lines.push(summarizeChecks(readiness) || "- No readiness checks.");
    lines.push("");
    lines.push("Next actions:");
    lines.push("");
    lines.push(nextActionsFor(id, drafts[id]));
    lines.push("");
    lines.push(`Evidence draft: \`evidence-drafts/${id}.json\``);
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

function buildNextActions(args, drafts) {
  const lines = ["# Next Actions", ""];
  for (const id of args.items) {
    lines.push(`## ${id}`);
    lines.push("");
    lines.push(nextActionsFor(id, drafts[id]));
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

async function collect(args) {
  const data = {};
  for (const [key, endpoint] of ENDPOINTS) {
    data[key.replace(/-/g, "")] = await requestJson(args.baseUrl, endpoint);
  }
  return {
    status: data.status,
    readiness: data.readiness,
    diagnostics: data.diagnostics,
    deviceLogs: data.devicelogs,
    integrations: data.integrations,
    openclaw: data.openclawjobs,
    manifest: data.manifest,
    catalog: data.catalog
  };
}

async function waitForBluFi(args) {
  if (!args.watchBlufi || args.timeoutSec <= 0) {
    return;
  }
  const deadline = Date.now() + args.timeoutSec * 1000;
  while (Date.now() < deadline) {
    const readiness = await requestJson(args.baseUrl, "/api/acceptance/readiness");
    const item = itemById(readiness, "blufi-new-wifi");
    const hasProvisioned = (item?.checks || []).some((check) => check.id === "wifi-provisioned" && check.ok);
    const ssidOk = !args.expectedSsid || (item?.checks || []).some((check) => check.id === "ssid" && check.detail === args.expectedSsid);
    if (hasProvisioned && ssidOk) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const observations = readObservations(args.observationsPath);
  await waitForBluFi(args);
  const data = await collect(args);

  const rawDir = path.join(args.outDir, "raw");
  const draftDir = path.join(args.outDir, "evidence-drafts");
  mkdirp(rawDir);
  mkdirp(draftDir);

  writeJson(path.join(rawDir, "status.json"), data.status);
  writeJson(path.join(rawDir, "readiness.json"), data.readiness);
  writeJson(path.join(rawDir, "diagnostics.json"), data.diagnostics);
  writeJson(path.join(rawDir, "device-logs.json"), data.deviceLogs);
  writeJson(path.join(rawDir, "integrations.json"), data.integrations);
  writeJson(path.join(rawDir, "openclaw-jobs.json"), data.openclaw);
  writeJson(path.join(rawDir, "manifest.json"), data.manifest);
  writeJson(path.join(rawDir, "catalog.json"), data.catalog);

  const drafts = {};
  for (const id of args.items) {
    drafts[id] = evidenceDraftFor(id, data, observations);
    writeJson(path.join(draftDir, `${id}.json`), drafts[id]);
  }

  fs.writeFileSync(path.join(args.outDir, "report.md"), buildReport(args, data, drafts));
  fs.writeFileSync(path.join(args.outDir, "next-actions.md"), buildNextActions(args, drafts));

  console.log(`Evidence pack written to ${path.resolve(args.outDir)}`);
  console.log(`Acceptance: ${data.status.counts.passed}/${data.status.counts.total} passed`);
  console.log(`Readiness: ${data.readiness.counts.ready}/${data.readiness.counts.total} ready, ${data.readiness.counts.partial} partial, ${data.readiness.counts.missing} missing`);
  console.log("This is a read-only evidence pack. Review and submit evidence manually through /admin or /companion.");
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});

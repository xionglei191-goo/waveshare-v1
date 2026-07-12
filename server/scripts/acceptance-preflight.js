const http = require("http");
const https = require("https");

function parseArgs(argv) {
  const args = {
    baseUrl: process.env.FAMILY_HUB_URL || "http://192.168.31.246:3100",
    adminToken: process.env.ADMIN_TOKEN || "",
    execute: false,
    record: false,
    status: "",
    haScene: process.env.HOME_ASSISTANT_SCENE || "scene.family",
    haObserveEntity: process.env.HOME_ASSISTANT_OBSERVE_ENTITY || "",
    haUrl: process.env.HOME_ASSISTANT_URL || "",
    haToken: process.env.HOME_ASSISTANT_TOKEN || "",
    haObserveDelayMs: 1500,
    openclawTargets: ["default", "music"]
  };
  for (const item of argv) {
    if (item === "--execute") {
      args.execute = true;
    } else if (item === "--record") {
      args.record = true;
    } else if (item.startsWith("--base-url=")) {
      args.baseUrl = item.slice("--base-url=".length);
    } else if (item.startsWith("--admin-token=")) {
      args.adminToken = item.slice("--admin-token=".length);
    } else if (item.startsWith("--status=")) {
      args.status = item.slice("--status=".length);
    } else if (item.startsWith("--ha-scene=")) {
      args.haScene = item.slice("--ha-scene=".length);
    } else if (item.startsWith("--ha-observe-entity=")) {
      args.haObserveEntity = item.slice("--ha-observe-entity=".length);
    } else if (item.startsWith("--ha-url=")) {
      args.haUrl = item.slice("--ha-url=".length);
    } else if (item.startsWith("--ha-token=")) {
      args.haToken = item.slice("--ha-token=".length);
    } else if (item.startsWith("--ha-observe-delay-ms=")) {
      args.haObserveDelayMs = Math.max(0, Number(item.slice("--ha-observe-delay-ms=".length)) || 0);
    } else if (item.startsWith("--openclaw-targets=")) {
      args.openclawTargets = item.slice("--openclaw-targets=".length).split(",").map((value) => value.trim()).filter(Boolean);
    }
  }
  return args;
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

function compactHaState(value) {
  if (!value || typeof value !== "object") {
    return null;
  }
  return {
    entityId: value.entity_id || "",
    state: value.state || "",
    lastChanged: value.last_changed || "",
    lastUpdated: value.last_updated || "",
    friendlyName: value.attributes?.friendly_name || ""
  };
}

async function haState(args, entityId) {
  if (!entityId) {
    return null;
  }
  if (!args.haUrl || !args.haToken) {
    throw new Error("--ha-observe-entity requires HOME_ASSISTANT_URL/HOME_ASSISTANT_TOKEN or --ha-url/--ha-token");
  }
  const url = new URL(`/api/states/${encodeURIComponent(entityId)}`, args.haUrl.replace(/\/$/, ""));
  const transport = url.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const req = transport.request(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${args.haToken}`
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
          reject(new Error(`HA state ${entityId} returned non-json: ${raw.slice(0, 200)}`));
          return;
        }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`HA state ${entityId} failed: ${res.statusCode} ${JSON.stringify(parsed)}`));
          return;
        }
        resolve(compactHaState(parsed));
      });
    });
    req.on("error", reject);
    req.end();
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readinessById(readiness) {
  return Object.fromEntries((readiness.items || []).map((item) => [item.id, item]));
}

function compactLatestOpenClaw(jobs, target) {
  const job = (jobs || []).find((item) => item.target === target) || null;
  if (!job) {
    return null;
  }
  return {
    id: job.id,
    target: job.target,
    status: job.status,
    exitCode: job.exitCode,
    finishedAt: job.finishedAt,
    message: job.message,
    stdout: job.stdout,
    stderr: job.stderr
  };
}

function compactLatestHa(history) {
  const item = history?.[0] || null;
  if (!item) {
    return null;
  }
  return {
    at: item.at,
    status: item.status,
    entityId: item.entityId || item.serviceData?.entity_id || "",
    httpCode: item.httpCode,
    exitCode: item.exitCode,
    durationMs: item.durationMs,
    stdout: item.stdout,
    stderr: item.stderr
  };
}

function printReadiness(readiness) {
  console.log(`Readiness: ${readiness.counts.ready}/${readiness.counts.total} ready, ${readiness.counts.partial} partial, ${readiness.counts.missing} missing`);
  for (const item of readiness.items || []) {
    console.log(`\n[${item.status}] ${item.id} ${item.okCount}/${item.total}`);
    for (const check of item.checks || []) {
      console.log(`  ${check.ok ? "✓" : "×"} ${check.label}${check.detail ? `: ${check.detail}` : ""}`);
    }
  }
}

async function executeTools(args) {
  const observations = {};
  console.log("\nExecuting real integration tools because --execute was provided.");
  if (args.haObserveEntity) {
    observations.haBefore = await haState(args, args.haObserveEntity);
    console.log(`HA observed before ${args.haObserveEntity}: ${JSON.stringify(observations.haBefore)}`);
  }
  const ha = await api(args, "POST", "/api/agent/tools/family.homeassistant.scene", {
    args: { entityId: args.haScene },
    confirm: true,
    user: { id: "parent", role: "parent" },
    source: "acceptance-preflight"
  }, false);
  console.log(`HA scene result: ${JSON.stringify(ha)}`);
  if (args.haObserveEntity) {
    await sleep(args.haObserveDelayMs);
    observations.haAfter = await haState(args, args.haObserveEntity);
    observations.haSideStateChanged = Boolean(
      observations.haBefore &&
      observations.haAfter &&
      (observations.haBefore.state !== observations.haAfter.state ||
        observations.haBefore.lastChanged !== observations.haAfter.lastChanged ||
        observations.haBefore.lastUpdated !== observations.haAfter.lastUpdated)
    );
    console.log(`HA observed after ${args.haObserveEntity}: ${JSON.stringify(observations.haAfter)}`);
    console.log(`HA side state changed: ${observations.haSideStateChanged}`);
  }

  for (const target of args.openclawTargets) {
    const result = await api(args, "POST", "/api/agent/tools/family.openclaw.run", {
      args: { target },
      confirm: true,
      user: { id: "parent", role: "parent" },
      source: "acceptance-preflight"
    }, false);
    console.log(`OpenClaw ${target} result: ${JSON.stringify(result)}`);
  }
  return observations;
}

async function recordEvidence(args, readiness, integrations, openclaw, observations = {}) {
  if (!args.status) {
    throw new Error("--record requires an explicit --status=pending|passed|failed|blocked");
  }
  if (!args.adminToken) {
    throw new Error("--record requires --admin-token or ADMIN_TOKEN");
  }
  const byId = readinessById(readiness);
  const records = [
    {
      id: "home-assistant-real-scene",
      note: `acceptance preflight HA scene ${args.haScene}`,
      data: {
        readiness: byId["home-assistant-real-scene"],
        latestHomeAssistant: compactLatestHa(integrations.homeAssistant?.history || []),
        observedBefore: observations.haBefore || null,
        observedAfter: observations.haAfter || null,
        haSideStateChanged: Boolean(observations.haSideStateChanged)
      }
    },
    {
      id: "openclaw-default-music",
      note: `acceptance preflight OpenClaw targets ${args.openclawTargets.join(",")}`,
      data: {
        readiness: byId["openclaw-default-music"],
        latestDefaultJob: compactLatestOpenClaw(openclaw.jobs || [], "default"),
        latestMusicJob: compactLatestOpenClaw(openclaw.jobs || [], "music")
      }
    }
  ];

  for (const record of records) {
    const result = await api(args, "POST", `/api/admin/acceptance/${encodeURIComponent(record.id)}/evidence`, {
      status: args.status,
      actor: "acceptance-preflight",
      source: "acceptance-preflight",
      note: record.note,
      data: record.data
    });
    console.log(`Recorded evidence for ${record.id}: ${result.item.status}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const [status, readiness, integrations, openclaw, capabilities] = await Promise.all([
    api(args, "GET", "/api/acceptance/status"),
    api(args, "GET", "/api/acceptance/readiness"),
    api(args, "GET", "/api/integrations/status"),
    api(args, "GET", "/api/openclaw/jobs"),
    api(args, "GET", "/api/agent/capabilities")
  ]);

  console.log(`Backend: ${args.baseUrl}`);
  console.log(`Acceptance: ${status.counts.passed}/${status.counts.total} passed, ${status.counts.pending} pending`);
  console.log(`Home Assistant configured: ${integrations.homeAssistant.configured}`);
  console.log(`OpenClaw configured: ${openclaw.configured}; targets: ${(openclaw.allowedTargets || []).join(",")}`);
  console.log(`Agent tools: ${(capabilities.tools || []).length}`);
  printReadiness(readiness);

  let observations = {};
  if (args.execute) {
    observations = await executeTools(args);
  }

  const [readinessAfter, integrationsAfter, openclawAfter] = await Promise.all([
    api(args, "GET", "/api/acceptance/readiness"),
    api(args, "GET", "/api/integrations/status"),
    api(args, "GET", "/api/openclaw/jobs")
  ]);

  if (args.execute) {
    console.log("\nReadiness after execution:");
    printReadiness(readinessAfter);
  }

  if (args.record) {
    await recordEvidence(args, readinessAfter, integrationsAfter, openclawAfter, observations);
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});

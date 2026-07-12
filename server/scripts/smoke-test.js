const http = require("http");
const childProcess = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { createServer } = require("../src/app");
const { loadConfig } = require("../src/config");
const { handleMcpRequest } = require("../src/xiaozhi-mcp-bridge");

function request(port, method, pathname, body, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : "";
    const req = http.request({
      hostname: "127.0.0.1",
      port,
      path: pathname,
      method,
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
        ...extraHeaders
      }
    }, (res) => {
      let raw = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { raw += chunk; });
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, headers: res.headers, body: raw ? JSON.parse(raw) : null });
        } catch (error) {
          reject(error);
        }
      });
    });
    req.on("error", reject);
    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

function requestRaw(port, pathname, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: "127.0.0.1",
      port,
      path: pathname,
      method: "GET",
      headers
    }, (res) => {
      let size = 0;
      res.on("data", (chunk) => {
        size += chunk.length;
      });
      const result = { status: res.statusCode, size, headers: res.headers };
      res.on("end", () => resolve({ ...result, size }));
      res.on("close", () => resolve({ ...result, size }));
    });
    req.on("error", reject);
    req.end();
  });
}

function requestText(port, pathname, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: "127.0.0.1",
      port,
      path: pathname,
      method: "GET",
      headers
    }, (res) => {
      let raw = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        raw += chunk;
      });
      res.on("end", () => resolve({ status: res.statusCode, body: raw, headers: res.headers }));
    });
    req.on("error", reject);
    req.end();
  });
}

function waitForEvent(port, expectedEvent, trigger) {
  return new Promise((resolve, reject) => {
    let raw = "";
    let triggered = false;
    let settled = false;
    const timer = setTimeout(() => {
      finish(new Error(`timed out waiting for ${expectedEvent}`));
    }, 5000);

    function finish(error, event) {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      req.destroy();
      if (error) {
        reject(error);
      } else {
        resolve(event);
      }
    }

    function parseBlock(block) {
      const event = { name: "message", data: "" };
      for (const line of block.split("\n")) {
        if (line.startsWith("event:")) {
          event.name = line.slice(6).trim();
        } else if (line.startsWith("data:")) {
          event.data += line.slice(5).trim();
        }
      }
      return event;
    }

    const req = http.request({
      hostname: "127.0.0.1",
      port,
      path: "/api/events",
      method: "GET",
      headers: { Accept: "text/event-stream" }
    }, (res) => {
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        raw += chunk;
        let index = raw.indexOf("\n\n");
        while (index >= 0) {
          const block = raw.slice(0, index);
          raw = raw.slice(index + 2);
          const event = parseBlock(block);
          if (event.name === "connected" && !triggered) {
            triggered = true;
            Promise.resolve(trigger()).catch(finish);
          } else if (event.name === expectedEvent) {
            finish(null, event);
            return;
          }
          index = raw.indexOf("\n\n");
        }
      });
    });
    req.on("error", (error) => {
      if (!settled) {
        reject(error);
      }
    });
    req.end();
  });
}

function assertOk(result, label) {
  if (result.status < 200 || result.status >= 300 || !result.body?.ok) {
    throw new Error(`${label} failed: ${result.status} ${JSON.stringify(result.body)}`);
  }
}

function manifestFile(manifest, relativePath) {
  return (manifest.packs || [])
    .flatMap((pack) => pack.files || [])
    .find((file) => file.path === relativePath);
}

async function importContentFixture(port, fixture) {
  const result = await request(port, "POST", "/api/content/import", {
    pack: fixture.pack,
    item: fixture.item,
    path: fixture.path,
    contentBase64: fixture.content.toString("base64")
  });
  assertOk(result, `content import ${fixture.item.id}`);
  const file = result.body.data.result.file;
  if (file?.path !== fixture.path ||
      file?.size !== fixture.content.length ||
      !file?.sha256 ||
      file?.contentType !== fixture.contentType) {
    throw new Error(`content import file metadata mismatch for ${fixture.item.id}: ${JSON.stringify(file)}`);
  }
  if (result.body.data.result.item?.id !== fixture.item.id ||
      result.body.data.result.item?.type !== fixture.item.type ||
      result.body.data.result.pack?.id !== fixture.pack.id) {
    throw new Error(`content import catalog metadata mismatch for ${fixture.item.id}: ${JSON.stringify(result.body.data.result)}`);
  }
  return result.body.data.result;
}

async function main() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "xiaozhi-family-hub-smoke-"));
  const homeAssistantCallsFile = path.join(tempRoot, "ha-calls.jsonl");
  const remoteAudio = Buffer.from("ID3 smoke remote audio payload");
  const remoteMediaServer = http.createServer((req, res) => {
    if (req.url === "/feed.xml") {
      res.setHeader("Content-Type", "application/rss+xml");
      res.end(`<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>Smoke Feed</title>
<item><title>Remote Lullaby Smoke</title><author>Smoke Radio</author>
<enclosure url="http://127.0.0.1:${remoteMediaServer.address().port}/remote-lullaby.mp3" type="audio/mpeg" length="${remoteAudio.length}" />
</item></channel></rss>`);
      return;
    }
    if (req.url === "/remote-lullaby.mp3") {
      res.setHeader("Content-Type", "audio/mpeg");
      res.setHeader("Content-Length", String(remoteAudio.length));
      res.end(remoteAudio);
      return;
    }
    res.statusCode = 404;
    res.end("not found");
  });
  await new Promise((resolve) => remoteMediaServer.listen(0, "127.0.0.1", resolve));
  const remoteMediaPort = remoteMediaServer.address().port;
  const homeAssistantMock = childProcess.spawn(process.execPath, ["-e", `
const fs = require("fs");
const http = require("http");
const callsFile = process.argv[1];
const server = http.createServer((req, res) => {
  if (req.method === "POST" && /^\\/api\\/services\\/[a-z0-9_]+\\/[a-z0-9_]+$/.test(req.url)) {
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => {
      const auth = req.headers.authorization || "";
      let body = {};
      try {
        body = raw ? JSON.parse(raw) : {};
      } catch (error) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: "bad json" }));
        return;
      }
      fs.appendFileSync(callsFile, JSON.stringify({ auth, url: req.url, body }) + "\\n");
      if (auth !== "Bearer smoke-ha-token") {
        res.statusCode = 401;
        res.end(JSON.stringify({ error: "unauthorized" }));
        return;
      }
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify([{ entity_id: body.entity_id, state: "scening" }]));
    });
    return;
  }
  res.statusCode = 404;
  res.end("not found");
});
server.listen(0, "127.0.0.1", () => {
  console.log(server.address().port);
});
process.on("SIGTERM", () => server.close(() => process.exit(0)));
  `, homeAssistantCallsFile], {
    stdio: ["ignore", "pipe", "inherit"]
  });
  const homeAssistantPort = await new Promise((resolve, reject) => {
    let raw = "";
    const timer = setTimeout(() => reject(new Error("timed out starting mock HA")), 5000);
    homeAssistantMock.stdout.setEncoding("utf8");
    homeAssistantMock.stdout.on("data", (chunk) => {
      raw += chunk;
      const line = raw.split(/\r?\n/).find(Boolean);
      if (line) {
        clearTimeout(timer);
        resolve(Number(line));
      }
    });
    homeAssistantMock.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
  const stateFile = path.join(tempRoot, "state.json");
  const sqliteFile = path.join(tempRoot, "family-hub.sqlite");
  const resourceDir = path.join(tempRoot, "resources");
  const serverMusicDir = path.join(resourceDir, "music/server");
  const openclawCommand = path.join(tempRoot, "openclaw-smoke.sh");
  fs.writeFileSync(openclawCommand, "#!/bin/sh\necho openclaw:$1\nexit 0\n");
  fs.chmodSync(openclawCommand, 0o755);
  const config = loadConfig({
    port: 0,
    stateFile,
    sqliteFile,
    resourceDir,
    serverMusicDir,
    publicBaseUrl: "http://127.0.0.1:0",
    openclawCommand,
    openclawTargets: ["default", "music", "diagnostics"],
    onlineMediaProviders: ["rss"],
    onlineMediaFeeds: [`http://127.0.0.1:${remoteMediaPort}/feed.xml`],
    onlineMediaAllowPrivateHosts: true,
    onlineMediaTimeoutMs: 2000,
    homeAssistantUrl: `http://127.0.0.1:${homeAssistantPort}`,
    homeAssistantToken: "smoke-ha-token",
    homeAssistantScenes: ["scene.family"],
    homeAssistantTimeoutMs: 2000,
    speakerEntity: "media_player.smoke_speaker",
    adminToken: "smoke-admin-token",
    adminPublicHosts: ["wave.xionglei.online"],
    requestLogJson: false,
    rateLimitAgentPerMinute: 500,
    rateLimitActionPerMinute: 500,
    rateLimitDeviceLogsPerMinute: 500,
    rateLimitAdminPerMinute: 500
  });
  const adminHeaders = { Authorization: "Bearer smoke-admin-token" };
  const { app, store } = createServer(config);
  const server = app.listen(0, "127.0.0.1");
  const port = await new Promise((resolve) => server.once("listening", () => resolve(server.address().port)));

  try {
    const health = await request(port, "GET", "/api/health", null, { "X-Request-Id": "smoke-request-id" });
    assertOk(health, "health");
    if (health.headers["x-request-id"] !== "smoke-request-id" || health.body.requestId !== "smoke-request-id") {
      throw new Error(`health did not propagate requestId: ${JSON.stringify({ headers: health.headers, body: health.body })}`);
    }
    const blockedCors = await request(port, "GET", "/api/health", null, { Origin: "https://evil.example" });
    if (blockedCors.headers["access-control-allow-origin"]) throw new Error("untrusted CORS origin was allowed");
    const lanCors = await request(port, "GET", "/api/health", null, { Origin: "http://192.168.31.55" });
    if (lanCors.headers["access-control-allow-origin"] !== "http://192.168.31.55") throw new Error("LAN CORS origin was rejected");
    const event = await waitForEvent(port, "notification.created", () => request(port, "POST", "/api/action", {
      type: "action.call",
      name: "notification.push",
      params: { title: "smoke event", message: "sse ok" }
    }));
    if (!event.data.includes("smoke event")) {
      throw new Error(`event stream returned unexpected payload: ${event.data}`);
    }
    const latestEvent = await request(port, "GET", "/api/events/latest");
    assertOk(latestEvent, "events latest");
    if (latestEvent.body.data.notification?.title !== "smoke event") {
      throw new Error("events latest did not expose latest notification");
    }
    assertOk(await request(port, "GET", "/api/device/summary"), "summary");
    assertOk(await request(port, "GET", "/api/music/state"), "music");
    assertOk(await request(port, "GET", "/api/ui/page/home"), "ui page");
    assertOk(await request(port, "GET", "/api/ui/page/apps"), "apps ui page");
    assertOk(await request(port, "GET", "/api/ui/page/content"), "content ui page");
    const capabilities = await request(port, "GET", "/api/ui/capabilities");
    assertOk(capabilities, "ui capabilities");
    if (capabilities.body.data.schemaVersion !== 2) {
      throw new Error("remote ui schema v2 missing");
    }
    assertOk(await request(port, "GET", "/api/resources/manifest"), "resource manifest");
    assertOk(await request(port, "POST", "/api/content/seed", {}), "content seed");
    const catalog = await request(port, "GET", "/api/content/catalog");
    assertOk(catalog, "content catalog");
    if ((catalog.body.data.catalog || []).length !== 0) {
      throw new Error(`content seed sample items leaked into production catalog: ${JSON.stringify(catalog.body.data.catalog)}`);
    }
    const diagnosticSeedCatalog = await request(port, "GET", "/api/content/catalog?includeDiagnostics=1");
    assertOk(diagnosticSeedCatalog, "diagnostic content catalog");
    if ((diagnosticSeedCatalog.body.data.catalog || []).length < 5) {
      throw new Error("content seed did not create enough diagnostic catalog items");
    }
    assertOk(await request(port, "GET", "/api/content/packs"), "content packs");
    const contentFixtures = [
      {
        pack: {
          id: "family-album-demo-pack",
          type: "album",
          title: "家庭相册 demo 包",
          version: 1,
          description: "测试相册导入链路"
        },
        item: {
          id: "family-album-demo-photo",
          type: "album",
          title: "家庭相册 demo 图",
          subtitle: "屏保素材",
          tags: ["family", "screensaver", "demo"],
          ageRange: "family",
          language: "zh-CN",
          cover: "images/family-demo-album.rgb565.bin",
          durationSec: 0
        },
        path: "images/family-demo-album.rgb565.bin",
        content: Buffer.from([0x00, 0xf8, 0xe0, 0x07, 0x1f, 0x00, 0xff, 0xff]),
        contentType: "application/octet-stream"
      },
      {
        pack: {
          id: "test-podcast-pack",
          type: "podcast",
          title: "Test Podcast Pack",
          version: 1,
          description: "测试服务器播客导入链路"
        },
        item: {
          id: "test-podcast-episode",
          type: "podcast",
          title: "Test Podcast Episode",
          subtitle: "服务器 MP3",
          tags: ["podcast", "family", "test"],
          ageRange: "family",
          language: "zh-CN",
          durationSec: 12
        },
        path: "music/server/test-family-podcast.mp3",
        content: remoteAudio,
        contentType: "audio/mpeg"
      },
      {
        pack: {
          id: "diagnostic-english-pack",
          type: "course",
          title: "Diagnostic English Pack",
          version: 1,
          description: "诊断英语导入链路"
        },
        item: {
          id: "diagnostic-english-session",
          type: "english",
          title: "Diagnostic English Session",
          subtitle: "口语跟读",
          tags: ["english", "speaking", "diagnostic"],
          ageRange: "kids",
          language: "en-US",
          durationSec: 180
        },
        path: "courses/english/diagnostic-session.json",
        content: Buffer.from(JSON.stringify({
          title: "Diagnostic English",
          mode: "shadowing",
          phrases: ["Good morning.", "I can try again."],
          level: "beginner"
        }), "utf8"),
        contentType: "application/json"
      },
      {
        pack: {
          id: "dummy-game-pack",
          type: "game",
          title: "Dummy Game Pack",
          version: 1,
          description: "测试小游戏入口导入链路"
        },
        item: {
          id: "dummy-game",
          type: "game",
          title: "Dummy Game",
          subtitle: "反应练习",
          tags: ["game", "reaction", "dummy"],
          ageRange: "family",
          language: "zh-CN",
          durationSec: 60
        },
        path: "games/dummy-game.json",
        content: Buffer.from(JSON.stringify({
          title: "Dummy Game",
          type: "reaction",
          engine: "local",
          entry: "focus-tap"
        }), "utf8"),
        contentType: "application/json"
      }
    ];
    for (const fixture of contentFixtures) {
      await importContentFixture(port, fixture);
      const typedCatalog = await request(port, "GET", `/api/content/catalog?type=${encodeURIComponent(fixture.item.type)}`);
      assertOk(typedCatalog, `content catalog ${fixture.item.type}`);
      if (typedCatalog.body.data.catalog.some((item) => item.id === fixture.item.id)) {
        throw new Error(`diagnostic fixture leaked into production catalog ${fixture.item.id}`);
      }
      const typedDiagnosticCatalog = await request(port, "GET", `/api/content/catalog?type=${encodeURIComponent(fixture.item.type)}&includeDiagnostics=1`);
      assertOk(typedDiagnosticCatalog, `diagnostic content catalog ${fixture.item.type}`);
      if (!typedDiagnosticCatalog.body.data.catalog.some((item) => item.id === fixture.item.id && item.path === fixture.path)) {
        throw new Error(`diagnostic catalog missing imported ${fixture.item.id}`);
      }
    }
    const packsAfterContentImport = await request(port, "GET", "/api/content/packs");
    assertOk(packsAfterContentImport, "content packs after representative imports");
    const packIds = new Set((packsAfterContentImport.body.data.packs || []).map((pack) => pack.id));
    for (const fixture of contentFixtures) {
      if (!packIds.has(fixture.pack.id)) {
        throw new Error(`content packs missing ${fixture.pack.id}`);
      }
    }
    const manifestAfterContentImport = await request(port, "GET", "/api/resources/manifest");
    assertOk(manifestAfterContentImport, "resource manifest after representative content imports");
    const manifestData = manifestAfterContentImport.body.data;
    const manifestCatalogIds = new Set((manifestData.catalog || []).map((item) => item.id));
    const manifestPackIds = new Set((manifestData.contentPacks || []).map((pack) => pack.id));
    for (const fixture of contentFixtures) {
      const file = manifestFile(manifestData, fixture.path);
      if (!file ||
          file.size !== fixture.content.length ||
          file.contentType !== fixture.contentType ||
          !file.sha256 ||
          !manifestCatalogIds.has(fixture.item.id) ||
          !manifestPackIds.has(fixture.pack.id)) {
        throw new Error(`manifest missing representative content ${fixture.item.id}: ${JSON.stringify(file)}`);
      }
    }
    const representativePodcastTracks = await request(port, "GET", "/api/media/server/tracks");
    assertOk(representativePodcastTracks, "representative podcast media tracks");
    if (representativePodcastTracks.body.data.tracks.some((track) => track.path === "test-family-podcast.mp3" || track.path === "sample-success.ogg")) {
      throw new Error(`diagnostic podcast leaked into production media tracks: ${JSON.stringify(representativePodcastTracks.body.data.tracks)}`);
    }
    const representativePodcastDiagnosticTracks = await request(port, "GET", "/api/media/server/tracks?includeDiagnostics=1");
    assertOk(representativePodcastDiagnosticTracks, "diagnostic podcast media tracks");
    const representativePodcastTrack = representativePodcastDiagnosticTracks.body.data.tracks.find((track) => track.path === "test-family-podcast.mp3");
    if (!representativePodcastTrack?.id || representativePodcastTrack.contentType !== "audio/mpeg") {
      throw new Error(`representative podcast did not enter diagnostic media library: ${JSON.stringify(representativePodcastDiagnosticTracks.body.data.tracks)}`);
    }
    const representativePodcastStream = await requestRaw(port, `/api/media/server/stream/${representativePodcastTrack.id}`);
    if (representativePodcastStream.status !== 200 || representativePodcastStream.size !== remoteAudio.length) {
      throw new Error(`representative podcast stream failed: ${representativePodcastStream.status} ${representativePodcastStream.size}`);
    }
    const albumUiAfterImport = await request(port, "GET", "/api/ui/page/album");
    assertOk(albumUiAfterImport, "album ui after representative import");
    const englishUiAfterImport = await request(port, "GET", "/api/ui/page/english");
    assertOk(englishUiAfterImport, "english ui after representative import");
    const appsUiAfterImport = await request(port, "GET", "/api/ui/page/apps");
    assertOk(appsUiAfterImport, "apps ui after representative import");
    const pageText = JSON.stringify({
      album: albumUiAfterImport.body.data,
      english: englishUiAfterImport.body.data,
      apps: appsUiAfterImport.body.data
    });
    for (const id of ["family-album-demo-photo", "diagnostic-english-session", "dummy-game"]) {
      if (pageText.includes(id)) {
        throw new Error(`remote ui production pages exposed diagnostic content id ${id}`);
      }
    }
    assertOk(await request(port, "GET", "/api/family/members"), "family members");
    assertOk(await request(port, "GET", "/api/family/policies"), "family policies");
    assertOk(await request(port, "GET", "/api/integrations/status"), "integrations status");
    assertOk(await request(port, "GET", "/api/openclaw/jobs"), "openclaw jobs");
    assertOk(await request(port, "GET", "/api/ota/manifest"), "ota manifest");
    assertOk(await request(port, "GET", "/api/compatibility"), "compatibility");
    const initialAcceptance = await request(port, "GET", "/api/acceptance/status");
    assertOk(initialAcceptance, "acceptance status");
    if ((initialAcceptance.body.data.items || []).length !== 4) {
      throw new Error("acceptance status did not expose the expected external acceptance items");
    }
    if (initialAcceptance.body.data.counts?.pending !== 4) {
      throw new Error("acceptance status did not start with pending items");
    }
    const initialReadiness = await request(port, "GET", "/api/acceptance/readiness");
    assertOk(initialReadiness, "acceptance readiness");
    if ((initialReadiness.body.data.items || []).length !== 4) {
      throw new Error("acceptance readiness did not expose the expected external items");
    }
    const contentReadiness = initialReadiness.body.data.items.find((item) => item.id === "real-family-content");
    if (contentReadiness?.status === "ready" || contentReadiness.okCount === contentReadiness.total) {
      throw new Error(`test/demo content should not be treated as real family acceptance readiness: ${JSON.stringify(contentReadiness)}`);
    }
    assertOk(await request(port, "GET", "/api/diagnostics/report"), "diagnostics report");
    const adminRejected = await request(port, "GET", "/api/admin/dashboard");
    if (adminRejected.status !== 401 || adminRejected.body?.ok !== false) {
      throw new Error("admin dashboard did not reject missing token");
    }
    const acceptanceRejected = await request(port, "POST", "/api/admin/acceptance/blufi-new-wifi/evidence", {
      status: "passed",
      note: "unauthorized smoke should fail"
    });
    if (acceptanceRejected.status !== 401 || acceptanceRejected.body?.ok !== false) {
      throw new Error("acceptance evidence did not reject missing token");
    }
    const publicMutationRejected = await request(port, "POST", "/api/action", {
      type: "action.call",
      name: "toast",
      params: { message: "public mutation should require admin" }
    }, { Host: "wave.xionglei.online" });
    if (publicMutationRejected.status !== 401 || publicMutationRejected.body?.ok !== false) {
      throw new Error("public mutation did not require admin token");
    }
    assertOk(await request(port, "POST", "/api/action", {
      type: "action.call",
      name: "toast",
      params: { message: "public mutation with admin token" }
    }, { ...adminHeaders, Host: "wave.xionglei.online" }), "public mutation with admin token");
    assertOk(await request(port, "GET", "/api/admin/dashboard", null, adminHeaders), "admin dashboard");
    assertOk(await request(port, "GET", "/api/admin/config", null, adminHeaders), "admin config");
    assertOk(await request(port, "GET", "/api/admin/media", null, adminHeaders), "admin media");
    assertOk(await request(port, "GET", "/api/admin/family", null, adminHeaders), "admin family");
    const createdDeviceToken = await request(port, "POST", "/api/admin/tokens", {
      name: "smoke device",
      kind: "device"
    }, adminHeaders);
    assertOk(createdDeviceToken, "create managed device token");
    const deviceSecret = createdDeviceToken.body.data.token;
    const deviceTokenId = createdDeviceToken.body.data.record?.id;
    if (!deviceSecret?.startsWith("fh_device_") || !deviceTokenId || JSON.stringify(createdDeviceToken.body.data.record).includes(deviceSecret)) {
      throw new Error("managed device token did not return a one-time secret safely");
    }
    assertOk(await request(port, "POST", "/api/device/logs", {
      deviceId: "managed-token-device",
      source: "smoke.managed_token",
      message: "managed device token accepted",
      data: { bootId: "managed-token-boot", uptimeSec: 10 }
    }, { Host: "wave.xionglei.online", "X-Device-Token": deviceSecret }), "managed device token public write");
    const rotatedDeviceToken = await request(port, "POST", `/api/admin/tokens/${encodeURIComponent(deviceTokenId)}/rotate`, {}, adminHeaders);
    assertOk(rotatedDeviceToken, "rotate managed device token");
    const rotatedSecret = rotatedDeviceToken.body.data.token;
    const rotatedId = rotatedDeviceToken.body.data.record.id;
    const oldDeviceTokenRejected = await request(port, "POST", "/api/device/logs", {
      deviceId: "managed-token-device",
      message: "old token should fail"
    }, { Host: "wave.xionglei.online", "X-Device-Token": deviceSecret });
    if (oldDeviceTokenRejected.status !== 401) throw new Error("rotated device token remained valid");
    assertOk(await request(port, "DELETE", `/api/admin/tokens/${encodeURIComponent(rotatedId)}`, null, adminHeaders), "revoke managed device token");
    const listedTokens = await request(port, "GET", "/api/admin/tokens", null, adminHeaders);
    assertOk(listedTokens, "list managed tokens");
    if (JSON.stringify(listedTokens.body).includes(deviceSecret) || JSON.stringify(listedTokens.body).includes(rotatedSecret)) {
      throw new Error("managed token list leaked a plaintext secret");
    }
    const acceptanceMissing = await request(port, "POST", "/api/admin/acceptance/not-a-real-item/evidence", {
      status: "passed",
      note: "missing item"
    }, adminHeaders);
    if (acceptanceMissing.status !== 404 || acceptanceMissing.body?.ok !== false) {
      throw new Error("acceptance evidence did not reject an unknown item id");
    }
    const acceptanceEvidence = await request(port, "POST", "/api/admin/acceptance/blufi-new-wifi/evidence", {
      status: "blocked",
      note: "smoke evidence record",
      actor: "smoke",
      source: "smoke-test",
      reference: "local://smoke",
      data: {
        token: "should-not-leak",
        checks: [
          { id: "smoke-check", expected: "blocked", actual: "blocked", passed: true }
        ]
      }
    }, adminHeaders);
    assertOk(acceptanceEvidence, "acceptance evidence");
    if (acceptanceEvidence.body.data.item.status !== "blocked") {
      throw new Error("acceptance evidence did not update item status");
    }
    const updatedAcceptance = await request(port, "GET", "/api/acceptance/status");
    assertOk(updatedAcceptance, "updated acceptance status");
    const blufiAcceptance = updatedAcceptance.body.data.items.find((item) => item.id === "blufi-new-wifi");
    if (blufiAcceptance?.status !== "blocked" || blufiAcceptance.evidenceCount < 1) {
      throw new Error("updated acceptance status did not include recorded evidence");
    }
    if (blufiAcceptance.latestEvidence?.data?.token !== "[redacted]") {
      throw new Error("acceptance evidence did not redact sensitive data");
    }
    const invalidStatus = await request(port, "POST", "/api/admin/acceptance/blufi-new-wifi/evidence", {
      status: "not-a-status",
      note: "invalid status smoke",
      data: { apiKey: "should-not-leak" }
    }, adminHeaders);
    assertOk(invalidStatus, "acceptance invalid status fallback");
    if (invalidStatus.body.data.item.status !== "blocked") {
      throw new Error("invalid acceptance status polluted the current item status");
    }
    if (invalidStatus.body.data.evidence?.data?.apiKey !== "[redacted]") {
      throw new Error("acceptance invalid status evidence did not redact sensitive data");
    }
    const diagnosticsWithAcceptance = await request(port, "GET", "/api/diagnostics/report");
    assertOk(diagnosticsWithAcceptance, "diagnostics acceptance report");
    if (diagnosticsWithAcceptance.body.data.acceptanceStatus?.counts?.total !== 4) {
      throw new Error("diagnostics report did not include acceptance status");
    }
    if (diagnosticsWithAcceptance.body.data.acceptanceReadiness?.counts?.total !== 4) {
      throw new Error("diagnostics report did not include acceptance readiness");
    }
    const packRejected = await request(port, "GET", "/api/admin/acceptance/evidence-pack");
    if (packRejected.status !== 401 || packRejected.body?.ok !== false) {
      throw new Error("acceptance evidence pack did not reject missing token");
    }
    const evidencePack = await request(port, "GET", "/api/admin/acceptance/evidence-pack?items=real-family-content", null, adminHeaders);
    assertOk(evidencePack, "acceptance evidence pack");
    if (!evidencePack.body.data.evidenceDrafts?.["real-family-content"] ||
        evidencePack.body.data.status?.counts?.total !== 4 ||
        evidencePack.body.data.readiness?.counts?.total !== 4 ||
        !Array.isArray(evidencePack.body.data.nextActions?.["real-family-content"])) {
      throw new Error(`acceptance evidence pack shape mismatch: ${JSON.stringify(evidencePack.body.data)}`);
    }
    const nextActionText = JSON.stringify(evidencePack.body.data.nextActions);
    if (!nextActionText.includes("Import non-sample album/podcast/english/game assets.")) {
      throw new Error(`acceptance evidence pack missing real content next action: ${nextActionText}`);
    }
    const blufiPack = await request(port, "GET", "/api/admin/acceptance/evidence-pack?items=blufi-new-wifi", null, adminHeaders);
    assertOk(blufiPack, "acceptance blufi evidence pack");
    if (!JSON.stringify(blufiPack.body.data.nextActions).includes("Use EspBlufi App to provision a new Wi-Fi.")) {
      throw new Error(`acceptance evidence pack missing BluFi next action: ${JSON.stringify(blufiPack.body.data.nextActions)}`);
    }
    const feedCreate = await request(port, "POST", "/api/admin/podcasts/feeds", {
      title: "Smoke Feed",
      url: `http://127.0.0.1:${remoteMediaPort}/feed.xml`
    }, adminHeaders);
    assertOk(feedCreate, "podcast feed create");
    const feedId = feedCreate.body.data.feed.id;
    const feedRefresh = await request(port, "POST", `/api/admin/podcasts/feeds/${feedId}/refresh`, {}, adminHeaders);
    assertOk(feedRefresh, "podcast feed refresh");
    if ((feedRefresh.body.data.episodes || []).length === 0) {
      throw new Error("podcast refresh did not import episodes");
    }
    const refreshAll = await request(port, "POST", "/api/admin/podcasts/refresh-all", { force: true }, adminHeaders);
    assertOk(refreshAll, "podcast refresh all");
    if ((refreshAll.body.data.result.refreshed || []).length === 0) {
      throw new Error("podcast refresh all did not refresh any feeds");
    }
    const podcastEpisodes = await request(port, "GET", "/api/admin/podcasts/episodes", null, adminHeaders);
    assertOk(podcastEpisodes, "podcast episodes");
    const podcastTrack = podcastEpisodes.body.data.episodes.find((item) => item.title.includes("Remote Lullaby"));
    if (!podcastTrack?.id) {
      throw new Error("podcast episode track missing");
    }
    const library = await request(port, "GET", "/api/media/library");
    assertOk(library, "media library");
    if ((library.body.data.podcastEpisodes || []).length === 0 || !library.body.data.queue) {
      throw new Error("media library did not expose podcasts and queue");
    }
    const adminPage = await requestText(port, "/admin");
    if (adminPage.status !== 200 ||
        !adminPage.body.includes("外部验收") ||
        !adminPage.body.includes("ready") ||
        !adminPage.body.includes("导入内容") ||
        !adminPage.body.includes("acceptanceReference") ||
        !adminPage.body.includes("acceptanceData") ||
        !adminPage.body.includes("downloadAcceptancePack") ||
        !adminPage.body.includes("fillAcceptanceDraft") ||
        !adminPage.body.includes("nextActions") ||
        !adminPage.body.includes("evidence-pack?items=") ||
        !adminPage.body.includes("下一步")) {
      throw new Error(`admin page failed or missing acceptance panel: ${adminPage.status}`);
    }
    const companionPage = await requestText(port, "/companion");
    if (companionPage.status !== 200 ||
        !companionPage.body.includes("外部验收") ||
        !companionPage.body.includes("ready") ||
        !companionPage.body.includes("acceptanceReference") ||
        !companionPage.body.includes("acceptanceData") ||
        !companionPage.body.includes("downloadAcceptancePack") ||
        !companionPage.body.includes("fillAcceptanceDraft") ||
        !companionPage.body.includes("nextActions") ||
        !companionPage.body.includes("evidence-pack?items=") ||
        !companionPage.body.includes("下一步")) {
      throw new Error(`companion page failed or missing acceptance panel: ${companionPage.status}`);
    }
    const schema = await request(port, "GET", "/api/admin/database/schema", null, adminHeaders);
    assertOk(schema, "database schema");
    if (process.env.STORE_DRIVER === "sqlite" && schema.body.data.driver !== "sqlite") {
      throw new Error(`sqlite smoke expected sqlite driver, got ${schema.body.data.driver}`);
    }
    if (process.env.STORE_DRIVER === "sqlite") {
      const expectedTables = [
        "schema_migrations",
        "kv",
        "family_members",
        "family_active_members",
        "memories",
        "learning_records",
        "recent_interactions",
        "device_boot_sessions",
        "device_logs",
        "device_commands",
        "media_progress",
        "acceptance_evidence",
        "auth_tokens",
        "security_audit",
        "sync_events",
        "devices"
      ];
      for (const table of expectedTables) {
        if (!Object.prototype.hasOwnProperty.call(schema.body.data.tables || {}, table)) {
          throw new Error(`sqlite schema missing mirror table ${table}: ${JSON.stringify(schema.body.data.tables)}`);
        }
      }
      if (!schema.body.data.migrations?.some((migration) => migration.version === 1 && migration.name === "relational_mirror_tables")) {
        throw new Error(`sqlite migration was not recorded: ${JSON.stringify(schema.body.data.migrations)}`);
      }
      if (!schema.body.data.kvSnapshots?.some((item) => item.key === "state")) {
        throw new Error(`sqlite kv.state snapshot missing: ${JSON.stringify(schema.body.data.kvSnapshots)}`);
      }
      if (schema.body.data.integrity !== "ok" || schema.body.data.mirrorConsistency?.ok !== true) {
        throw new Error(`sqlite integrity or mirror consistency failed: ${JSON.stringify(schema.body.data)}`);
      }
      if (schema.body.data.tables.family_members < 3 || schema.body.data.tables.family_active_members < 3) {
        throw new Error(`sqlite family mirror counts are too low: ${JSON.stringify(schema.body.data.tables)}`);
      }
    }
    assertOk(await request(port, "POST", "/api/devices/register", {
      id: "smoke-device",
      profile: "waveshare-esp32-s3-touch-lcd-1.85b",
      firmware: "2.2.6",
      room: "lab"
    }), "device register");
    assertOk(await request(port, "POST", "/api/device/logs", {
      deviceId: "smoke-device",
      level: "info",
      source: "smoke",
      message: "smoke log"
    }), "device logs");
    assertOk(await request(port, "POST", "/api/device/logs", {
      deviceId: "smoke-heartbeat-device",
      level: "info",
      source: "appshell.heartbeat",
      message: "device heartbeat",
      bootId: "boot-smoke-1",
      bootSequence: 7,
      uptimeSec: 42,
      firmwareBuild: "smoke-build",
      panicSummary: "",
      data: {
        logicalDeviceId: "esp32-185b",
        profile: "waveshare-esp32-s3-touch-lcd-1.85b",
        freeHeap: 42000,
        minimumFreeHeap: 16000,
        freeInternalSram: 12000,
        minimumFreeInternalSram: 9000,
        voiceTurnMetrics: {
          firstPacketToPcmMs: 23,
          droppedDecodePackets: 0,
          droppedFirstPackets: 0
        },
        wakeReason: "smoke wake",
        resetReason: "POWERON_RESET",
        backendProbe: "探针在线",
        board: {
          ssid: "SmokeWiFi",
          ip: "192.168.31.222",
          rssi: -55,
          channel: 6
        },
        status: {
          network: {
            ssid: "SmokeWiFi",
            signal: "strong"
          }
        }
      }
    }), "device heartbeat log");
    const logsAfterHeartbeat = await request(port, "GET", "/api/device/logs");
    assertOk(logsAfterHeartbeat, "device logs after heartbeat");
    const heartbeatLog = logsAfterHeartbeat.body.data.logs[0];
    if (heartbeatLog?.deviceId !== "smoke-heartbeat-device" ||
        heartbeatLog?.data?.board?.ssid !== "SmokeWiFi" ||
        heartbeatLog?.data?.minimumFreeHeap !== 16000 ||
        heartbeatLog?.bootId !== "boot-smoke-1" ||
        heartbeatLog?.bootSequence !== 7 ||
        !heartbeatLog?.requestId) {
      throw new Error("device heartbeat log did not preserve diagnostic data");
    }
    const dashboardAfterHeartbeat = await request(port, "GET", "/api/admin/dashboard", null, adminHeaders);
    assertOk(dashboardAfterHeartbeat, "dashboard after heartbeat");
    const heartbeatDevice = dashboardAfterHeartbeat.body.data.devices.items.find((device) => device.id === "smoke-heartbeat-device");
    if (heartbeatDevice?.ip !== "192.168.31.222" || heartbeatDevice?.ssid !== "SmokeWiFi" || heartbeatDevice?.rssi !== -55) {
      throw new Error(`device heartbeat did not update device registry: ${JSON.stringify(heartbeatDevice)}`);
    }
    const diagnosticsAfterHeartbeat = await request(port, "GET", "/api/diagnostics/report");
    assertOk(diagnosticsAfterHeartbeat, "diagnostics after heartbeat");
    const esp32Status = diagnosticsAfterHeartbeat.body.data.esp32Status;
    if (esp32Status?.network?.ssid !== "SmokeWiFi" ||
        esp32Status?.recentMemory?.minimumFreeHeap !== 16000 ||
        esp32Status?.recentMemory?.freeInternalSram !== 12000 ||
        esp32Status?.recentMemory?.minimumFreeInternalSram !== 9000 ||
        esp32Status?.voiceTurnMetrics?.firstPacketToPcmMs !== 23 ||
        esp32Status?.wakeReason !== "smoke wake" ||
        esp32Status?.bootId !== "boot-smoke-1" ||
        esp32Status?.bootSequence !== 7 ||
        diagnosticsAfterHeartbeat.body.data.bootStatus?.sessionCount < 1) {
      throw new Error(`diagnostics did not expose heartbeat fields: ${JSON.stringify(esp32Status)}`);
    }
    const adminMetrics = await request(port, "GET", "/api/admin/metrics", null, adminHeaders);
    assertOk(adminMetrics, "admin metrics");
    if (!adminMetrics.body.data.http?.requests?.total || !adminMetrics.body.data.commands) {
      throw new Error(`admin metrics missing request or command stats: ${JSON.stringify(adminMetrics.body.data)}`);
    }
    const deviceDiagnostics = await request(port, "GET", "/api/admin/devices/smoke-heartbeat-device/diagnostics", null, adminHeaders);
    assertOk(deviceDiagnostics, "admin device diagnostics");
    if (deviceDiagnostics.body.data.health !== "healthy" ||
        deviceDiagnostics.body.data.bootSessions?.[0]?.id !== "boot-smoke-1" ||
        deviceDiagnostics.body.data.logs?.[0]?.firmwareBuild !== "smoke-build") {
      throw new Error(`admin device diagnostics did not expose boot session: ${JSON.stringify(deviceDiagnostics.body.data)}`);
    }
    if (process.env.STORE_DRIVER === "sqlite") {
      const parallelLogs = await Promise.all(Array.from({ length: 20 }, (_, index) => request(port, "POST", "/api/device/logs", {
        deviceId: "sqlite-parallel-device",
        level: "info",
        source: "sqlite-smoke",
        message: `parallel log ${index}`,
        requestId: `sqlite-smoke-${index}`,
        data: { index }
      })));
      for (const [index, result] of parallelLogs.entries()) {
        assertOk(result, `sqlite parallel device log ${index}`);
      }
      const schemaAfterParallelWrites = await request(port, "GET", "/api/admin/database/schema", null, adminHeaders);
      assertOk(schemaAfterParallelWrites, "sqlite schema after parallel writes");
      if (schemaAfterParallelWrites.body.data.integrity !== "ok" ||
          schemaAfterParallelWrites.body.data.mirrorConsistency?.ok !== true ||
          schemaAfterParallelWrites.body.data.tables.device_logs < 22) {
        throw new Error(`sqlite parallel write verification failed: ${JSON.stringify(schemaAfterParallelWrites.body.data)}`);
      }
    }
    assertOk(await request(port, "POST", "/api/usb/import", {
      path: "cache/smoke-import.txt",
      contentBase64: Buffer.from("smoke import").toString("base64")
    }), "usb import");
    assertOk(await request(port, "DELETE", "/api/resources/file/cache/smoke-import.txt", null, adminHeaders), "resource delete");
    assertOk(await request(port, "POST", "/api/resources/import", {
      path: "music/server/family-production.ogg",
      contentBase64: remoteAudio.toString("base64")
    }, adminHeaders), "production server audio import");
    assertOk(await request(port, "POST", "/api/resources/import", {
      path: "music/server/admin-managed.ogg",
      contentBase64: remoteAudio.toString("base64")
    }, adminHeaders), "server audio import");
    const media = await request(port, "GET", "/api/media/server/tracks");
    assertOk(media, "server media tracks");
    const firstTrack = media.body.data.tracks.find((track) => track.path === "family-production.ogg") || media.body.data.tracks[0];
    if (!firstTrack?.id) {
      throw new Error("server media has no playable track");
    }
    const stream = await requestRaw(port, `/api/media/server/stream/${firstTrack.id}`);
    if (stream.status !== 200 || stream.size <= 0) {
      throw new Error(`server media stream failed: ${stream.status} ${stream.size}`);
    }
    const rangedStream = await requestRaw(port, `/api/media/server/stream/${firstTrack.id}`, { Range: "bytes=0-63" });
    if (rangedStream.status !== 206 || rangedStream.size !== Math.min(64, firstTrack.size)) {
      throw new Error(`server media range failed: ${rangedStream.status} ${rangedStream.size}`);
    }
    if (!String(rangedStream.headers["content-range"] || "").startsWith("bytes 0-")) {
      throw new Error("server media range did not return Content-Range");
    }
    const managedTrack = media.body.data.tracks.find((track) => track.path === "admin-managed.ogg");
    if (!managedTrack) {
      throw new Error("server audio import did not create managed track");
    }
    const renamedTrack = await request(port, "PATCH", `/api/admin/media/server/${managedTrack.id}`, {
      title: "admin managed renamed"
    }, adminHeaders);
    assertOk(renamedTrack, "admin server media rename");
    const renamedId = renamedTrack.body.data.track.id;
    const renamedList = await request(port, "GET", "/api/media/server/tracks");
    assertOk(renamedList, "server media tracks after rename");
    if (!renamedList.body.data.tracks.some((track) => track.id === renamedId && track.path === "admin managed renamed.ogg")) {
      throw new Error("admin server media rename did not update library");
    }
    assertOk(await request(port, "DELETE", `/api/admin/media/server/${renamedId}`, null, adminHeaders), "admin server media delete");
    const afterDeleteTracks = await request(port, "GET", "/api/media/server/tracks");
    assertOk(afterDeleteTracks, "server media tracks after delete");
    if (afterDeleteTracks.body.data.tracks.some((track) => track.id === renamedId)) {
      throw new Error("admin server media delete did not remove track");
    }
    assertOk(await request(port, "POST", "/api/media/server/progress", {
      trackId: firstTrack.id,
      deviceId: "resume-device",
      positionSec: 7,
      durationSec: 60
    }), "server media progress");
    const resumeCandidates = await request(port, "GET", "/api/media/resume?deviceId=resume-device");
    assertOk(resumeCandidates, "media resume candidates");
    if (resumeCandidates.body.data.candidates[0]?.trackId !== firstTrack.id) {
      throw new Error("media resume candidates did not expose unfinished track");
    }
    const resumePlay = await request(port, "POST", "/api/media/resume", {
      deviceId: "resume-device"
    });
    assertOk(resumePlay, "media resume play");
    if (resumePlay.body.data.command?.type !== "media.server.play" || resumePlay.body.data.progress?.positionSec !== 7) {
      throw new Error(`media resume did not create expected play command: ${JSON.stringify(resumePlay.body.data)}`);
    }
    assertOk(await request(port, "POST", `/api/device/commands/${resumePlay.body.data.command.id}/ack`, {
      deviceId: "resume-device",
      status: "accepted",
      message: "resume smoke ack"
    }), "resume device command ack");
    const progressComplete = await request(port, "PATCH", `/api/media/server/progress/${encodeURIComponent(firstTrack.id)}`, {
      deviceId: "resume-device",
      completed: true,
      durationSec: 60
    });
    assertOk(progressComplete, "media progress complete");
    if (!progressComplete.body.data.item.completed || progressComplete.body.data.item.percent !== 100) {
      throw new Error("media progress complete did not mark item completed");
    }
    const resumeAfterComplete = await request(port, "GET", "/api/media/resume?deviceId=resume-device");
    assertOk(resumeAfterComplete, "media resume after complete");
    if ((resumeAfterComplete.body.data.candidates || []).some((item) => item.trackId === firstTrack.id)) {
      throw new Error("completed media still appeared in resume candidates");
    }
    const progressDelete = await request(port, "DELETE", `/api/media/server/progress/${encodeURIComponent(firstTrack.id)}?deviceId=resume-device`);
    assertOk(progressDelete, "media progress delete");
    if (progressDelete.body.data.result.deleted < 1) {
      throw new Error("media progress delete did not remove progress");
    }
    const podcastSearch = await request(port, "GET", "/api/media/search?q=remote%20lullaby%20smoke");
    assertOk(podcastSearch, "podcast search");
    if (podcastSearch.body.data.source !== "podcast") {
      throw new Error(`podcast search expected podcast source, got ${podcastSearch.body.data.source}`);
    }
    const queueAdd = await request(port, "POST", "/api/media/queue", {
      trackId: podcastTrack.id,
      deviceId: "queue-device"
    });
    assertOk(queueAdd, "media queue add");
    const queueAddSecond = await request(port, "POST", "/api/media/queue", {
      trackId: firstTrack.id,
      deviceId: "queue-device"
    });
    assertOk(queueAddSecond, "media queue add second");
    const secondQueueId = queueAddSecond.body.data.item.id;
    const queueMove = await request(port, "PATCH", `/api/media/queue/${secondQueueId}`, {
      direction: "up"
    });
    assertOk(queueMove, "media queue move");
    if (queueMove.body.data.queue.items[0]?.id !== secondQueueId) {
      throw new Error("media queue move did not reorder items");
    }
    const queueRemove = await request(port, "DELETE", `/api/media/queue/${secondQueueId}`);
    assertOk(queueRemove, "media queue remove");
    if (queueRemove.body.data.queue.items.some((item) => item.id === secondQueueId)) {
      throw new Error("media queue remove did not remove item");
    }
    const queuePlay = await request(port, "POST", "/api/media/queue/play", {
      deviceId: "queue-device"
    });
    assertOk(queuePlay, "media queue play");
    if (queuePlay.body.data.command?.type !== "media.server.play") {
      throw new Error(`queue play did not create media.server.play: ${JSON.stringify(queuePlay.body.data)}`);
    }
    assertOk(await request(port, "POST", `/api/device/commands/${queuePlay.body.data.command.id}/ack`, {
      deviceId: "queue-device",
      status: "accepted",
      message: "queue smoke ack"
    }), "queue device command ack");
    const favoriteAdd = await request(port, "POST", "/api/media/favorites", {
      trackId: podcastTrack.id
    });
    assertOk(favoriteAdd, "media favorite add");
    const favoriteId = favoriteAdd.body.data.favorite.id;
    assertOk(await request(port, "DELETE", `/api/media/favorites/${encodeURIComponent(favoriteId)}`), "media favorite delete");
    const queueStop = await request(port, "POST", "/api/media/queue/stop", {
      deviceId: "queue-device"
    });
    assertOk(queueStop, "media queue stop");
    if (queueStop.body.data.command?.type !== "media.server.stop") {
      throw new Error("queue stop did not create media.server.stop");
    }
    const queueClear = await request(port, "POST", "/api/media/queue/clear", {});
    assertOk(queueClear, "media queue clear");
    if ((queueClear.body.data.queue.items || []).length !== 0) {
      throw new Error("media queue clear did not empty queue");
    }
    assertOk(await request(port, "POST", `/api/device/commands/${queueStop.body.data.command.id}/ack`, {
      deviceId: "queue-device",
      status: "accepted",
      message: "queue stop ack"
    }), "queue stop command ack");
    const gateway = await request(port, "POST", "/api/ai/xiaozhi/tool", {
      tool: "family.podcast.play",
      params: { trackId: firstTrack.id, deviceId: "smoke-device" },
      text: "播放服务器播客"
    });
    assertOk(gateway, "xiaozhi tool gateway");
    if (gateway.body.data.command?.type !== "media.server.play") {
      throw new Error(`xiaozhi gateway returned wrong command: ${JSON.stringify(gateway.body.data.command)}`);
    }
    const commandProbe = await request(port, "GET", "/api/events/latest?deviceId=smoke-device");
    assertOk(commandProbe, "events latest command");
    const command = commandProbe.body.data.command;
    if (command?.id !== gateway.body.data.command.id || command?.payload?.track?.id !== firstTrack.id) {
      throw new Error(`events latest missing gateway command: ${JSON.stringify(command)}`);
    }
    assertOk(await request(port, "POST", `/api/device/commands/${command.id}/ack`, {
      deviceId: "smoke-device",
      status: "accepted",
      message: "smoke ack"
    }), "device command ack");
    const afterAck = await request(port, "GET", "/api/device/commands/poll?deviceId=smoke-device");
    assertOk(afterAck, "device command poll after ack");
    if ((afterAck.body.data.commands || []).length !== 0) {
      throw new Error("device command queue did not clear after ack");
    }
    const agentCapabilities = await request(port, "GET", "/api/agent/capabilities");
    assertOk(agentCapabilities, "agent capabilities");
    if (!agentCapabilities.body.data.agents.some((agent) => agent.id === "media") ||
        !agentCapabilities.body.data.agents.some((agent) => agent.id === "device") ||
        !agentCapabilities.body.data.agents.some((agent) => agent.id === "tools") ||
        !agentCapabilities.body.data.tools.some((tool) => tool.name === "family.media.resume") ||
        !agentCapabilities.body.data.tools.some((tool) => tool.name === "family.openclaw.run") ||
        !agentCapabilities.body.data.tools.some((tool) => tool.name === "family.homeassistant.scene") ||
        !agentCapabilities.body.data.tools.some((tool) => tool.name === "family.nas.music.scan")) {
      throw new Error("agent capabilities did not expose media/device tools");
    }
    if (agentCapabilities.body.data.tools.some((tool) => (tool.modes || []).includes("夜间"))) {
      throw new Error("agent capabilities still expose retired night mode");
    }
    assertOk(await request(port, "POST", "/api/device/context", {
      deviceId: "cached-context-device",
      page: "music",
      familyMode: "默认",
      pageState: { currentTrackId: firstTrack.id },
      source: "smoke"
    }), "device page context push");
    const cachedAgent = await request(port, "POST", "/api/agent/ask", {
      traceId: "smoke-context-trace",
      sessionId: "smoke-context-session",
      utterance: "下一集",
      deviceId: "cached-context-device",
      user: { id: "parent", role: "parent" }
    });
    assertOk(cachedAgent, "agent ask from device context cache");
    if (cachedAgent.body.data.contextSource !== "device_cache" ||
        cachedAgent.body.data.page !== "music" ||
        cachedAgent.body.data.traceId !== "smoke-context-trace") {
      throw new Error(`cached page context was not used: ${JSON.stringify(cachedAgent.body.data)}`);
    }
    const cachedAgentAgain = await request(port, "POST", "/api/agent/ask", {
      traceId: "smoke-context-trace",
      sessionId: "smoke-context-session",
      utterance: "下一集",
      deviceId: "cached-context-device",
      user: { id: "parent", role: "parent" }
    });
    assertOk(cachedAgentAgain, "idempotent repeated agent ask");
    const firstCommandId = cachedAgent.body.data.actions?.[0]?.result?.commandId;
    const repeatedCommandId = cachedAgentAgain.body.data.actions?.[0]?.result?.commandId;
    if (!firstCommandId || firstCommandId !== repeatedCommandId) {
      throw new Error(`agent action was not idempotent: ${firstCommandId} ${repeatedCommandId}`);
    }
    assertOk(await request(port, "POST", `/api/device/commands/${firstCommandId}/ack`, {
      deviceId: "cached-context-device",
      status: "accepted",
      message: "idempotency smoke ack"
    }), "idempotent command ack");
    const aiTraces = await request(port, "GET", "/api/admin/ai/traces?limit=10", null, adminHeaders);
    assertOk(aiTraces, "admin ai traces");
    const cachedTrace = aiTraces.body.data.traces.find((trace) => trace.traceId === "smoke-context-trace");
    if (!cachedTrace || cachedTrace.utterance || cachedTrace.timings?.backendMs === undefined) {
      throw new Error(`ai trace privacy/timings mismatch: ${JSON.stringify(cachedTrace)}`);
    }
    const filteredAiTraces = await request(
      port,
      "GET",
      `/api/admin/ai/traces?deviceId=cached-context-device&sessionId=smoke-context-session&from=${encodeURIComponent(new Date(Date.now() - 60000).toISOString())}`,
      null,
      adminHeaders
    );
    assertOk(filteredAiTraces, "filtered admin ai traces");
    if (!filteredAiTraces.body.data.traces.every((trace) =>
      trace.deviceId === "cached-context-device" && trace.sessionId === "smoke-context-session")) {
      throw new Error(`ai trace filters leaked another session: ${JSON.stringify(filteredAiTraces.body.data.traces)}`);
    }
    const recentContext = store.snapshot().memory?.recentContext?.[0] || {};
    if (Object.prototype.hasOwnProperty.call(recentContext, "utterance") ||
        Object.prototype.hasOwnProperty.call(recentContext, "speech")) {
      throw new Error(`conversation text persisted by default: ${JSON.stringify(recentContext)}`);
    }
    const generalFallbackPages = ["home", "weather", "ai", "music", "album", "english", "schedule", "apps", "settings"];
    for (const page of generalFallbackPages) {
      const fallbackDeviceId = `general-fallback-${page}`;
      const fallback = await request(port, "POST", "/api/agent/ask", {
        page,
        utterance: "请解释一下量子纠缠",
        deviceId: fallbackDeviceId,
        user: { id: "parent", role: "parent" }
      });
      assertOk(fallback, `general fallback from ${page}`);
      if (fallback.body.data.handled !== false ||
          fallback.body.data.fallbackReason !== "general_query" ||
          fallback.body.data.actions?.length !== 0) {
        throw new Error(`general query was handled on ${page}: ${JSON.stringify(fallback.body.data)}`);
      }
      const fallbackCommands = await request(port, "GET", `/api/device/commands/poll?deviceId=${fallbackDeviceId}`);
      assertOk(fallbackCommands, `general fallback commands from ${page}`);
      if ((fallbackCommands.body.data.commands || []).length !== 0) {
        throw new Error(`general fallback created a device command on ${page}`);
      }
    }
    const truncatedOpenQuestion = await request(port, "POST", "/api/agent/ask", {
      page: "home",
      utterance: "子纠缠",
      deviceId: "truncated-open-question",
      user: { id: "parent", role: "parent" }
    });
    assertOk(truncatedOpenQuestion, "truncated open question fallback");
    if (truncatedOpenQuestion.body.data.handled !== false ||
        truncatedOpenQuestion.body.data.modelTier !== "complex" ||
        truncatedOpenQuestion.body.data.modelName !== "gpt-5.5" ||
        truncatedOpenQuestion.body.data.intent !== "general.help") {
      throw new Error(`truncated open question was misrouted: ${JSON.stringify(truncatedOpenQuestion.body.data)}`);
    }
    const deviceAgent = await request(port, "POST", "/api/agent/ask", {
      page: "settings",
      utterance: "状态怎么样",
      deviceId: "agent-device",
      user: { id: "parent", role: "parent" }
    });
    assertOk(deviceAgent, "device agent ask");
    if (deviceAgent.body.data.handled !== true ||
        deviceAgent.body.data.agent !== "device" || deviceAgent.body.data.intent !== "device.status") {
      throw new Error(`device agent returned unexpected plan: ${JSON.stringify(deviceAgent.body.data)}`);
    }
    const agentTool = await request(port, "POST", "/api/agent/tools/family.device.status", {
      args: { deviceId: "agent-tool-device" },
      user: { id: "parent", role: "parent" },
      source: "smoke"
    });
    assertOk(agentTool, "agent direct tool");
    if (agentTool.body.data.tool !== "family.device.status") {
      throw new Error("agent direct tool did not execute device status");
    }
    const openClawJobsBefore = await request(port, "GET", "/api/openclaw/jobs");
    assertOk(openClawJobsBefore, "openclaw jobs before tools agent");
    const openClawJobCountBefore = (openClawJobsBefore.body.data.jobs || []).length;
    const parentOpenClawUnconfirmed = await request(port, "POST", "/api/agent/tools/family.openclaw.run", {
      args: { target: "diagnostics" },
      user: { id: "parent", role: "parent" },
      source: "smoke.tools"
    });
    assertOk(parentOpenClawUnconfirmed, "parent openclaw unconfirmed");
    if (!parentOpenClawUnconfirmed.body.data.requiresConfirmation ||
        !parentOpenClawUnconfirmed.body.data.confirmationRequired ||
        parentOpenClawUnconfirmed.body.data.job) {
      throw new Error(`unconfirmed OpenClaw did not require confirmation cleanly: ${JSON.stringify(parentOpenClawUnconfirmed.body.data)}`);
    }
    const openClawJobsAfterUnconfirmed = await request(port, "GET", "/api/openclaw/jobs");
    assertOk(openClawJobsAfterUnconfirmed, "openclaw jobs after unconfirmed");
    if ((openClawJobsAfterUnconfirmed.body.data.jobs || []).length !== openClawJobCountBefore) {
      throw new Error("unconfirmed OpenClaw created a job");
    }
    const parentOpenClawConfirmed = await request(port, "POST", "/api/agent/tools/family.openclaw.run", {
      args: { target: "diagnostics" },
      confirm: true,
      user: { id: "parent", role: "parent" },
      source: "smoke.tools"
    }, { "X-Request-Id": "smoke-openclaw-request" });
    assertOk(parentOpenClawConfirmed, "parent openclaw confirmed");
    const openClawJobsAfterConfirmed = await request(port, "GET", "/api/openclaw/jobs");
    assertOk(openClawJobsAfterConfirmed, "openclaw jobs after confirmed");
    if ((openClawJobsAfterConfirmed.body.data.jobs || []).length !== openClawJobCountBefore + 1 ||
        openClawJobsAfterConfirmed.body.data.jobs[0]?.target !== "diagnostics" ||
        openClawJobsAfterConfirmed.body.data.jobs[0]?.status !== "success" ||
        openClawJobsAfterConfirmed.body.data.jobs[0]?.requestId !== "smoke-openclaw-request") {
      throw new Error(`confirmed OpenClaw did not create a successful diagnostics job: ${JSON.stringify(openClawJobsAfterConfirmed.body.data.jobs?.[0])}`);
    }
    const childOpenClawDenied = await request(port, "POST", "/api/agent/tools/family.openclaw.run", {
      args: { target: "diagnostics" },
      confirm: true,
      user: { id: "child", role: "child" },
      familyMode: "儿童",
      source: "smoke.tools"
    }, { "X-Request-Id": "smoke-denied-request" });
    if (childOpenClawDenied.status !== 403 || childOpenClawDenied.body?.ok !== false) {
      throw new Error(`child OpenClaw was not denied: ${childOpenClawDenied.status} ${JSON.stringify(childOpenClawDenied.body)}`);
    }
    const policyAfterChildOpenClaw = await request(port, "GET", "/api/family/policies");
    assertOk(policyAfterChildOpenClaw, "policy after child openclaw");
    if (!policyAfterChildOpenClaw.body.data.recentAudit.some((item) =>
      item.action === "openclaw.run" &&
      item.memberId === "child" &&
      item.status === "denied" &&
      item.requestId === "smoke-denied-request")) {
      throw new Error("child OpenClaw denial did not create audit entry");
    }
    const integrationsBeforeHa = await request(port, "GET", "/api/integrations/status");
    assertOk(integrationsBeforeHa, "integrations before ha tool");
    const haHistoryBefore = integrationsBeforeHa.body.data.homeAssistant.history.length;
    const parentHaScene = await request(port, "POST", "/api/agent/tools/family.homeassistant.scene", {
      args: { entityId: "scene.family" },
      confirm: true,
      user: { id: "parent", role: "parent" },
      source: "smoke.tools"
    }, { "X-Request-Id": "smoke-ha-request" });
    assertOk(parentHaScene, "parent ha scene confirmed");
    const integrationsAfterHa = await request(port, "GET", "/api/integrations/status");
    assertOk(integrationsAfterHa, "integrations after ha tool");
    const haRecord = integrationsAfterHa.body.data.homeAssistant.history[0];
    if (integrationsAfterHa.body.data.homeAssistant.history.length !== haHistoryBefore + 1 ||
        haRecord?.domain !== "scene" ||
        haRecord?.serviceData?.entity_id !== "scene.family" ||
        haRecord?.status !== "success" ||
        haRecord?.httpCode !== 200 ||
        haRecord?.requestId !== "smoke-ha-request") {
      throw new Error(`confirmed HA scene did not record action: ${JSON.stringify(integrationsAfterHa.body.data.homeAssistant.history)}`);
    }
    const homeAssistantCalls = fs.existsSync(homeAssistantCallsFile)
      ? fs.readFileSync(homeAssistantCallsFile, "utf8").trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line))
      : [];
    if (homeAssistantCalls.length < 1 ||
        homeAssistantCalls[homeAssistantCalls.length - 1].auth !== "Bearer smoke-ha-token" ||
        homeAssistantCalls[homeAssistantCalls.length - 1].body.entity_id !== "scene.family") {
      throw new Error(`mock HA did not receive the expected call: ${JSON.stringify(homeAssistantCalls)}`);
    }
    const toolsAgent = await request(port, "POST", "/api/agent/ask", {
      page: "apps",
      utterance: "扫描 NAS",
      deviceId: "tools-agent-device",
      user: { id: "parent", role: "parent" }
    });
    assertOk(toolsAgent, "tools agent apps page");
    if (toolsAgent.body.data.agent !== "tools" ||
        toolsAgent.body.data.actions?.[0]?.tool !== "family.nas.music.scan") {
      throw new Error(`apps page did not route to Tools Agent NAS scan: ${JSON.stringify(toolsAgent.body.data)}`);
    }
    // Xiaomi/XiaoAi speaker control through Home Assistant.
    const speakerCommand = await request(port, "POST", "/api/agent/tools/family.speaker.command", {
      args: { text: "播放周杰伦的歌" },
      user: { id: "parent", role: "parent" },
      source: "smoke.speaker"
    });
    assertOk(speakerCommand, "speaker command tool");
    if (speakerCommand.body.data.tool !== "family.speaker.command" ||
        speakerCommand.body.data.record?.status !== "success" ||
        speakerCommand.body.data.record?.serviceData?.execute !== true ||
        speakerCommand.body.data.record?.serviceData?.entity_id !== "media_player.smoke_speaker" ||
        speakerCommand.body.data.record?.serviceData?.text !== "播放周杰伦的歌") {
      throw new Error(`speaker command did not call HA correctly: ${JSON.stringify(speakerCommand.body.data.record)}`);
    }
    const speakerVolume = await request(port, "POST", "/api/agent/tools/family.speaker.volume", {
      args: { level: 40 },
      user: { id: "parent", role: "parent" },
      source: "smoke.speaker"
    });
    assertOk(speakerVolume, "speaker volume tool");
    if (speakerVolume.body.data.record?.service !== "volume_set" ||
        speakerVolume.body.data.record?.serviceData?.volume_level !== 0.4) {
      throw new Error(`speaker volume did not normalize percentage: ${JSON.stringify(speakerVolume.body.data.record)}`);
    }
    const speakerRoute = await request(port, "POST", "/api/agent/ask", {
      page: "apps",
      utterance: "让小爱播放周杰伦的歌",
      user: { id: "parent", role: "parent" }
    });
    assertOk(speakerRoute, "speaker route apps");
    if (speakerRoute.body.data.agent !== "tools" ||
        speakerRoute.body.data.actions?.[0]?.tool !== "family.speaker.command") {
      throw new Error(`apps page did not route to speaker command: ${JSON.stringify(speakerRoute.body.data)}`);
    }
    const speakerVolumeRoute = await request(port, "POST", "/api/agent/ask", {
      page: "apps",
      utterance: "把音箱音量调到 50",
      user: { id: "parent", role: "parent" }
    });
    assertOk(speakerVolumeRoute, "speaker volume route");
    if (speakerVolumeRoute.body.data.actions?.[0]?.tool !== "family.speaker.volume" ||
        speakerVolumeRoute.body.data.actions?.[0]?.result?.reason) {
      throw new Error(`apps page did not route to speaker volume: ${JSON.stringify(speakerVolumeRoute.body.data)}`);
    }
    const childSpeakerDenied = await request(port, "POST", "/api/agent/tools/family.speaker.command", {
      args: { text: "播放音乐" },
      user: { id: "child", role: "child" },
      familyMode: "儿童"
    });
    if (childSpeakerDenied.status !== 403 || childSpeakerDenied.body?.ok !== false) {
      throw new Error(`child speaker command was not denied: ${childSpeakerDenied.status} ${JSON.stringify(childSpeakerDenied.body)}`);
    }
    if (!agentCapabilities.body.data.tools.some((tool) => tool.name === "family.speaker.command") ||
        !agentCapabilities.body.data.tools.some((tool) => tool.name === "family.speaker.volume")) {
      throw new Error("agent capabilities did not expose speaker tools");
    }
    assertOk(await request(port, "POST", "/api/media/server/progress", {
      trackId: firstTrack.id,
      deviceId: "agent-media-device",
      positionSec: 11,
      durationSec: 60
    }), "agent media progress");
    const mediaAgent = await request(port, "POST", "/api/agent/ask", {
      page: "music",
      utterance: "继续",
      deviceId: "agent-media-device",
      user: { id: "child", role: "child" },
      familyMode: "儿童"
    });
    assertOk(mediaAgent, "media agent resume");
    if (mediaAgent.body.data.agent !== "media" ||
        mediaAgent.body.data.actions?.[0]?.tool !== "family.media.resume" ||
        mediaAgent.body.data.actions?.[0]?.result?.command?.type !== "media.server.play") {
      throw new Error(`media agent did not create resume command: ${JSON.stringify(mediaAgent.body.data)}`);
    }
    assertOk(await request(port, "POST", `/api/device/commands/${mediaAgent.body.data.actions[0].result.command.id}/ack`, {
      deviceId: "agent-media-device",
      status: "accepted",
      message: "agent smoke ack"
    }), "agent media command ack");
    const routerAgent = await request(port, "POST", "/api/agent/ask", {
      page: "ai",
      utterance: "设备状态怎么样",
      deviceId: "router-device",
      user: { id: "parent", role: "parent" }
    });
    assertOk(routerAgent, "router agent to device");
    if (routerAgent.body.data.agent !== "device" || routerAgent.body.data.handoff?.to !== "device") {
      throw new Error(`router did not hand off to device: ${JSON.stringify(routerAgent.body.data)}`);
    }
    const weatherAgent = await request(port, "POST", "/api/agent/ask", {
      page: "weather",
      utterance: "今天怎么样",
      deviceId: "weather-device",
      user: { id: "guest", role: "guest" },
      familyMode: "访客"
    });
    assertOk(weatherAgent, "weather agent");
    if (weatherAgent.body.data.agent !== "weather" || weatherAgent.body.data.intent !== "weather.today") {
      throw new Error(`weather agent returned unexpected result: ${JSON.stringify(weatherAgent.body.data)}`);
    }
    const scheduleAgent = await request(port, "POST", "/api/agent/ask", {
      page: "schedule",
      utterance: "今天有什么安排",
      deviceId: "schedule-device",
      user: { id: "child", role: "child" },
      familyMode: "儿童"
    });
    assertOk(scheduleAgent, "schedule agent today");
    if (scheduleAgent.body.data.agent !== "schedule" || scheduleAgent.body.data.actions?.[0]?.tool !== "family.schedule.today") {
      throw new Error(`schedule agent did not return today's schedule: ${JSON.stringify(scheduleAgent.body.data)}`);
    }
    const scheduleTodayBefore = await request(port, "POST", "/api/agent/tools/family.schedule.today", {
      user: { id: "parent", role: "parent" }
    });
    assertOk(scheduleTodayBefore, "schedule today before add");
    const scheduleCountBefore = (scheduleTodayBefore.body.data.result?.today || []).length;
    const scheduleAddAgent = await request(port, "POST", "/api/agent/ask", {
      page: "schedule",
      utterance: "提醒我下午三点收快递",
      deviceId: "schedule-device",
      user: { id: "parent", role: "parent" }
    });
    assertOk(scheduleAddAgent, "schedule agent add");
    if (scheduleAddAgent.body.data.actions?.[0]?.tool !== "family.schedule.add") {
      throw new Error(`schedule add did not use family.schedule.add: ${JSON.stringify(scheduleAddAgent.body.data)}`);
    }
    if (scheduleAddAgent.body.data.actions?.[0]?.status !== "accepted") {
      throw new Error(`schedule add was not accepted: ${JSON.stringify(scheduleAddAgent.body.data)}`);
    }
    const scheduleTodayAfter = await request(port, "POST", "/api/agent/tools/family.schedule.today", {
      user: { id: "parent", role: "parent" }
    });
    assertOk(scheduleTodayAfter, "schedule today after add");
    const scheduleItemsAfter = scheduleTodayAfter.body.data.result?.today || [];
    if (scheduleItemsAfter.length !== scheduleCountBefore + 1) {
      throw new Error(`schedule add did not grow today's list: before=${scheduleCountBefore} after=${scheduleItemsAfter.length}`);
    }
    if (!scheduleItemsAfter.some((item) => item.title === "下午三点收快递" || item.title.includes("收快递"))) {
      throw new Error(`schedule add title missing from list: ${JSON.stringify(scheduleItemsAfter)}`);
    }
    const childScheduleAddDenied = await request(port, "POST", "/api/agent/tools/family.schedule.add", {
      args: { title: "偷偷加个日程" },
      user: { id: "child", role: "child" },
      familyMode: "儿童"
    });
    if (childScheduleAddDenied.body.ok !== false) {
      throw new Error(`child schedule add should be denied by policy: ${JSON.stringify(childScheduleAddDenied.body)}`);
    }
    const scheduleCompleteAgent = await request(port, "POST", "/api/agent/ask", {
      page: "schedule",
      utterance: "完成",
      deviceId: "schedule-device",
      user: { id: "child", role: "child" },
      familyMode: "儿童"
    });
    assertOk(scheduleCompleteAgent, "schedule agent complete");
    if (scheduleCompleteAgent.body.data.actions?.[0]?.tool !== "family.schedule.complete") {
      throw new Error("schedule complete did not use family.schedule.complete");
    }
    const scheduleRouter = await request(port, "POST", "/api/agent/ask", {
      page: "ai",
      utterance: "今天有什么日程",
      deviceId: "schedule-router-device",
      user: { id: "parent", role: "parent" }
    });
    assertOk(scheduleRouter, "router agent to schedule");
    if (scheduleRouter.body.data.agent !== "schedule" || scheduleRouter.body.data.handoff?.to !== "schedule") {
      throw new Error(`router did not hand off to schedule: ${JSON.stringify(scheduleRouter.body.data)}`);
    }
    const englishAgent = await request(port, "POST", "/api/agent/ask", {
      page: "english",
      utterance: "开始口语练习",
      deviceId: "english-device",
      user: { id: "child", role: "child" },
      familyMode: "儿童"
    });
    assertOk(englishAgent, "english agent start");
    if (englishAgent.body.data.agent !== "english" || englishAgent.body.data.actions?.[0]?.tool !== "family.english.start") {
      throw new Error(`english agent did not start practice: ${JSON.stringify(englishAgent.body.data)}`);
    }
    // english.record must route from a "答对N句" utterance and persist that
    // specific count. Use 4 (not the start branch's auto-increment) so a stub
    // that ignored `correct` would leave progress at something other than 4/5.
    const learningBeforeRecord = await request(port, "GET", "/api/learning/records");
    assertOk(learningBeforeRecord, "learning records before english.record");
    const learningCountBefore = (learningBeforeRecord.body.data.records || []).length;
    const englishRecord = await request(port, "POST", "/api/agent/ask", {
      page: "english",
      utterance: "答对4句",
      deviceId: "english-device",
      user: { id: "child", role: "child" },
      familyMode: "儿童"
    });
    assertOk(englishRecord, "english agent record");
    if (englishRecord.body.data.actions?.[0]?.tool !== "family.english.record") {
      throw new Error(`english record did not route to family.english.record: ${JSON.stringify(englishRecord.body.data)}`);
    }
    if (englishRecord.body.data.actions?.[0]?.status !== "accepted") {
      throw new Error(`english record was not accepted: ${JSON.stringify(englishRecord.body.data)}`);
    }
    const englishStatusAfter = await request(port, "POST", "/api/agent/tools/family.english.status", {
      user: { id: "child", role: "child" },
      familyMode: "儿童"
    });
    assertOk(englishStatusAfter, "english status after record");
    if (englishStatusAfter.body.data.result?.english?.progress !== "4/5") {
      throw new Error(`english record did not persist correct count 4/5: ${JSON.stringify(englishStatusAfter.body.data.result?.english)}`);
    }
    const learningAfterRecord = await request(port, "GET", "/api/learning/records");
    assertOk(learningAfterRecord, "learning records after english.record");
    if ((learningAfterRecord.body.data.records || []).length !== learningCountBefore + 1) {
      throw new Error(`english record did not add exactly one learning record: before=${learningCountBefore} after=${(learningAfterRecord.body.data.records || []).length}`);
    }
    const albumAgent = await request(port, "POST", "/api/agent/ask", {
      page: "album",
      utterance: "打开屏保",
      deviceId: "album-device",
      user: { id: "child", role: "child" },
      familyMode: "儿童"
    });
    assertOk(albumAgent, "album agent slideshow");
    if (albumAgent.body.data.agent !== "album" || albumAgent.body.data.actions?.[0]?.tool !== "family.album.slideshow_start") {
      throw new Error(`album agent did not start slideshow: ${JSON.stringify(albumAgent.body.data)}`);
    }
    const childDirectUrl = await request(port, "POST", "/api/agent/ask", {
      page: "music",
      utterance: `播放 http://127.0.0.1:${remoteMediaPort}/remote-lullaby.mp3`,
      deviceId: "child-device",
      user: { id: "child", role: "child" },
      familyMode: "儿童"
    });
    if (childDirectUrl.status !== 403 || childDirectUrl.body?.ok !== false) {
      throw new Error("child mode did not reject direct external media url");
    }
    const guestMemory = await request(port, "POST", "/api/agent/ask", {
      page: "ai",
      utterance: "记住孩子喜欢恐龙故事",
      deviceId: "guest-device",
      user: { id: "guest", role: "guest" },
      familyMode: "访客"
    });
    if (guestMemory.status !== 403 || guestMemory.body?.ok !== false) {
      throw new Error("guest mode did not reject memory write");
    }
    assertOk(await request(port, "PATCH", "/api/admin/family/members/guest", {
      memoryPolicy: { enabled: true, includeFamilyMemory: true, includeLearning: true }
    }, adminHeaders), "guest memory policy hardening setup");
    assertOk(await request(port, "POST", "/api/memory", {
      text: "访客不应看到这条记忆",
      memberId: "guest",
      visibility: "private",
      kind: "fact"
    }, adminHeaders), "guest private memory setup");
    const guestContext = await request(port, "GET", `/api/admin/family/members/guest/context?query=${encodeURIComponent("访客")}`, null, adminHeaders);
    assertOk(guestContext, "guest member context");
    if ((guestContext.body.data.memory || []).length !== 0 || (guestContext.body.data.learning || []).length !== 0) {
      throw new Error(`guest context leaked memory or learning: ${JSON.stringify(guestContext.body.data)}`);
    }
    // Content recommendation must win over the "故事" media keyword because the
    // cross-cutting "推荐" intent takes priority in pickDefaultAgent.
    const contentRecommend = await request(port, "POST", "/api/agent/ask", {
      page: "ai",
      utterance: "给孩子推荐一个睡前故事",
      deviceId: "recommend-device",
      user: { id: "child", role: "child" },
      familyMode: "儿童"
    });
    assertOk(contentRecommend, "content recommend routing");
    if (contentRecommend.body.data.intent !== "content.recommend" ||
        contentRecommend.body.data.actions?.[0]?.tool !== "family.content.recommend") {
      throw new Error(`content recommend did not route correctly: ${JSON.stringify(contentRecommend.body.data)}`);
    }
    const memorySearch = await request(port, "POST", "/api/agent/ask", {
      page: "ai",
      utterance: "查一下家庭记忆",
      deviceId: "memory-search-device",
      user: { id: "parent", role: "parent" }
    });
    assertOk(memorySearch, "memory search routing");
    if (memorySearch.body.data.intent !== "memory.search" ||
        memorySearch.body.data.actions?.[0]?.tool !== "family.memory.search") {
      throw new Error(`memory search did not route correctly: ${JSON.stringify(memorySearch.body.data)}`);
    }
    const homeAgent = await request(port, "POST", "/api/agent/ask", {
      page: "home",
      utterance: "现在家里什么情况",
      deviceId: "home-device",
      user: { id: "parent", role: "parent" }
    });
    assertOk(homeAgent, "home agent overview");
    if (homeAgent.body.data.agent !== "home" ||
        homeAgent.body.data.actions?.[0]?.tool !== "family.home.overview") {
      throw new Error(`home agent did not return overview: ${JSON.stringify(homeAgent.body.data)}`);
    }
    // Home agent still hands off specific domains instead of only overviewing.
    const homeHandoff = await request(port, "POST", "/api/agent/ask", {
      page: "home",
      utterance: "今天天气怎么样",
      deviceId: "home-device",
      user: { id: "parent", role: "parent" }
    });
    assertOk(homeHandoff, "home agent handoff to weather");
    if (homeHandoff.body.data.actions?.[0]?.tool !== "family.weather.today" ||
        homeHandoff.body.data.handoff?.to !== "weather") {
      throw new Error(`home agent did not hand off to weather: ${JSON.stringify(homeHandoff.body.data)}`);
    }
    const agentCapabilitiesHome = await request(port, "GET", "/api/agent/capabilities");
    assertOk(agentCapabilitiesHome, "agent capabilities home");
    if (!agentCapabilitiesHome.body.data.agents.some((agent) => agent.id === "home") ||
        !agentCapabilitiesHome.body.data.tools.some((tool) => tool.name === "family.home.overview") ||
        !agentCapabilitiesHome.body.data.tools.some((tool) => tool.name === "family.content.recommend") ||
        !agentCapabilitiesHome.body.data.tools.some((tool) => tool.name === "family.memory.search")) {
      throw new Error("agent capabilities did not expose home agent and new tools");
    }
    const mcpRuntime = {
      version: config.version,
      backendUrl: `http://127.0.0.1:${port}`,
      toolToken: ""
    };
    const mcpList = await handleMcpRequest(mcpRuntime, {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list"
    });
    if (!mcpList?.result?.tools?.some((tool) => tool.name === "family.podcast.play")) {
      throw new Error("mcp bridge did not expose family.podcast.play");
    }
    if (!mcpList?.result?.tools?.some((tool) => tool.name === "family.podcast.favorite")) {
      throw new Error("mcp bridge did not expose family.podcast.favorite");
    }
    if (!mcpList?.result?.tools?.some((tool) => tool.name === "family.podcast.resume")) {
      throw new Error("mcp bridge did not expose family.podcast.resume");
    }
    if (!mcpList?.result?.tools?.some((tool) => tool.name === "family.agent.ask")) {
      throw new Error("mcp bridge did not expose family.agent.ask");
    }
    for (const speakerTool of ["family.speaker.say", "family.speaker.command", "family.speaker.volume"]) {
      if (!mcpList?.result?.tools?.some((tool) => tool.name === speakerTool)) {
        throw new Error(`mcp bridge did not expose ${speakerTool}`);
      }
    }
    // Xiaozhi can drive the Xiaomi speaker directly through an explicit MCP tool
    // (goes to /api/agent/tools/family.speaker.command -> Home Assistant).
    const mcpSpeakerCall = await handleMcpRequest(mcpRuntime, {
      jsonrpc: "2.0",
      id: 21,
      method: "tools/call",
      params: {
        name: "family.speaker.command",
        arguments: {
          text: "播放周杰伦的歌",
          deviceId: "mcp-speaker-device"
        }
      }
    });
    if (mcpSpeakerCall?.error || !String(mcpSpeakerCall?.result?.content?.[0]?.text || "").includes("音箱")) {
      throw new Error(`mcp speaker command failed: ${JSON.stringify(mcpSpeakerCall)}`);
    }
    const mcpCall = await handleMcpRequest(mcpRuntime, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "family.podcast.play",
        arguments: {
          trackId: firstTrack.id,
          deviceId: "mcp-device",
          text: "播放服务器播客"
        }
      }
    });
    if (mcpCall?.error || !String(mcpCall?.result?.content?.[0]?.text || "").includes("开始播放")) {
      throw new Error(`mcp tool call failed: ${JSON.stringify(mcpCall)}`);
    }
    const mcpCommandProbe = await request(port, "GET", "/api/events/latest?deviceId=mcp-device");
    assertOk(mcpCommandProbe, "mcp command probe");
    const mcpCommand = mcpCommandProbe.body.data.command;
    if (mcpCommand?.type !== "media.server.play" || mcpCommand?.payload?.track?.id !== firstTrack.id) {
      throw new Error(`mcp bridge did not create expected device command: ${JSON.stringify(mcpCommand)}`);
    }
    assertOk(await request(port, "POST", `/api/device/commands/${mcpCommand.id}/ack`, {
      deviceId: "mcp-device",
      status: "accepted",
      message: "mcp smoke ack"
    }), "mcp device command ack");
    assertOk(await request(port, "POST", "/api/media/server/progress", {
      trackId: firstTrack.id,
      deviceId: "mcp-agent-device",
      positionSec: 13,
      durationSec: 60
    }), "mcp agent progress");
    const mcpAgentCall = await handleMcpRequest(mcpRuntime, {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "family.agent.ask",
        arguments: {
          page: "music",
          text: "继续",
          deviceId: "mcp-agent-device",
          role: "child",
          familyMode: "儿童"
        }
      }
    });
    if (mcpAgentCall?.error || !String(mcpAgentCall?.result?.content?.[0]?.text || "").includes("继续播放")) {
      throw new Error(`mcp agent call failed: ${JSON.stringify(mcpAgentCall)}`);
    }
    const mcpAgentProbe = await request(port, "GET", "/api/events/latest?deviceId=mcp-agent-device");
    assertOk(mcpAgentProbe, "mcp agent command probe");
    if (mcpAgentProbe.body.data.command?.type !== "media.server.play") {
      throw new Error(`mcp agent did not create media.server.play: ${JSON.stringify(mcpAgentProbe.body.data.command)}`);
    }
    assertOk(await request(port, "POST", `/api/device/commands/${mcpAgentProbe.body.data.command.id}/ack`, {
      deviceId: "mcp-agent-device",
      status: "accepted",
      message: "mcp agent smoke ack"
    }), "mcp agent command ack");
    const onlineGateway = await request(port, "POST", "/api/ai/xiaozhi/tool", {
      tool: "family.media.play",
      params: { query: "remote lullaby smoke", deviceId: "online-device" },
      text: "播放 remote lullaby smoke"
    });
    assertOk(onlineGateway, "xiaozhi online media fallback");
    const onlineTrack = onlineGateway.body.data.track;
    if (onlineGateway.body.data.command?.type !== "media.server.play" || onlineTrack?.origin !== "online" || onlineTrack?.provider !== "rss") {
      throw new Error(`online fallback returned unexpected track: ${JSON.stringify(onlineGateway.body.data)}`);
    }
    const onlineStream = await requestRaw(port, `/api/media/online/stream/${onlineTrack.id}`);
    if (onlineStream.status !== 200 || onlineStream.size !== remoteAudio.length) {
      throw new Error(`online media proxy failed: ${onlineStream.status} ${onlineStream.size}`);
    }
    assertOk(await request(port, "POST", `/api/device/commands/${onlineGateway.body.data.command.id}/ack`, {
      deviceId: "online-device",
      status: "accepted",
      message: "online smoke ack"
    }), "online device command ack");
    const catalogAdd = await request(port, "POST", "/api/admin/media/catalog", {
      title: "Catalog Remote Lullaby",
      artist: "Smoke Radio",
      remoteUrl: `http://127.0.0.1:${remoteMediaPort}/remote-lullaby.mp3`
    }, adminHeaders);
    assertOk(catalogAdd, "admin catalog add");
    const catalogId = catalogAdd.body.data.item.id;
    const adminCommand = await request(port, "POST", "/api/admin/media/command", {
      tool: "family.media.play",
      query: "catalog remote lullaby",
      deviceId: "admin-device"
    }, adminHeaders);
    assertOk(adminCommand, "admin media command");
    if (adminCommand.body.data.command?.type !== "media.server.play") {
      throw new Error(`admin media command returned wrong command: ${JSON.stringify(adminCommand.body.data.command)}`);
    }
    assertOk(await request(port, "POST", `/api/device/commands/${adminCommand.body.data.command.id}/ack`, {
      deviceId: "admin-device",
      status: "accepted",
      message: "admin smoke ack"
    }), "admin device command ack");
    assertOk(await request(port, "DELETE", `/api/admin/media/catalog/${catalogId}`, null, adminHeaders), "admin catalog delete");
    assertOk(await request(port, "POST", "/api/action", {
      type: "action.call",
      name: "music.server.cache",
      params: {}
    }), "server media cache action");
    assertOk(await request(port, "GET", "/api/sync/pull"), "sync pull");
    assertOk(await request(port, "POST", "/api/sync/push", {
      schema: 1,
      deviceId: "smoke",
      events: [
        {
          id: "evt_smoke",
          type: "smoke.test",
          createdAt: new Date().toISOString(),
          payload: { ok: true }
        }
      ]
    }), "sync push");
    assertOk(await request(port, "POST", "/api/action", {
      type: "action.call",
      name: "music.set_source",
      params: { source: "server" }
    }), "set source");
    assertOk(await request(port, "POST", "/api/action", {
      type: "action.call",
      name: "music.server.next",
      params: {}
    }), "server next");
    assertOk(await request(port, "POST", "/api/action", {
      type: "action.call",
      name: "english.start",
      params: {}
    }), "english start");
    const learning = await request(port, "GET", "/api/learning/records");
    assertOk(learning, "learning records");
    if ((learning.body.data.records || []).length === 0) {
      throw new Error("english.start did not create a learning record");
    }
    assertOk(await request(port, "POST", "/api/action", {
      type: "action.call",
      name: "homeassistant.scene",
      params: { entityId: "scene.family" }
    }), "home assistant scene");
    assertOk(await request(port, "POST", "/api/action", {
      type: "action.call",
      name: "nas.music.scan",
      params: {}
    }), "nas scan");
    assertOk(await request(port, "POST", "/api/action", {
      type: "action.call",
      name: "family.member.status",
      params: { id: "child", status: "learning" }
    }), "family member status");
    const adminMember = await request(port, "POST", "/api/admin/family/members", {
      id: "mom",
      name: "妈妈",
      role: "parent",
      relationship: "妈妈",
      status: "home",
      profile: {
        preferredName: "妈妈",
        ageGroup: "adult",
        interests: ["绘本", "健康"],
        avoidTopics: ["惊悚"]
      },
      persona: {
        assistantName: "小智",
        addressAs: "妈妈",
        tone: "自然、细致、可靠",
        verbosity: "balanced",
        traits: ["耐心", "细致"],
        instructions: "避免使用英文缩写。"
      },
      memoryPolicy: {
        enabled: true,
        maxContextItems: 6,
        includeFamilyMemory: true,
        includeLearning: true,
        retentionDays: 180
      }
    }, adminHeaders);
    assertOk(adminMember, "admin family member create");
    if (adminMember.body.data.member.profile?.preferredName !== "妈妈" ||
        adminMember.body.data.member.relationship !== "妈妈" ||
        adminMember.body.data.member.profileVersion !== 1 ||
        !adminMember.body.data.member.createdAt ||
        adminMember.body.data.member.persona?.tone !== "自然、细致、可靠" ||
        adminMember.body.data.member.memoryPolicy?.maxContextItems !== 6) {
      throw new Error(`admin member profile did not persist: ${JSON.stringify(adminMember.body.data.member)}`);
    }
    const updatedMom = await request(port, "PATCH", "/api/admin/family/members/mom", {
      notes: "updated by smoke"
    }, adminHeaders);
    assertOk(updatedMom, "admin family member update");
    if (updatedMom.body.data.member.profileVersion !== 2 || updatedMom.body.data.member.notes !== "updated by smoke") {
      throw new Error(`admin member profileVersion did not increment: ${JSON.stringify(updatedMom.body.data.member)}`);
    }
    assertOk(await request(port, "POST", "/api/admin/family/members", {
      id: "archive-parent",
      name: "Archive Parent",
      role: "parent",
      relationship: "监护人"
    }, adminHeaders), "create member for archive");
    const exportedArchiveParent = await request(port, "GET", "/api/admin/family/members/archive-parent/export", null, adminHeaders);
    assertOk(exportedArchiveParent, "export family member");
    if (exportedArchiveParent.body.data.member?.id !== "archive-parent" || !Array.isArray(exportedArchiveParent.body.data.memory)) {
      throw new Error("family member export shape is incomplete");
    }
    const archivedParent = await request(port, "POST", "/api/admin/family/members/archive-parent/archive", {}, adminHeaders);
    assertOk(archivedParent, "archive family member");
    if (!archivedParent.body.data.member?.archivedAt) throw new Error("archived member has no archivedAt");
    const publicAfterArchive = await request(port, "GET", "/api/family/members");
    if (publicAfterArchive.body.data.members.some((member) => member.id === "archive-parent")) {
      throw new Error("archived member leaked into public family members");
    }
    assertOk(await request(port, "DELETE", "/api/admin/family/members/archive-parent", {
      confirmId: "archive-parent",
      memoryAction: "retain"
    }, adminHeaders), "delete archived member");
    const secondChild = await request(port, "POST", "/api/admin/family/members", {
      id: "child2",
      name: "二宝",
      role: "child",
      relationship: "孩子",
      status: "home",
      profile: { preferredName: "二宝", ageGroup: "child", interests: ["恐龙"] },
      persona: { addressAs: "二宝", tone: "活泼、耐心、鼓励", traits: ["鼓励", "活泼"] },
      memoryPolicy: { enabled: true, maxContextItems: 5, includeFamilyMemory: true, includeLearning: true, retentionDays: 365 }
    }, adminHeaders);
    assertOk(secondChild, "second child member create");
    assertOk(await request(port, "PATCH", "/api/admin/family/active-member", {
      mode: "默认",
      memberId: "mom"
    }, adminHeaders), "set active parent member");
    assertOk(await request(port, "PATCH", "/api/admin/family/active-member", {
      mode: "儿童",
      memberId: "child2"
    }, adminHeaders), "set active child member");
    const familyWithActiveMembers = await request(port, "GET", "/api/family/members");
    assertOk(familyWithActiveMembers, "family active members");
    if (familyWithActiveMembers.body.data.activeMembers?.["默认"] !== "mom" ||
        familyWithActiveMembers.body.data.activeMembers?.["儿童"] !== "child2" ||
        !familyWithActiveMembers.body.data.members.some((member) => member.id === "parent" && member.profileVersion >= 1 && member.relationship)) {
      throw new Error(`active members not persisted: ${JSON.stringify(familyWithActiveMembers.body.data)}`);
    }
    const guestModeNonGuest = await request(port, "PATCH", "/api/admin/family/active-member", {
      mode: "访客",
      memberId: "mom"
    }, adminHeaders);
    if (guestModeNonGuest.status !== 400 || guestModeNonGuest.body?.ok !== false) {
      throw new Error("guest mode accepted a non-guest active member");
    }
    const momMemory = await request(port, "POST", "/api/memory", {
      text: "妈妈喜欢细致的家庭摘要",
      memberId: "mom",
      visibility: "private",
      kind: "preference",
      importance: 5,
      tags: ["summary"]
    }, adminHeaders);
    assertOk(momMemory, "mom private memory");
    const momAgent = await request(port, "POST", "/api/agent/ask", {
      page: "settings",
      utterance: "状态怎么样",
      deviceId: "mom-device",
      user: { id: "device" },
      familyMode: "默认"
    });
    assertOk(momAgent, "active parent member context");
    if (momAgent.body.data.memberContext?.member?.id !== "mom" ||
        momAgent.body.data.memberContext?.member?.role !== "parent" ||
        momAgent.body.data.memberContext?.responseGuidance?.addressAs !== "妈妈" ||
        !momAgent.body.data.memberContext?.memory?.some((item) => item.text === "妈妈喜欢细致的家庭摘要") ||
        !String(momAgent.body.data.speech || "").startsWith("妈妈，")) {
      throw new Error(`default mode did not resolve active parent profile: ${JSON.stringify(momAgent.body.data)}`);
    }
    const childModeAgent = await request(port, "POST", "/api/agent/ask", {
      page: "weather",
      utterance: "今天天气怎么样",
      deviceId: "child2-device",
      user: { id: "device" },
      familyMode: "儿童"
    });
    assertOk(childModeAgent, "active child member context");
    if (childModeAgent.body.data.memberContext?.member?.id !== "child2" ||
        childModeAgent.body.data.memberContext?.member?.role !== "child" ||
        childModeAgent.body.data.memberContext?.responseGuidance?.addressAs !== "二宝") {
      throw new Error(`child mode did not resolve active child profile: ${JSON.stringify(childModeAgent.body.data)}`);
    }
    const memoryDisabledChild = await request(port, "POST", "/api/admin/family/members", {
      id: "memory-disabled-child",
      name: "无记忆孩子",
      role: "child",
      status: "home",
      memoryPolicy: { enabled: false }
    }, adminHeaders);
    assertOk(memoryDisabledChild, "memory-disabled member create");
    assertOk(await request(port, "PATCH", "/api/admin/family/active-member", {
      mode: "儿童",
      memberId: "memory-disabled-child"
    }, adminHeaders), "activate memory-disabled member");
    const disabledMemoryWrite = await request(port, "POST", "/api/agent/ask", {
      page: "ai",
      utterance: "记住我喜欢恐龙",
      deviceId: "memory-disabled-device",
      user: { id: "device" },
      familyMode: "儿童"
    });
    if (disabledMemoryWrite.status !== 403 || disabledMemoryWrite.body?.ok !== false) {
      throw new Error(`disabled memory policy allowed a write: ${JSON.stringify(disabledMemoryWrite.body)}`);
    }
    assertOk(await request(port, "PATCH", "/api/admin/family/active-member", {
      mode: "儿童",
      memberId: "child2"
    }, adminHeaders), "restore active child after memory policy test");
    assertOk(await request(port, "DELETE", "/api/admin/family/members/memory-disabled-child", {
      confirmId: "memory-disabled-child",
      memoryAction: "delete"
    }, adminHeaders), "delete memory-disabled member");
    const momContext = await request(port, "GET", "/api/admin/family/members/mom/context?query=summary", null, adminHeaders);
    assertOk(momContext, "admin member context");
    if (!momContext.body.data.memory?.some((item) => item.text === "妈妈喜欢细致的家庭摘要") ||
        !momContext.body.data.recentInteractions?.some((item) => item.memberId === "mom")) {
      throw new Error(`member context endpoint missing memory or interaction: ${JSON.stringify(momContext.body.data)}`);
    }
    assertOk(await request(port, "PATCH", encodeURI("/api/admin/family/policies/儿童"), {
      policy: { apps: true, openclaw: false, homeControl: false }
    }, adminHeaders), "admin family policy update");
    const familyAfterPolicy = await request(port, "GET", "/api/admin/family", null, adminHeaders);
    assertOk(familyAfterPolicy, "admin family after policy");
    if (familyAfterPolicy.body.data.policies.policies["儿童"].apps !== true) {
      throw new Error("admin family policy update did not persist");
    }
    assertOk(await request(port, "DELETE", "/api/admin/family/members/mom", {
      confirmId: "mom",
      memoryAction: "delete"
    }, adminHeaders), "admin parent member delete");
    assertOk(await request(port, "DELETE", "/api/admin/family/members/child2", {
      confirmId: "child2",
      memoryAction: "delete"
    }, adminHeaders), "admin child member delete");
    assertOk(await request(port, "POST", "/api/action", {
      type: "action.call",
      name: "family.member.active",
      params: { mode: "默认", memberId: "parent" }
    }), "restore active parent member");
    assertOk(await request(port, "POST", "/api/action", {
      type: "action.call",
      name: "openclaw.run",
      params: { target: "default" }
    }, { "X-Request-Id": "smoke-action-openclaw", "Idempotency-Key": "smoke-action-openclaw-once" }), "openclaw run");
    const jobs = await request(port, "GET", "/api/openclaw/jobs");
    assertOk(jobs, "openclaw jobs after run");
    if (jobs.body.data.jobs?.[0]?.status !== "success" ||
        jobs.body.data.jobs?.[0]?.requestId !== "smoke-action-openclaw") {
      throw new Error(`openclaw smoke expected success, got ${jobs.body.data.jobs?.[0]?.status}`);
    }
    const jobsBeforeReplay = jobs.body.data.jobs.length;
    const replayedOpenClaw = await request(port, "POST", "/api/action", {
      type: "action.call",
      name: "openclaw.run",
      params: { target: "default" }
    }, { "X-Request-Id": "smoke-action-openclaw-replay", "Idempotency-Key": "smoke-action-openclaw-once" });
    assertOk(replayedOpenClaw, "openclaw idempotency replay");
    if (replayedOpenClaw.headers["idempotency-replayed"] !== "true") {
      throw new Error("openclaw idempotency replay did not set replay header");
    }
    const jobsAfterReplay = await request(port, "GET", "/api/openclaw/jobs");
    assertOk(jobsAfterReplay, "openclaw jobs after replay");
    if (jobsAfterReplay.body.data.jobs.length !== jobsBeforeReplay) {
      throw new Error("openclaw idempotency replay created a second job");
    }
    const rejected = await request(port, "POST", "/api/action", {
      type: "action.call",
      name: "openclaw.run",
      params: { target: "not-allowed" }
    });
    if (rejected.status !== 400 || rejected.body?.ok !== false) {
      throw new Error("openclaw target whitelist did not reject unsafe target");
    }
    assertOk(await request(port, "POST", "/api/action", {
      type: "action.call",
      name: "content.recommend",
      params: { type: "story" }
    }), "content recommend");
    // Preference-driven recommend needs at least two story candidates and one
    // that matches a member preference tag, otherwise the scoring and
    // anti-repeat logic cannot actually be exercised. The seed provides one
    // story item, so import two more with distinct tags here.
    const recommendStoryFixtures = [
      {
        pack: { id: "recommend-story-pack", type: "story", title: "Recommend Story Pack", version: 1 },
        item: {
          id: "recommend-story-dino",
          type: "story",
          title: "恐龙冒险故事",
          subtitle: "偏好命中项",
          tags: ["story", "dinosaur"],
          language: "zh-CN"
        },
        path: "courses/stories/recommend-dino.json",
        content: Buffer.from(JSON.stringify({ title: "Dino", paragraphs: ["恐龙来了。"] }), "utf8"),
        contentType: "application/json"
      },
      {
        pack: { id: "recommend-story-pack", type: "story", title: "Recommend Story Pack", version: 1 },
        item: {
          id: "recommend-story-ocean",
          type: "story",
          title: "海洋夜晚故事",
          subtitle: "非偏好项",
          tags: ["story", "ocean"],
          language: "zh-CN"
        },
        path: "courses/stories/recommend-ocean.json",
        content: Buffer.from(JSON.stringify({ title: "Ocean", paragraphs: ["海浪轻轻。"] }), "utf8"),
        contentType: "application/json"
      }
    ];
    for (const fixture of recommendStoryFixtures) {
      await importContentFixture(port, fixture);
    }
    const storyCatalog = await request(port, "GET", "/api/content/catalog?type=story");
    assertOk(storyCatalog, "story catalog for recommend check");
    const storyCount = (storyCatalog.body.data.catalog || []).length;
    if (storyCount < 2) {
      throw new Error(`recommend test needs at least 2 story items, got ${storyCount}`);
    }
    // A "dinosaur"-tagged preference for the child should score the dino story
    // above the others, so the first recommend must both hit that item and
    // report matchedTags > 0. This is the assertion that actually exercises the
    // Task 2 preference-scoring logic.
    const createdMemory = await request(port, "POST", "/api/memory", {
      text: "孩子喜欢恐龙故事",
      memberId: "child",
      visibility: "family",
      tags: ["dinosaur"]
    }, adminHeaders);
    assertOk(createdMemory, "memory create");
    const unauthenticatedMemory = await request(port, "GET", "/api/memory");
    if (unauthenticatedMemory.status !== 401) {
      throw new Error(`memory list must require parent auth: ${unauthenticatedMemory.status}`);
    }
    const expiredMemory = await request(port, "POST", "/api/memory", {
      text: "这条记忆已经过期",
      memberId: "child",
      visibility: "private",
      expiresAt: "2020-01-01T00:00:00.000Z"
    }, adminHeaders);
    assertOk(expiredMemory, "expired memory create");
    const visibleMemory = await request(port, "GET", "/api/memory?memberId=child", null, adminHeaders);
    assertOk(visibleMemory, "memory expiry list");
    if (visibleMemory.body.data.items.some((item) => item.id === expiredMemory.body.data.item.id)) {
      throw new Error("expired memory was visible by default");
    }
    const prefRecommendFirst = await request(port, "POST", "/api/agent/tools/family.content.recommend", {
      args: { type: "story", memberId: "child" },
      user: { id: "child", role: "child" },
      familyMode: "儿童"
    });
    assertOk(prefRecommendFirst, "preference recommend first");
    const firstRec = prefRecommendFirst.body.data.result?.recommendation;
    if (!firstRec?.itemId) {
      throw new Error(`preference recommend returned no item: ${JSON.stringify(prefRecommendFirst.body.data)}`);
    }
    if (firstRec.itemId !== "recommend-story-dino") {
      throw new Error(`preference recommend did not pick the dinosaur story: ${JSON.stringify(firstRec)}`);
    }
    if (!(firstRec.matchedTags > 0)) {
      throw new Error(`preference recommend did not score matched tags: ${JSON.stringify(firstRec)}`);
    }
    // The dino story is now a recent recommendation for the child, so the next
    // ask must surface a different story item (anti-repeat). With 3 candidates
    // this assertion runs unconditionally.
    const prefRecommendSecond = await request(port, "POST", "/api/agent/tools/family.content.recommend", {
      args: { type: "story", memberId: "child" },
      user: { id: "child", role: "child" },
      familyMode: "儿童"
    });
    assertOk(prefRecommendSecond, "preference recommend second");
    const secondRec = prefRecommendSecond.body.data.result?.recommendation;
    if (secondRec?.itemId === firstRec.itemId) {
      throw new Error(`recommend repeated the same item despite ${storyCount} candidates: ${firstRec.itemId}`);
    }
    const memoryId = createdMemory.body.data.item.id;
    assertOk(await request(port, "PATCH", `/api/memory/${memoryId}`, {
      text: "孩子喜欢温柔的睡前故事"
    }, adminHeaders), "memory update");
    assertOk(await request(port, "GET", "/api/memory", null, adminHeaders), "memory list");
    assertOk(await request(port, "DELETE", `/api/memory/${memoryId}`, null, adminHeaders), "memory delete");
    assertOk(await request(port, "POST", "/api/intent", {
      text: "推荐一个故事",
      role: "parent"
    }), "voice intent");
    const readDurations = [];
    for (let index = 0; index < 30; index += 1) {
      const started = Date.now();
      assertOk(await request(port, "GET", "/api/device/summary"), "performance read");
      readDurations.push(Date.now() - started);
    }
    const mutationDurations = [];
    for (let index = 0; index < 20; index += 1) {
      const started = Date.now();
      assertOk(await request(port, "POST", "/api/action", {
        type: "action.call",
        name: "toast",
        params: { message: `performance ${index}` }
      }), "performance mutation");
      mutationDurations.push(Date.now() - started);
    }
    const p95 = (values) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1];
    if (p95(readDurations) > 250) throw new Error(`LAN read P95 exceeded 250ms: ${p95(readDurations)}ms`);
    if (p95(mutationDurations) > 500) throw new Error(`local mutation P95 exceeded 500ms: ${p95(mutationDurations)}ms`);
    console.log("smoke ok");
  } finally {
    server.close();
    remoteMediaServer.close();
    homeAssistantMock.kill("SIGTERM");
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

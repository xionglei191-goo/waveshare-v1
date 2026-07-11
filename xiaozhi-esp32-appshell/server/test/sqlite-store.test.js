const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { createInitialState } = require("../src/fixtures");
const { SqliteStore } = require("../src/sqlite-store");

function tempPath(name) {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "xiaozhi-sqlite-")), name);
}

test("sqlite store runs idempotent migrations and mirrors kv.state into relational tables", () => {
  const dbPath = tempPath("family-hub.sqlite");
  const store = new SqliteStore(dbPath);

  store.update((state) => {
    state.family.members.push({
      id: "test-parent",
      name: "Test Parent",
      role: "parent",
      relationship: "监护人",
      status: "online",
      profileVersion: 1,
      updatedAt: "2026-07-10T00:00:00.000Z",
      profile: {},
      persona: {},
      memoryPolicy: { enabled: true }
    });
    state.family.activeMembers["默认"] = "test-parent";
    state.memory.items.push({
      id: "mem_test",
      memberId: "test-parent",
      visibility: "member",
      source: "test",
      createdAt: "2026-07-10T00:00:00.000Z",
      updatedAt: "2026-07-10T00:00:00.000Z",
      text: "remember this"
    });
    state.memory.recentContext = [{
      id: "ctx_test",
      memberId: "test-parent",
      at: "2026-07-10T00:01:00.000Z",
      page: "ai",
      agent: "general",
      intent: "test"
    }];
    state.learning.records.push({
      id: "learn_test",
      memberId: "test-parent",
      type: "english",
      createdAt: "2026-07-10T00:02:00.000Z"
    });
    state.deviceBoots = [{
      key: "device-a:boot-a",
      id: "boot-a",
      deviceId: "device-a",
      firstSeenAt: "2026-07-10T00:03:00.000Z",
      lastSeenAt: "2026-07-10T00:04:00.000Z",
      firmwareBuild: "test"
    }];
    state.deviceLogs.push({
      id: "log_test",
      at: "2026-07-10T00:05:00.000Z",
      deviceId: "device-a",
      level: "info",
      source: "test",
      message: "hello",
      bootId: "boot-a",
      requestId: "req-test",
      data: { ok: true }
    });
    state.deviceCommands.queue.push({
      id: "cmd_test",
      type: "toast.show",
      deviceId: "device-a",
      status: "pending",
      createdAt: "2026-07-10T00:06:00.000Z",
      source: "test",
      payload: { requestId: "req-test" }
    });
    state.media.serverProgress.push({
      id: "progress_test",
      trackId: "track-a",
      deviceId: "device-a",
      positionSec: 12,
      durationSec: 60,
      completed: false,
      updatedAt: "2026-07-10T00:07:00.000Z"
    });
    state.acceptance.items = [{
      id: "real-family-content",
      status: "blocked",
      evidence: [{
        id: "acc_test",
        at: "2026-07-10T00:08:00.000Z",
        status: "blocked",
        actor: "test",
        source: "unit",
        reference: "local://test",
        data: {}
      }]
    }];
    state.security.audit.push({
      id: "audit_test",
      at: "2026-07-10T00:09:00.000Z",
      action: "unit.test",
      category: "test",
      status: "allowed",
      requestId: "req-test"
    });
  });

  const info = store.schemaInfo();
  assert.equal(info.integrity, "ok");
  assert.equal(info.mirrorConsistency.ok, true);
  assert.equal(info.migrations.length, 1);
  assert.equal(info.migrations[0].name, "relational_mirror_tables");
  assert.equal(info.tables.family_members, 4);
  assert.equal(info.tables.memories, 1);
  assert.equal(info.tables.learning_records, 1);
  assert.equal(info.tables.recent_interactions, 1);
  assert.equal(info.tables.device_boot_sessions, 1);
  assert.equal(info.tables.device_logs, 1);
  assert.equal(info.tables.device_commands, 1);
  assert.equal(info.tables.media_progress, 1);
  assert.equal(info.tables.acceptance_evidence, 1);
  assert.equal(info.tables.security_audit, 1);
  assert.ok(info.kvSnapshots.some((item) => item.key === "state"));
  assert.ok(info.kvSnapshots.some((item) => item.key === "state_previous_1"));

  const reopened = new SqliteStore(dbPath);
  const reopenedInfo = reopened.schemaInfo();
  assert.equal(reopenedInfo.migrations.length, 1);
  assert.equal(reopenedInfo.tables.family_members, 4);
  assert.equal(reopenedInfo.mirrorConsistency.ok, true);
  assert.equal(reopened.snapshot().family.members.some((member) => member.id === "test-parent"), true);
});

test("sqlite store migrates an existing kv.state database without losing mirrored records", () => {
  const dbPath = tempPath("legacy-family-hub.sqlite");
  const { DatabaseSync } = require("node:sqlite");
  const legacy = new DatabaseSync(dbPath);
  legacy.exec(`
CREATE TABLE kv (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`);
  const state = createInitialState();
  state.family.activeMembers["默认"] = "parent";
  state.memory.items.push({
    id: "legacy-memory",
    memberId: "parent",
    visibility: "family",
    source: "legacy",
    createdAt: "2026-07-10T01:00:00.000Z"
  });
  state.learning.records.push({
    id: "legacy-learning",
    memberId: "child",
    type: "english",
    createdAt: "2026-07-10T01:01:00.000Z"
  });
  state.memory.recentContext = [{
    id: "legacy-context",
    memberId: "parent",
    at: "2026-07-10T01:02:00.000Z"
  }];
  state.deviceCommands.history.push({
    id: "legacy-command",
    type: "media.server.play",
    deviceId: "esp32-185b",
    status: "accepted",
    createdAt: "2026-07-10T01:03:00.000Z",
    ackedAt: "2026-07-10T01:04:00.000Z",
    payload: {}
  });
  state.acceptance.items = [{
    id: "blufi-new-wifi",
    status: "blocked",
    evidence: [{
      id: "legacy-evidence",
      at: "2026-07-10T01:05:00.000Z",
      status: "blocked",
      actor: "test",
      source: "legacy",
      data: {}
    }]
  }];
  state.security.audit.push({
    id: "legacy-audit",
    at: "2026-07-10T01:06:00.000Z",
    action: "legacy.action",
    status: "allowed"
  });
  legacy.prepare("INSERT INTO kv(key, value, updated_at) VALUES ('state', ?, '2026-07-10T01:07:00.000Z')").run(JSON.stringify(state));
  legacy.close();

  const migrated = new SqliteStore(dbPath);
  const info = migrated.schemaInfo();
  assert.equal(info.integrity, "ok");
  assert.equal(info.mirrorConsistency.ok, true);
  assert.equal(info.tables.family_members, 3);
  assert.equal(info.tables.family_active_members, 3);
  assert.equal(info.tables.memories, 1);
  assert.equal(info.tables.learning_records, 1);
  assert.equal(info.tables.recent_interactions, 1);
  assert.equal(info.tables.device_commands, 1);
  assert.equal(info.tables.acceptance_evidence, 1);
  assert.equal(info.tables.security_audit, 1);
  assert.equal(migrated.snapshot().memory.items[0].id, "legacy-memory");
});

test("migration upgrades early relational tables before creating new indexes", () => {
  const dbPath = tempPath("early-relational.sqlite");
  const { DatabaseSync } = require("node:sqlite");
  const legacy = new DatabaseSync(dbPath);
  legacy.exec(`
CREATE TABLE device_logs (
  id TEXT PRIMARY KEY,
  at TEXT,
  device_id TEXT,
  level TEXT,
  source TEXT,
  message TEXT,
  data TEXT
);
CREATE TABLE security_audit (
  id TEXT PRIMARY KEY,
  at TEXT,
  action TEXT,
  category TEXT,
  mode TEXT,
  member_id TEXT,
  status TEXT,
  reason TEXT
);
CREATE TABLE devices (
  id TEXT PRIMARY KEY,
  name TEXT,
  profile TEXT,
  room TEXT,
  owner TEXT,
  firmware TEXT,
  created_at TEXT,
  last_seen_at TEXT
);
`);
  legacy.close();

  const migrated = new SqliteStore(dbPath);
  const deviceLogColumns = migrated.db.prepare("PRAGMA table_info(device_logs)").all().map((item) => item.name);
  const auditColumns = migrated.db.prepare("PRAGMA table_info(security_audit)").all().map((item) => item.name);
  const indexes = migrated.db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all().map((item) => item.name);
  assert.ok(deviceLogColumns.includes("boot_id"));
  assert.ok(deviceLogColumns.includes("request_id"));
  assert.ok(auditColumns.includes("request_id"));
  assert.ok(indexes.includes("idx_device_logs_boot_id"));
  assert.ok(indexes.includes("idx_device_logs_request_id"));
  assert.ok(indexes.includes("idx_security_audit_request_id"));
  assert.equal(migrated.schemaInfo().integrity, "ok");
});

test("cold restore preserves legacy device logs with duplicate ids", () => {
  const dbPath = tempPath("duplicate-device-logs.sqlite");
  const { DatabaseSync } = require("node:sqlite");
  const legacy = new DatabaseSync(dbPath);
  legacy.exec("CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)");
  const state = createInitialState();
  state.deviceLogs = [
    { id: "legacy-log", at: "2026-07-10T02:00:00.000Z", deviceId: "device-a", message: "newer" },
    { id: "legacy-log", at: "2026-07-10T01:00:00.000Z", deviceId: "device-a", message: "older" }
  ];
  legacy.prepare("INSERT INTO kv(key, value, updated_at) VALUES ('state', ?, '2026-07-10T02:01:00.000Z')").run(JSON.stringify(state));
  legacy.close();

  const restored = new SqliteStore(dbPath, "", { relationalReads: true, compactKv: true });
  assert.equal(restored.snapshot().deviceLogs.length, 2);
  assert.deepEqual(restored.snapshot().deviceLogs.map((item) => item.id), ["legacy-log", "legacy-log~2"]);
  assert.equal(restored.snapshot().deviceLogs[1].legacyId, "legacy-log");
  assert.equal(restored.schemaInfo().tables.device_logs, 2);
  assert.equal(restored.schemaInfo().mirrorConsistency.ok, true);
});

test("compact kv mode restores normalized state from relational tables", () => {
  const dbPath = tempPath("compact-family-hub.sqlite");
  const seeded = new SqliteStore(dbPath);
  seeded.update((state) => {
    state.family.members.push({ id: "compact-parent", role: "parent", name: "Compact Parent", updatedAt: new Date().toISOString() });
    state.memory.items.push({ id: "compact-memory", memberId: "compact-parent", text: "kept in table", updatedAt: new Date().toISOString() });
    state.deviceLogs.push({
      id: "compact-log",
      at: "2026-07-10T03:00:00.000Z",
      deviceId: "device-a",
      level: "info",
      source: "unit",
      message: "preserve relational columns",
      bootId: "boot-a",
      requestId: "req-a",
      data: { freeHeap: 1234 }
    });
  });

  const compact = new SqliteStore(dbPath, "", { relationalReads: true, compactKv: true });
  assert.equal(compact.snapshot().family.members.some((item) => item.id === "compact-parent"), true);
  assert.equal(compact.snapshot().memory.items.some((item) => item.id === "compact-memory"), true);
  const rawState = compact.db.prepare("SELECT value FROM kv WHERE key='state'").get().value;
  const parsed = JSON.parse(rawState);
  assert.equal(parsed.family.members, undefined);
  assert.equal(parsed.memory.items, undefined);

  const reopened = new SqliteStore(dbPath, "", { relationalReads: true, compactKv: true });
  assert.equal(reopened.snapshot().family.members.some((item) => item.id === "compact-parent"), true);
  assert.equal(reopened.snapshot().memory.items.some((item) => item.id === "compact-memory"), true);
  assert.deepEqual(reopened.snapshot().deviceLogs[0], {
    id: "compact-log",
    at: "2026-07-10T03:00:00.000Z",
    deviceId: "device-a",
    level: "info",
    source: "unit",
    message: "preserve relational columns",
    bootId: "boot-a",
    requestId: "req-a",
    data: { freeHeap: 1234 }
  });
  assert.equal(reopened.schemaInfo().mirrorConsistency.ok, true);
});

test("migration checksum failure aborts startup without changing stored state", () => {
  const dbPath = tempPath("migration-rollback.sqlite");
  const seeded = new SqliteStore(dbPath);
  seeded.update((state) => { state.familyMode = "儿童"; });
  seeded.db.prepare("UPDATE schema_migrations SET checksum='corrupt' WHERE version=1").run();
  seeded.db.close();
  assert.throws(() => new SqliteStore(dbPath), /checksum mismatch/);
  const { DatabaseSync } = require("node:sqlite");
  const db = new DatabaseSync(dbPath);
  const state = JSON.parse(db.prepare("SELECT value FROM kv WHERE key='state'").get().value);
  assert.equal(state.familyMode, "儿童");
  db.close();
});

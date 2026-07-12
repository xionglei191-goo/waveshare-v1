const fs = require("fs");
const path = require("path");

const { createInitialState } = require("./fixtures");
const { SQLITE_MIGRATIONS } = require("./sqlite-migrations");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function mergeDefaults(state, defaults) {
  if (Array.isArray(defaults)) {
    return Array.isArray(state) ? state : clone(defaults);
  }
  if (defaults && typeof defaults === "object") {
    const output = state && typeof state === "object" && !Array.isArray(state) ? { ...state } : {};
    for (const [key, value] of Object.entries(defaults)) {
      output[key] = mergeDefaults(output[key], value);
    }
    return output;
  }
  return state === undefined ? defaults : state;
}

function sqliteModule() {
  try {
    return require("node:sqlite");
  } catch {
    return null;
  }
}

function sqliteAvailable() {
  return Boolean(sqliteModule()?.DatabaseSync);
}

function json(value) {
  return JSON.stringify(value ?? null);
}

function text(value) {
  if (value === undefined || value === null) {
    return "";
  }
  return String(value);
}

function nullableText(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  return String(value);
}

function nullableNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function boolInt(value) {
  return value ? 1 : 0;
}

function tableCount(db, table) {
  return db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count;
}

function allTables(db) {
  return db.prepare(`
SELECT name FROM sqlite_master
WHERE type='table' AND name NOT LIKE 'sqlite_%'
ORDER BY name
`).all().map((row) => row.name);
}

function collectAcceptanceEvidence(state) {
  const output = [];
  for (const item of state.acceptance?.items || []) {
    for (const evidence of item.evidence || []) {
      output.push({ itemId: item.id, evidence });
    }
  }
  return output;
}

function collectDeviceCommands(state) {
  const commands = state.deviceCommands || {};
  return [
    ...(Array.isArray(commands.queue) ? commands.queue : []),
    ...(Array.isArray(commands.history) ? commands.history : [])
  ];
}

function collectAuthTokens(state) {
  const candidates = [
    ...(Array.isArray(state.auth?.tokens) ? state.auth.tokens : []),
    ...(Array.isArray(state.security?.tokens) ? state.security.tokens : [])
  ];
  return candidates.filter((token) => token && (token.id || token.tokenHash || token.hash));
}

function parseRowData(row) {
  try {
    return JSON.parse(row?.data || "{}");
  } catch (error) {
    throw new Error(`invalid relational JSON for ${row?.id || row?.key || "row"}: ${error.message}`);
  }
}

function parseDeviceLogRow(row) {
  const parsed = parseRowData(row);
  if (parsed.id || parsed.at || parsed.deviceId) return parsed;
  return {
    id: row.id,
    at: row.at,
    deviceId: row.device_id,
    level: row.level,
    source: row.source,
    message: row.message,
    bootId: row.boot_id,
    requestId: row.request_id,
    data: parsed
  };
}

function uniqueItemIds(items, prefix) {
  const used = new Set();
  const occurrences = new Map();
  return (Array.isArray(items) ? items : []).map((item, index) => {
    const originalId = text(item?.id).trim() || `${prefix}_${index + 1}`;
    const occurrence = (occurrences.get(originalId) || 0) + 1;
    occurrences.set(originalId, occurrence);
    let id = occurrence === 1 ? originalId : `${originalId}~${occurrence}`;
    while (used.has(id)) {
      id = `${originalId}~${occurrences.get(originalId) + 1}`;
      occurrences.set(originalId, occurrences.get(originalId) + 1);
    }
    used.add(id);
    return id === item?.id ? item : {
      ...(item || {}),
      id,
      ...(item?.id ? { legacyId: item.id } : {})
    };
  });
}

function compactStateForKv(state) {
  const output = clone(state);
  output.family = output.family || {};
  delete output.family.members;
  delete output.family.activeMembers;
  output.memory = output.memory || {};
  delete output.memory.items;
  delete output.memory.recentContext;
  output.learning = output.learning || {};
  delete output.learning.records;
  delete output.deviceBoots;
  delete output.deviceLogs;
  output.deviceCommands = output.deviceCommands || {};
  delete output.deviceCommands.queue;
  delete output.deviceCommands.history;
  output.media = output.media || {};
  delete output.media.serverProgress;
  for (const item of output.acceptance?.items || []) item.evidence = [];
  output.security = output.security || {};
  delete output.security.tokens;
  delete output.security.audit;
  output.sync = output.sync || {};
  delete output.sync.events;
  delete output.devices;
  return output;
}

class SqliteStore {
  constructor(filePath, migrationJsonFile = "", options = {}) {
    const sqlite = sqliteModule();
    if (!sqlite?.DatabaseSync) {
      throw new Error("STORE_DRIVER=sqlite requires the Node.js built-in node:sqlite DatabaseSync API.");
    }
    this.filePath = filePath;
    this.migrationJsonFile = migrationJsonFile;
    this.driver = "sqlite";
    this.relationalReads = Boolean(options.relationalReads);
    this.compactKv = Boolean(options.compactKv);
    this.state = createInitialState();
    this.writeQueue = Promise.resolve();
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    this.db = new sqlite.DatabaseSync(this.filePath);
    this.load();
  }

  pragma() {
    this.db.exec(`
PRAGMA journal_mode=WAL;
PRAGMA synchronous=NORMAL;
PRAGMA foreign_keys=ON;
`);
  }

  ensureMigrationTable() {
    this.db.exec(`
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  checksum TEXT NOT NULL,
  applied_at TEXT NOT NULL
);
`);
  }

  runMigrations() {
    this.ensureMigrationTable();
    const lookup = this.db.prepare("SELECT version, checksum FROM schema_migrations WHERE version = ?");
    const insert = this.db.prepare("INSERT INTO schema_migrations(version, name, checksum, applied_at) VALUES (?, ?, ?, ?)");
    for (const migration of SQLITE_MIGRATIONS) {
      const existing = lookup.get(migration.version);
      if (existing) {
        if (existing.checksum !== migration.checksum) {
          throw new Error(`sqlite migration checksum mismatch for version ${migration.version}`);
        }
        continue;
      }
      this.db.exec("BEGIN IMMEDIATE");
      try {
        migration.up(this.db);
        insert.run(migration.version, migration.name, migration.checksum, new Date().toISOString());
        this.db.exec("COMMIT");
      } catch (error) {
        try {
          this.db.exec("ROLLBACK");
        } catch {
          // Ignore rollback noise; the migration error is the important part.
        }
        throw error;
      }
    }
  }

  load() {
    this.pragma();
    this.runMigrations();
    const row = this.db.prepare("SELECT value FROM kv WHERE key = 'state'").get();
    if (row?.value) {
      this.state = mergeDefaults(JSON.parse(row.value), createInitialState());
      const mirrorReady = this.db.prepare("SELECT value FROM kv WHERE key = 'relational_mirror_ready'").get()?.value === "1";
      if (this.relationalReads && mirrorReady) this.hydrateFromRelationalTables();
      this.save();
      return;
    }

    if (this.migrationJsonFile && fs.existsSync(this.migrationJsonFile)) {
      const raw = fs.readFileSync(this.migrationJsonFile, "utf8");
      this.state = mergeDefaults(raw.trim() ? JSON.parse(raw) : {}, createInitialState());
    } else {
      this.state = createInitialState();
    }
    this.save();
  }

  hydrateFromRelationalTables() {
    const rows = (table, order = "") => this.db.prepare(`SELECT * FROM ${table} ${order}`).all();
    this.state.family = this.state.family || {};
    this.state.family.members = rows("family_members", "ORDER BY updated_at DESC").map(parseRowData);
    this.state.family.activeMembers = Object.fromEntries(rows("family_active_members").map((row) => [row.mode, row.member_id]));
    this.state.memory = this.state.memory || {};
    this.state.memory.items = rows("memories", "ORDER BY updated_at DESC").map(parseRowData);
    this.state.memory.recentContext = rows("recent_interactions", "ORDER BY at DESC").map(parseRowData);
    this.state.learning = this.state.learning || {};
    this.state.learning.records = rows("learning_records", "ORDER BY created_at DESC").map(parseRowData);
    this.state.deviceBoots = rows("device_boot_sessions", "ORDER BY last_seen_at DESC").map(parseRowData);
    this.state.deviceLogs = rows("device_logs", "ORDER BY at DESC").map(parseDeviceLogRow);
    const commands = rows("device_commands", "ORDER BY created_at DESC").map(parseRowData);
    this.state.deviceCommands = this.state.deviceCommands || {};
    this.state.deviceCommands.queue = commands.filter((item) => item.status === "pending").reverse();
    this.state.deviceCommands.history = commands.filter((item) => item.status !== "pending");
    this.state.media = this.state.media || {};
    this.state.media.serverProgress = rows("media_progress", "ORDER BY updated_at DESC").map(parseRowData);
    const evidenceByItem = new Map();
    for (const row of rows("acceptance_evidence", "ORDER BY at DESC")) {
      const list = evidenceByItem.get(row.item_id) || [];
      list.push(parseRowData(row));
      evidenceByItem.set(row.item_id, list);
    }
    for (const item of this.state.acceptance?.items || []) item.evidence = evidenceByItem.get(item.id) || [];
    this.state.security = this.state.security || {};
    this.state.security.tokens = rows("auth_tokens", "ORDER BY created_at DESC").map(parseRowData);
    this.state.security.audit = rows("security_audit", "ORDER BY at DESC").map(parseRowData);
    this.state.sync = this.state.sync || {};
    this.state.sync.events = rows("sync_events", "ORDER BY at DESC").map((row) => {
      const payload = JSON.parse(row.payload || "{}");
      return { id: row.id, at: row.at, createdAt: row.at, deviceId: row.device_id, type: row.type, payload };
    });
    this.state.devices = rows("devices", "ORDER BY last_seen_at DESC").map(parseRowData);
  }

  statement(sql) {
    return this.db.prepare(sql);
  }

  replaceKvSnapshots(nextState, updatedAt) {
    const current = this.statement("SELECT value FROM kv WHERE key = 'state'").get()?.value || "";
    const previous = this.statement("SELECT value FROM kv WHERE key = 'state_previous_1'").get()?.value || "";
    const upsert = this.statement("INSERT OR REPLACE INTO kv(key, value, updated_at) VALUES (?, ?, ?)");
    if (previous) {
      upsert.run("state_previous_2", previous, updatedAt);
    }
    if (current) {
      upsert.run("state_previous_1", current, updatedAt);
    }
    upsert.run("state", json(this.compactKv ? compactStateForKv(nextState) : nextState), updatedAt);
    upsert.run("relational_mirror_ready", "1", updatedAt);
  }

  clearMirrorTables() {
    for (const table of [
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
    ]) {
      this.db.exec(`DELETE FROM ${table}`);
    }
  }

  writeFamilyTables(state, updatedAt) {
    const memberInsert = this.statement(`
INSERT INTO family_members(id, role, relationship, name, status, profile_version, archived_at, updated_at, data)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
    for (const member of state.family?.members || []) {
      memberInsert.run(
        text(member.id),
        text(member.role),
        nullableText(member.relationship),
        text(member.name),
        text(member.status),
        nullableNumber(member.profileVersion),
        nullableText(member.archivedAt),
        nullableText(member.updatedAt || updatedAt),
        json(member)
      );
    }

    const activeInsert = this.statement("INSERT INTO family_active_members(mode, member_id, updated_at) VALUES (?, ?, ?)");
    for (const [mode, memberId] of Object.entries(state.family?.activeMembers || {})) {
      activeInsert.run(text(mode), text(memberId), updatedAt);
    }
  }

  writeMemoryTables(state) {
    const memoryInsert = this.statement(`
INSERT INTO memories(id, member_id, visibility, source, created_at, updated_at, deleted_at, data)
VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);
    for (const item of state.memory?.items || []) {
      memoryInsert.run(
        text(item.id),
        nullableText(item.memberId),
        nullableText(item.visibility),
        nullableText(item.source),
        nullableText(item.createdAt),
        nullableText(item.updatedAt),
        nullableText(item.deletedAt),
        json(item)
      );
    }

    const learningInsert = this.statement(`
INSERT INTO learning_records(id, member_id, type, created_at, data)
VALUES (?, ?, ?, ?, ?)
`);
    for (const record of state.learning?.records || []) {
      learningInsert.run(
        text(record.id),
        nullableText(record.memberId),
        nullableText(record.type),
        nullableText(record.createdAt || record.at),
        json(record)
      );
    }

    const contextInsert = this.statement(`
INSERT INTO recent_interactions(id, member_id, at, page, agent, intent, data)
VALUES (?, ?, ?, ?, ?, ?, ?)
`);
    for (const item of state.memory?.recentContext || []) {
      contextInsert.run(
        text(item.id),
        nullableText(item.memberId),
        nullableText(item.at),
        nullableText(item.page),
        nullableText(item.agent),
        nullableText(item.intent),
        json(item)
      );
    }
  }

  writeDeviceTables(state) {
    const bootInsert = this.statement(`
INSERT INTO device_boot_sessions(key, id, device_id, first_seen_at, last_seen_at, boot_sequence, reset_reason, panic_summary, firmware_build, health, data)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
    for (const session of state.deviceBoots || []) {
      bootInsert.run(
        text(session.key || `${session.deviceId || ""}:${session.id || ""}`),
        nullableText(session.id),
        text(session.deviceId),
        nullableText(session.firstSeenAt),
        nullableText(session.lastSeenAt),
        nullableNumber(session.bootSequence),
        nullableText(session.resetReason),
        nullableText(session.panicSummary),
        nullableText(session.firmwareBuild),
        nullableText(session.health || session.status),
        json(session)
      );
    }

    const logInsert = this.statement(`
INSERT INTO device_logs(id, at, device_id, level, source, message, boot_id, request_id, data)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
    for (const log of state.deviceLogs || []) {
      logInsert.run(
        text(log.id),
        nullableText(log.at),
        nullableText(log.deviceId),
        nullableText(log.level),
        nullableText(log.source),
        nullableText(log.message),
        nullableText(log.bootId),
        nullableText(log.requestId),
        json(log)
      );
    }

    const deviceInsert = this.statement(`
INSERT INTO devices(id, name, profile, room, owner, firmware, created_at, last_seen_at, data)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
    for (const device of state.devices || []) {
      deviceInsert.run(
        text(device.id),
        nullableText(device.name),
        nullableText(device.profile),
        nullableText(device.room),
        nullableText(device.owner),
        nullableText(device.firmware),
        nullableText(device.createdAt),
        nullableText(device.lastSeenAt),
        json(device)
      );
    }
  }

  writeOperationalTables(state) {
    const commandInsert = this.statement(`
INSERT INTO device_commands(id, device_id, type, status, created_at, acked_at, source, idempotency_key, request_id, data)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
    for (const command of collectDeviceCommands(state)) {
      commandInsert.run(
        text(command.id),
        nullableText(command.deviceId),
        nullableText(command.type),
        nullableText(command.status),
        nullableText(command.createdAt),
        nullableText(command.ackedAt),
        nullableText(command.source),
        nullableText(command.idempotencyKey),
        nullableText(command.requestId || command.payload?.requestId),
        json(command)
      );
    }

    const progressInsert = this.statement(`
INSERT INTO media_progress(id, track_id, device_id, position_sec, duration_sec, completed, updated_at, data)
VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);
    for (const item of state.media?.serverProgress || []) {
      progressInsert.run(
        text(item.id || `${item.deviceId || "device"}:${item.trackId || "track"}`),
        nullableText(item.trackId),
        nullableText(item.deviceId),
        nullableNumber(item.positionSec),
        nullableNumber(item.durationSec),
        boolInt(item.completed),
        nullableText(item.updatedAt || item.createdAt),
        json(item)
      );
    }

    const evidenceInsert = this.statement(`
INSERT INTO acceptance_evidence(id, item_id, status, actor, source, at, reference, data)
VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);
    for (const { itemId, evidence } of collectAcceptanceEvidence(state)) {
      evidenceInsert.run(
        text(evidence.id),
        text(itemId),
        nullableText(evidence.status),
        nullableText(evidence.actor),
        nullableText(evidence.source),
        nullableText(evidence.at),
        nullableText(evidence.reference),
        json(evidence)
      );
    }

    const tokenInsert = this.statement(`
INSERT INTO auth_tokens(id, token_hash, kind, scope, created_at, last_used_at, revoked_at, data)
VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);
    for (const token of collectAuthTokens(state)) {
      tokenInsert.run(
        text(token.id || token.tokenHash || token.hash),
        text(token.tokenHash || token.hash),
        nullableText(token.kind || token.type),
        nullableText(Array.isArray(token.scopes) ? token.scopes.join(" ") : token.scope),
        nullableText(token.createdAt),
        nullableText(token.lastUsedAt),
        nullableText(token.revokedAt),
        json(token)
      );
    }

    const auditInsert = this.statement(`
INSERT INTO security_audit(id, at, action, category, mode, member_id, status, reason, request_id, data)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
    for (const item of state.security?.audit || []) {
      auditInsert.run(
        text(item.id),
        nullableText(item.at),
        nullableText(item.action),
        nullableText(item.category),
        nullableText(item.mode),
        nullableText(item.memberId),
        nullableText(item.status),
        nullableText(item.reason),
        nullableText(item.requestId),
        json(item)
      );
    }

    const syncInsert = this.statement("INSERT INTO sync_events(id, at, device_id, type, payload) VALUES (?, ?, ?, ?, ?)");
    for (const event of state.sync?.events || []) {
      syncInsert.run(
        text(event.id),
        nullableText(event.createdAt || event.at),
        nullableText(event.deviceId),
        nullableText(event.type),
        json(event.payload || {})
      );
    }
  }

  expectedMirrorCounts(state) {
    return {
      family_members: state.family?.members?.length || 0,
      family_active_members: Object.keys(state.family?.activeMembers || {}).length,
      memories: state.memory?.items?.length || 0,
      learning_records: state.learning?.records?.length || 0,
      recent_interactions: state.memory?.recentContext?.length || 0,
      device_boot_sessions: state.deviceBoots?.length || 0,
      device_logs: state.deviceLogs?.length || 0,
      device_commands: collectDeviceCommands(state).length,
      media_progress: state.media?.serverProgress?.length || 0,
      acceptance_evidence: collectAcceptanceEvidence(state).length,
      auth_tokens: collectAuthTokens(state).length,
      security_audit: state.security?.audit?.length || 0,
      sync_events: state.sync?.events?.length || 0,
      devices: state.devices?.length || 0
    };
  }

  verifyMirrorConsistency(state) {
    const expected = this.expectedMirrorCounts(state);
    const actual = {};
    const mismatches = [];
    for (const [table, expectedCount] of Object.entries(expected)) {
      actual[table] = tableCount(this.db, table);
      if (actual[table] !== expectedCount) {
        mismatches.push({ table, expected: expectedCount, actual: actual[table] });
      }
    }
    if (mismatches.length) {
      const error = new Error(`sqlite mirror consistency failed: ${JSON.stringify(mismatches)}`);
      error.mismatches = mismatches;
      throw error;
    }
    return { ok: true, expected, actual, mismatches };
  }

  save(sourceState = this.state) {
    const nextState = {
      ...sourceState,
      deviceLogs: uniqueItemIds(sourceState.deviceLogs, "device_log"),
      updatedAt: new Date().toISOString()
    };
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.replaceKvSnapshots(nextState, nextState.updatedAt);
      this.clearMirrorTables();
      this.writeFamilyTables(nextState, nextState.updatedAt);
      this.writeMemoryTables(nextState);
      this.writeDeviceTables(nextState);
      this.writeOperationalTables(nextState);
      this.verifyMirrorConsistency(nextState);
      this.db.exec("COMMIT");
    } catch (error) {
      try {
        this.db.exec("ROLLBACK");
      } catch {
        // Preserve the original persistence error.
      }
      throw error;
    }
    this.state = nextState;
  }

  snapshot() {
    return clone(this.state);
  }

  update(mutator) {
    const draft = clone(this.state);
    mutator(draft);
    this.save(draft);
    return this.snapshot();
  }

  async updateAsync(mutator) {
    const run = async () => {
      const draft = clone(this.state);
      await mutator(draft);
      this.save(draft);
      return this.snapshot();
    };
    const next = this.writeQueue.then(run, run);
    this.writeQueue = next.then(() => undefined, () => undefined);
    return next;
  }

  reset() {
    this.state = createInitialState();
    this.save();
    return this.snapshot();
  }

  schemaInfo() {
    const tables = {};
    for (const table of allTables(this.db)) {
      tables[table] = tableCount(this.db, table);
    }
    const migrations = this.db.prepare("SELECT version, name, checksum, applied_at AS appliedAt FROM schema_migrations ORDER BY version").all();
    const kvSnapshots = this.db.prepare("SELECT key, updated_at AS updatedAt FROM kv WHERE key IN ('state', 'state_previous_1', 'state_previous_2') ORDER BY key").all();
    return {
      driver: this.driver,
      relationalReads: this.relationalReads,
      compactKv: this.compactKv,
      filePath: this.filePath,
      migrations,
      tables,
      kvSnapshots,
      integrity: this.db.prepare("PRAGMA integrity_check").get().integrity_check,
      mirrorConsistency: this.verifyMirrorConsistency(this.state)
    };
  }
}

module.exports = {
  SqliteStore,
  sqliteAvailable
};

const crypto = require("crypto");

function ensureColumn(db, table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all().map((item) => item.name);
  if (!columns.includes(column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function checksumFor(name, statements) {
  return crypto.createHash("sha256").update(`${name}\n${statements}`).digest("hex");
}

const RELATIONAL_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS kv (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS family_members (
  id TEXT PRIMARY KEY,
  role TEXT NOT NULL,
  relationship TEXT,
  name TEXT,
  status TEXT,
  profile_version INTEGER,
  archived_at TEXT,
  updated_at TEXT,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_family_members_role ON family_members(role);
CREATE INDEX IF NOT EXISTS idx_family_members_archived_at ON family_members(archived_at);

CREATE TABLE IF NOT EXISTS family_active_members (
  mode TEXT PRIMARY KEY,
  member_id TEXT NOT NULL,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_family_active_members_member ON family_active_members(member_id);

CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  member_id TEXT,
  visibility TEXT,
  source TEXT,
  created_at TEXT,
  updated_at TEXT,
  deleted_at TEXT,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_memories_member ON memories(member_id);
CREATE INDEX IF NOT EXISTS idx_memories_visibility ON memories(visibility);
CREATE INDEX IF NOT EXISTS idx_memories_updated_at ON memories(updated_at);

CREATE TABLE IF NOT EXISTS learning_records (
  id TEXT PRIMARY KEY,
  member_id TEXT,
  type TEXT,
  created_at TEXT,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_learning_records_member ON learning_records(member_id);
CREATE INDEX IF NOT EXISTS idx_learning_records_created_at ON learning_records(created_at);

CREATE TABLE IF NOT EXISTS recent_interactions (
  id TEXT PRIMARY KEY,
  member_id TEXT,
  at TEXT,
  page TEXT,
  agent TEXT,
  intent TEXT,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_recent_interactions_member ON recent_interactions(member_id);
CREATE INDEX IF NOT EXISTS idx_recent_interactions_at ON recent_interactions(at);

CREATE TABLE IF NOT EXISTS device_boot_sessions (
  key TEXT PRIMARY KEY,
  id TEXT,
  device_id TEXT NOT NULL,
  first_seen_at TEXT,
  last_seen_at TEXT,
  boot_sequence INTEGER,
  reset_reason TEXT,
  panic_summary TEXT,
  firmware_build TEXT,
  health TEXT,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_device_boot_sessions_device ON device_boot_sessions(device_id);
CREATE INDEX IF NOT EXISTS idx_device_boot_sessions_last_seen ON device_boot_sessions(last_seen_at);

CREATE TABLE IF NOT EXISTS device_logs (
  id TEXT PRIMARY KEY,
  at TEXT,
  device_id TEXT,
  level TEXT,
  source TEXT,
  message TEXT,
  boot_id TEXT,
  request_id TEXT,
  data TEXT
);
CREATE INDEX IF NOT EXISTS idx_device_logs_device_at ON device_logs(device_id, at);

CREATE TABLE IF NOT EXISTS device_commands (
  id TEXT PRIMARY KEY,
  device_id TEXT,
  type TEXT,
  status TEXT,
  created_at TEXT,
  acked_at TEXT,
  source TEXT,
  idempotency_key TEXT,
  request_id TEXT,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_device_commands_device_status ON device_commands(device_id, status);
CREATE INDEX IF NOT EXISTS idx_device_commands_created_at ON device_commands(created_at);
CREATE INDEX IF NOT EXISTS idx_device_commands_idempotency ON device_commands(idempotency_key);

CREATE TABLE IF NOT EXISTS media_progress (
  id TEXT PRIMARY KEY,
  track_id TEXT,
  device_id TEXT,
  position_sec REAL,
  duration_sec REAL,
  completed INTEGER,
  updated_at TEXT,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_media_progress_device ON media_progress(device_id);
CREATE INDEX IF NOT EXISTS idx_media_progress_track ON media_progress(track_id);

CREATE TABLE IF NOT EXISTS acceptance_evidence (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL,
  status TEXT,
  actor TEXT,
  source TEXT,
  at TEXT,
  reference TEXT,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_acceptance_evidence_item ON acceptance_evidence(item_id);
CREATE INDEX IF NOT EXISTS idx_acceptance_evidence_at ON acceptance_evidence(at);

CREATE TABLE IF NOT EXISTS auth_tokens (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL,
  kind TEXT,
  scope TEXT,
  created_at TEXT,
  last_used_at TEXT,
  revoked_at TEXT,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_auth_tokens_kind ON auth_tokens(kind);
CREATE INDEX IF NOT EXISTS idx_auth_tokens_scope ON auth_tokens(scope);
CREATE INDEX IF NOT EXISTS idx_auth_tokens_revoked_at ON auth_tokens(revoked_at);

CREATE TABLE IF NOT EXISTS security_audit (
  id TEXT PRIMARY KEY,
  at TEXT,
  action TEXT,
  category TEXT,
  mode TEXT,
  member_id TEXT,
  status TEXT,
  reason TEXT,
  request_id TEXT,
  data TEXT
);
CREATE INDEX IF NOT EXISTS idx_security_audit_at ON security_audit(at);
CREATE INDEX IF NOT EXISTS idx_security_audit_member ON security_audit(member_id);

CREATE TABLE IF NOT EXISTS sync_events (
  id TEXT PRIMARY KEY,
  at TEXT,
  device_id TEXT,
  type TEXT,
  payload TEXT
);
CREATE INDEX IF NOT EXISTS idx_sync_events_device_at ON sync_events(device_id, at);

CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  name TEXT,
  profile TEXT,
  room TEXT,
  owner TEXT,
  firmware TEXT,
  created_at TEXT,
  last_seen_at TEXT,
  data TEXT
);
CREATE INDEX IF NOT EXISTS idx_devices_last_seen ON devices(last_seen_at);
`;

const SQLITE_MIGRATIONS = [
  {
    version: 1,
    name: "relational_mirror_tables",
    checksum: checksumFor("relational_mirror_tables", RELATIONAL_SCHEMA_SQL),
    up(db) {
      db.exec(RELATIONAL_SCHEMA_SQL);
      ensureColumn(db, "device_logs", "boot_id", "TEXT");
      ensureColumn(db, "device_logs", "request_id", "TEXT");
      ensureColumn(db, "security_audit", "request_id", "TEXT");
      ensureColumn(db, "security_audit", "data", "TEXT");
      ensureColumn(db, "devices", "data", "TEXT");
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_device_logs_boot_id ON device_logs(boot_id);
        CREATE INDEX IF NOT EXISTS idx_device_logs_request_id ON device_logs(request_id);
        CREATE INDEX IF NOT EXISTS idx_security_audit_request_id ON security_audit(request_id);
      `);
    }
  }
];

module.exports = {
  SQLITE_MIGRATIONS
};

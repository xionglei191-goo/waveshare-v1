const crypto = require("crypto");

const ALLOWED_SCOPES = new Set(["admin:*", "device:write", "agent:invoke", "content:write"]);
const ALLOWED_KINDS = new Set(["admin", "device", "agent", "content"]);

function nowIso() {
  return new Date().toISOString();
}

function safeText(value, limit = 80) {
  return String(value || "").replace(/[<>]/g, "").trim().slice(0, limit);
}

function ensureAuthTokens(state) {
  state.security = state.security || {};
  state.security.tokens = Array.isArray(state.security.tokens) ? state.security.tokens : [];
  return state.security.tokens;
}

function hashToken(token) {
  return crypto.createHash("sha256").update(String(token || "")).digest("hex");
}

function normalizeScopes(value, kind = "") {
  const defaults = {
    admin: ["admin:*"],
    device: ["device:write"],
    agent: ["agent:invoke"],
    content: ["content:write"]
  };
  const source = Array.isArray(value) ? value : String(value || "").split(/[ ,]+/);
  const scopes = source.map((item) => safeText(item, 48)).filter((item) => ALLOWED_SCOPES.has(item));
  return [...new Set(scopes.length ? scopes : (defaults[kind] || []))];
}

function tokenView(record) {
  if (!record) return null;
  return {
    id: record.id,
    name: record.name,
    kind: record.kind,
    scopes: record.scopes || [],
    createdAt: record.createdAt,
    lastUsedAt: record.lastUsedAt || null,
    revokedAt: record.revokedAt || null,
    rotatedFrom: record.rotatedFrom || null
  };
}

function createAuthToken(state, body = {}) {
  const tokens = ensureAuthTokens(state);
  const kind = ALLOWED_KINDS.has(String(body.kind || "")) ? String(body.kind) : "agent";
  const scopes = normalizeScopes(body.scopes, kind);
  if (!scopes.length) {
    const error = new Error("at least one valid token scope is required");
    error.statusCode = 400;
    throw error;
  }
  const secret = `fh_${kind}_${crypto.randomBytes(32).toString("base64url")}`;
  const now = nowIso();
  const record = {
    id: `tok_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`,
    name: safeText(body.name || `${kind} token`, 80),
    kind,
    scopes,
    tokenHash: hashToken(secret),
    createdAt: now,
    lastUsedAt: null,
    revokedAt: null,
    rotatedFrom: safeText(body.rotatedFrom || "", 96) || null
  };
  tokens.unshift(record);
  state.security.tokens = tokens.slice(0, 200);
  return { token: secret, record: tokenView(record) };
}

function listAuthTokens(state) {
  return ensureAuthTokens(state).map(tokenView);
}

function revokeAuthToken(state, id) {
  const record = ensureAuthTokens(state).find((item) => item.id === String(id || ""));
  if (!record) {
    const error = new Error("auth token not found");
    error.statusCode = 404;
    throw error;
  }
  record.revokedAt = record.revokedAt || nowIso();
  return tokenView(record);
}

function rotateAuthToken(state, id) {
  const record = ensureAuthTokens(state).find((item) => item.id === String(id || ""));
  if (!record) {
    const error = new Error("auth token not found");
    error.statusCode = 404;
    throw error;
  }
  record.revokedAt = record.revokedAt || nowIso();
  return createAuthToken(state, {
    name: record.name,
    kind: record.kind,
    scopes: record.scopes,
    rotatedFrom: record.id
  });
}

function scopeAllows(scopes, requiredScope) {
  if (!requiredScope) return true;
  if ((scopes || []).includes(requiredScope)) return true;
  const [namespace] = String(requiredScope).split(":");
  return (scopes || []).includes(`${namespace}:*`);
}

function verifyAuthToken(state, token, requiredScope = "") {
  const presentedHash = hashToken(token);
  for (const record of ensureAuthTokens(state)) {
    if (record.revokedAt || !scopeAllows(record.scopes, requiredScope)) continue;
    const expected = Buffer.from(String(record.tokenHash || ""), "hex");
    const actual = Buffer.from(presentedHash, "hex");
    if (expected.length === actual.length && expected.length > 0 && crypto.timingSafeEqual(expected, actual)) {
      return record;
    }
  }
  return null;
}

function markAuthTokenUsed(state, id) {
  const record = ensureAuthTokens(state).find((item) => item.id === id && !item.revokedAt);
  if (record) record.lastUsedAt = nowIso();
  return record ? tokenView(record) : null;
}

module.exports = {
  ALLOWED_SCOPES,
  createAuthToken,
  ensureAuthTokens,
  hashToken,
  listAuthTokens,
  markAuthTokenUsed,
  revokeAuthToken,
  rotateAuthToken,
  tokenView,
  verifyAuthToken
};

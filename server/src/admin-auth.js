const net = require("net");

const { markAuthTokenUsed, verifyAuthToken } = require("./auth-tokens");

let josePromise = null;
const jwksCache = new Map();

function parseHost(value) {
  return String(value || "").split(":")[0].toLowerCase();
}

function hostFromUrl(value) {
  try {
    return parseHost(new URL(value).host);
  } catch (error) {
    return "";
  }
}

function isPrivateHost(host) {
  const value = parseHost(host);
  if (!value || value === "localhost" || value.endsWith(".local")) {
    return true;
  }
  const version = net.isIP(value);
  if (version === 4) {
    const parts = value.split(".").map((item) => Number(item));
    return (
      parts[0] === 10 ||
      parts[0] === 127 ||
      (parts[0] === 169 && parts[1] === 254) ||
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
      (parts[0] === 192 && parts[1] === 168)
    );
  }
  if (version === 6) {
    return value === "::1" || value.startsWith("fe80:") || value.startsWith("fc") || value.startsWith("fd");
  }
  return false;
}

function publicHosts(config) {
  const hosts = new Set((config.adminPublicHosts || []).map(parseHost).filter(Boolean));
  const publicBaseHost = hostFromUrl(config.publicBaseUrl);
  if (publicBaseHost && !isPrivateHost(publicBaseHost)) {
    hosts.add(publicBaseHost);
  }
  return hosts;
}

function isPublicRequest(req, config) {
  const host = parseHost(req.get("host") || req.hostname || "");
  if (!host) {
    return false;
  }
  const hosts = publicHosts(config);
  if (hosts.size > 0) {
    return hosts.has(host);
  }
  return !isPrivateHost(host);
}

function bearerToken(req) {
  const auth = String(req.get("authorization") || "");
  if (auth.toLowerCase().startsWith("bearer ")) {
    return auth.slice(7).trim();
  }
  return "";
}

function cookieValue(req, name) {
  const cookie = String(req.get("cookie") || "");
  const parts = cookie.split(";").map((item) => item.trim());
  const prefix = `${name}=`;
  const item = parts.find((part) => part.startsWith(prefix));
  return item ? decodeURIComponent(item.slice(prefix.length)) : "";
}

function queryToken(req, config) {
  if (config.allowQueryTokens === false) return "";
  const token = String(req.query.adminToken || req.query.token || "");
  if (token) req.deprecatedQueryToken = true;
  return token;
}

function adminToken(req, config) {
  return bearerToken(req) || String(req.get("x-admin-token") || "") || queryToken(req, config);
}

function expectedAdminToken(config) {
  return config.adminToken || "";
}

function stateSnapshot(store) {
  return store?.snapshot ? store.snapshot() : null;
}

function touchManagedToken(store, record) {
  if (!record || !store?.update) return;
  const lastUsed = Date.parse(record.lastUsedAt || "");
  if (Number.isFinite(lastUsed) && Date.now() - lastUsed < 5 * 60 * 1000) return;
  store.update((state) => markAuthTokenUsed(state, record.id));
}

function managedToken(req, config, state, requiredScope) {
  const token = bearerToken(req) || String(req.get("x-admin-token") || req.get("x-device-token") || req.get("x-ai-tool-token") || req.get("x-xiaozhi-tool-token") || "") || queryToken(req, config);
  return state && token ? verifyAuthToken(state, token, requiredScope) : null;
}

function hasAdminToken(req, config, state = null) {
  const expected = expectedAdminToken(config);
  return Boolean((expected && adminToken(req, config) === expected) || managedToken(req, config, state, "admin:*"));
}

function accessConfigured(config) {
  return Boolean(config.cloudflareAccessTeamDomain && config.cloudflareAccessAud);
}

async function verifyCloudflareAccess(req, config) {
  if (!accessConfigured(config)) {
    return { ok: false, reason: "cloudflare access not configured" };
  }
  const token = String(req.get("cf-access-jwt-assertion") || cookieValue(req, "CF_Authorization") || "");
  if (!token) {
    return { ok: false, reason: "missing cloudflare access assertion" };
  }
  const teamDomain = String(config.cloudflareAccessTeamDomain).replace(/\/$/, "");
  try {
    if (!josePromise) {
      josePromise = import("jose");
    }
    const { createRemoteJWKSet, jwtVerify } = await josePromise;
    let jwks = jwksCache.get(teamDomain);
    if (!jwks) {
      jwks = createRemoteJWKSet(new URL(`${teamDomain}/cdn-cgi/access/certs`));
      jwksCache.set(teamDomain, jwks);
    }
    const { payload } = await jwtVerify(token, jwks, {
      issuer: teamDomain,
      audience: config.cloudflareAccessAud
    });
    const email = String(payload.email || payload.sub || "");
    const allowed = config.cloudflareAccessAllowedEmails || [];
    if (allowed.length > 0 && !allowed.includes(email)) {
      return { ok: false, reason: "cloudflare access user not allowed", email };
    }
    return { ok: true, user: { email, sub: payload.sub || "", payload } };
  } catch (error) {
    return { ok: false, reason: `cloudflare access rejected: ${error.message}` };
  }
}

async function authorizeAdmin(req, config, state = null) {
  const record = managedToken(req, config, state, "admin:*");
  if (record) {
    return { ok: true, method: "managed-token", token: record };
  }
  if (hasAdminToken(req, config, state)) {
    return { ok: true, method: "admin-token" };
  }
  const access = await verifyCloudflareAccess(req, config);
  if (access.ok) {
    return { ok: true, method: "cloudflare-access", user: access.user };
  }
  const tokenConfigured = Boolean(expectedAdminToken(config));
  return {
    ok: false,
    reason: tokenConfigured || accessConfigured(config)
      ? access.reason || "invalid admin token"
      : "admin auth is not configured"
  };
}

function rejectUnauthorized(res, reason) {
  res.status(401).json({ ok: false, error: reason || "admin authorization required" });
}

function applyDeprecationHeaders(req, res) {
  if (!req.deprecatedQueryToken) return;
  res.setHeader("Deprecation", "true");
  res.setHeader("Sunset", "2026-10-01");
  res.setHeader("Warning", '299 - "Query-string tokens are deprecated; use Authorization or token headers"');
}

function adminAuthMiddleware(config, store = null) {
  return async (req, res, next) => {
    const auth = await authorizeAdmin(req, config, stateSnapshot(store));
    applyDeprecationHeaders(req, res);
    if (!auth.ok) {
      rejectUnauthorized(res, auth.reason);
      return;
    }
    touchManagedToken(store, auth.token);
    req.adminAuth = auth;
    next();
  };
}

function adminPageMiddleware(config, store = null) {
  return async (req, res, next) => {
    if (!config.cloudflareAccessRequired) {
      next();
      return;
    }
    const auth = await authorizeAdmin(req, config, stateSnapshot(store));
    applyDeprecationHeaders(req, res);
    if (!auth.ok) {
      res.status(401).send("Admin access requires Cloudflare Access or a valid admin token.");
      return;
    }
    touchManagedToken(store, auth.token);
    next();
  };
}

function publicMutationAuthMiddleware(config, store = null) {
  return async (req, res, next) => {
    if (!config.adminProtectPublicMutations || req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") {
      next();
      return;
    }
    if (!isPublicRequest(req, config)) {
      next();
      return;
    }
    const state = stateSnapshot(store);
    if (req.path === "/ai/xiaozhi/tool" || req.path === "/ai/traces" || req.path === "/agent/ask" || req.path.startsWith("/agent/tools/")) {
      next();
      return;
    }
    const deviceWrite = req.path === "/device/logs" || req.path === "/device/context" || req.path === "/devices/register" ||
      req.path.startsWith("/device/commands/") || req.path === "/sync/push" ||
      req.path === "/media/server/progress";
    if (deviceWrite) {
      const record = managedToken(req, config, state, "device:write");
      const presentedDeviceToken = bearerToken(req) || String(req.get("x-device-token") || "");
      if (record || (config.deviceToken && presentedDeviceToken === config.deviceToken)) {
        applyDeprecationHeaders(req, res);
        touchManagedToken(store, record);
        req.deviceAuth = { method: record ? "managed-token" : "device-token", token: record || null };
        next();
        return;
      }
    }
    const contentWrite = req.path === "/content/import" || req.path === "/resources/import" || req.path === "/usb/import";
    if (contentWrite) {
      const record = managedToken(req, config, state, "content:write");
      if (record) {
        applyDeprecationHeaders(req, res);
        touchManagedToken(store, record);
        req.contentAuth = { method: "managed-token", token: record };
        next();
        return;
      }
    }
    const auth = await authorizeAdmin(req, config, state);
    applyDeprecationHeaders(req, res);
    if (!auth.ok) {
      rejectUnauthorized(res, auth.reason);
      return;
    }
    touchManagedToken(store, auth.token);
    req.adminAuth = auth;
    next();
  };
}

module.exports = {
  adminAuthMiddleware,
  adminPageMiddleware,
  authorizeAdmin,
  bearerToken,
  hasAdminToken,
  isPublicRequest,
  managedToken,
  publicMutationAuthMiddleware
};

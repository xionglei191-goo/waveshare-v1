function nowMs() {
  return Date.now();
}

function cleanKey(value) {
  return String(value || "").replace(/[^a-zA-Z0-9._:-]/g, "-").slice(0, 160);
}

function numberValue(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function rateBucket(req) {
  const path = String(req.path || "");
  if (path === "/action") {
    return { name: "action", limitKey: "rateLimitActionPerMinute", fallback: 60 };
  }
  if (path.startsWith("/agent/")) {
    return { name: "agent", limitKey: "rateLimitAgentPerMinute", fallback: 30 };
  }
  if (path === "/device/logs") {
    return { name: "deviceLogs", limitKey: "rateLimitDeviceLogsPerMinute", fallback: 120 };
  }
  if (path.startsWith("/admin/")) {
    return { name: "admin", limitKey: "rateLimitAdminPerMinute", fallback: 120 };
  }
  return null;
}

function clientKey(req) {
  return cleanKey(
    req.get("x-device-id") ||
    req.get("x-forwarded-for")?.split(",")[0] ||
    req.ip ||
    req.socket?.remoteAddress ||
    "unknown"
  ) || "unknown";
}

function idempotencyKey(req) {
  return cleanKey(
    req.get("idempotency-key") ||
    req.body?.idempotencyKey ||
    req.body?.idempotency_key ||
    req.body?.params?.idempotencyKey ||
    req.body?.args?.idempotencyKey ||
    ""
  );
}

function idempotencyPathAllowed(req) {
  const path = String(req.path || "");
  return req.method !== "GET" && (
    path === "/action" ||
    path.startsWith("/agent/tools/") ||
    path.startsWith("/device/commands/")
  );
}

function createRequestControls(config = {}) {
  const rateWindows = new Map();
  const idempotencyCache = new Map();
  const stats = {
    rateLimited: 0,
    idempotencyWrites: 0,
    idempotencyReplays: 0
  };

  function rateLimitMiddleware(req, res, next) {
    if (req.method === "OPTIONS") {
      next();
      return;
    }
    const bucket = rateBucket(req);
    if (!bucket) {
      next();
      return;
    }
    const limit = numberValue(config[bucket.limitKey], bucket.fallback);
    const now = nowMs();
    const windowStart = now - 60 * 1000;
    const key = `${bucket.name}:${clientKey(req)}`;
    const hits = (rateWindows.get(key) || []).filter((time) => time >= windowStart);
    if (hits.length >= limit) {
      stats.rateLimited += 1;
      res.setHeader("Retry-After", "60");
      res.status(429).json({
        ok: false,
        error: "rate limit exceeded",
        data: {
          bucket: bucket.name,
          limit,
          windowSec: 60
        }
      });
      return;
    }
    hits.push(now);
    rateWindows.set(key, hits);
    next();
  }

  function cleanupIdempotency() {
    const ttlMs = numberValue(config.idempotencyTtlMs, 24 * 60 * 60 * 1000);
    const cutoff = nowMs() - ttlMs;
    for (const [key, item] of idempotencyCache.entries()) {
      if (item.createdMs < cutoff) {
        idempotencyCache.delete(key);
      }
    }
  }

  function idempotencyMiddleware(req, res, next) {
    if (!idempotencyPathAllowed(req)) {
      next();
      return;
    }
    cleanupIdempotency();
    const key = idempotencyKey(req);
    if (!key) {
      next();
      return;
    }
    const cacheKey = `${req.method}:${req.path}:${key}`;
    const existing = idempotencyCache.get(cacheKey);
    if (existing) {
      stats.idempotencyReplays += 1;
      res.setHeader("Idempotency-Key", key);
      res.setHeader("Idempotency-Replayed", "true");
      res.status(existing.statusCode).json(existing.body);
      return;
    }

    const originalJson = res.json.bind(res);
    res.json = (body) => {
      if (res.statusCode >= 200 && res.statusCode < 500) {
        idempotencyCache.set(cacheKey, {
          createdMs: nowMs(),
          statusCode: res.statusCode,
          body
        });
        stats.idempotencyWrites += 1;
      }
      res.setHeader("Idempotency-Key", key);
      return originalJson(body);
    };
    next();
  }

  return {
    idempotencyMiddleware,
    rateLimitMiddleware,
    snapshot: () => ({
      generatedAt: new Date().toISOString(),
      rateWindowCount: rateWindows.size,
      idempotencyEntryCount: idempotencyCache.size,
      stats: { ...stats }
    })
  };
}

module.exports = {
  createRequestControls
};

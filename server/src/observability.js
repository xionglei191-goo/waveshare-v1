const crypto = require("crypto");

const SENSITIVE_KEY_RE = /(authorization|cookie|token|secret|password|passwd|apikey|api_key|key)$/i;

function nowIso() {
  return new Date().toISOString();
}

function makeRequestId() {
  return `req_${Date.now()}_${crypto.randomBytes(6).toString("hex")}`;
}

function safeHeader(value) {
  return String(value || "").replace(/[^a-zA-Z0-9._:-]/g, "-").slice(0, 96);
}

function redact(value, depth = 0) {
  if (depth > 5) {
    return "[truncated]";
  }
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => redact(item, depth + 1));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      key,
      SENSITIVE_KEY_RE.test(key) ? "[redacted]" : redact(item, depth + 1)
    ]));
  }
  if (typeof value === "string") {
    return value.slice(0, 500);
  }
  return value;
}

function routeKey(req) {
  const routePath = req.route?.path ? String(req.route.path) : "";
  const baseUrl = String(req.baseUrl || "");
  if (routePath) {
    return `${baseUrl}${routePath}`;
  }
  return `${baseUrl}${req.path || req.originalUrl || "unknown"}`.split("?")[0];
}

function createMetrics() {
  return {
    startedAt: nowIso(),
    requests: {
      total: 0,
      inFlight: 0,
      byStatusClass: {},
      byRoute: {}
    },
    dependencies: {},
    deviceCommands: {
      created: 0,
      acked: 0,
      failed: 0
    },
    lastRequest: null,
    recentErrors: []
  };
}

function percentile(values, p) {
  if (!values.length) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

function summarizeRoute(route) {
  const durations = Array.isArray(route.durationsMs) ? route.durationsMs : [];
  return {
    count: route.count || 0,
    errors: route.errors || 0,
    lastStatus: route.lastStatus || 0,
    lastDurationMs: route.lastDurationMs || 0,
    p50Ms: percentile(durations, 50),
    p95Ms: percentile(durations, 95)
  };
}

function snapshotMetrics(metrics) {
  const routes = Object.fromEntries(Object.entries(metrics.requests.byRoute)
    .sort((a, b) => (b[1].count || 0) - (a[1].count || 0))
    .map(([key, value]) => [key, summarizeRoute(value)]));
  return {
    generatedAt: nowIso(),
    startedAt: metrics.startedAt,
    requests: {
      total: metrics.requests.total,
      inFlight: metrics.requests.inFlight,
      byStatusClass: { ...metrics.requests.byStatusClass },
      routes
    },
    dependencies: redact(metrics.dependencies),
    deviceCommands: { ...metrics.deviceCommands },
    lastRequest: redact(metrics.lastRequest),
    recentErrors: redact(metrics.recentErrors)
  };
}

function createObservability(config = {}) {
  const metrics = createMetrics();

  function recordRequest(req, res, durationMs) {
    const status = Number(res.statusCode || 0);
    const statusClass = `${Math.floor(status / 100)}xx`;
    const key = `${req.method} ${routeKey(req)}`;
    const route = metrics.requests.byRoute[key] || {
      count: 0,
      errors: 0,
      durationsMs: []
    };
    route.count += 1;
    route.errors += status >= 500 ? 1 : 0;
    route.lastStatus = status;
    route.lastDurationMs = durationMs;
    route.durationsMs.push(durationMs);
    route.durationsMs = route.durationsMs.slice(-200);
    metrics.requests.byRoute[key] = route;
    metrics.requests.total += 1;
    metrics.requests.byStatusClass[statusClass] = (metrics.requests.byStatusClass[statusClass] || 0) + 1;
    metrics.lastRequest = {
      at: nowIso(),
      requestId: req.requestId,
      method: req.method,
      route: key,
      status,
      durationMs
    };
    if (status >= 500) {
      metrics.recentErrors.unshift(metrics.lastRequest);
      metrics.recentErrors = metrics.recentErrors.slice(0, 50);
    }
  }

  function middleware(req, res, next) {
    const startedAt = Date.now();
    const incomingId = safeHeader(req.get("x-request-id") || req.get("x-correlation-id") || "");
    req.requestId = incomingId || makeRequestId();
    metrics.requests.inFlight += 1;
    res.setHeader("X-Request-Id", req.requestId);

    const originalJson = res.json.bind(res);
    res.json = (body) => {
      if (body && typeof body === "object" && !Array.isArray(body) && body.requestId === undefined) {
        body.requestId = req.requestId;
      }
      return originalJson(body);
    };

    res.on("finish", () => {
      metrics.requests.inFlight = Math.max(0, metrics.requests.inFlight - 1);
      const durationMs = Date.now() - startedAt;
      recordRequest(req, res, durationMs);
      if (config.requestLogJson !== false) {
        console.log(JSON.stringify({
          type: "http.request",
          at: nowIso(),
          requestId: req.requestId,
          method: req.method,
          path: req.originalUrl,
          route: routeKey(req),
          status: res.statusCode,
          durationMs
        }));
      }
    });
    next();
  }

  function recordDependency(name, result = {}) {
    const key = String(name || "unknown").slice(0, 80);
    const current = metrics.dependencies[key] || {
      calls: 0,
      successes: 0,
      failures: 0,
      lastStatus: "",
      lastDurationMs: null,
      lastError: ""
    };
    current.calls += 1;
    if (result.ok === false || result.error) {
      current.failures += 1;
    } else {
      current.successes += 1;
    }
    current.lastStatus = String(result.status || result.statusCode || result.httpCode || (result.ok === false ? "failed" : "ok")).slice(0, 80);
    current.lastDurationMs = Number.isFinite(Number(result.durationMs)) ? Number(result.durationMs) : current.lastDurationMs;
    current.lastError = result.error ? String(result.error).slice(0, 240) : "";
    current.lastAt = nowIso();
    metrics.dependencies[key] = current;
  }

  return {
    middleware,
    metrics,
    recordDependency,
    snapshot: () => snapshotMetrics(metrics)
  };
}

module.exports = {
  createObservability,
  redact
};

const express = require("express");
const fs = require("fs");
const path = require("path");

const { adminPageMiddleware } = require("./admin-auth");
const { createStore } = require("./store");
const { createApiRouter } = require("./routes");
const { createEventBus } = require("./events");
const { ensureServerMediaLibrary, refreshPodcastFeeds } = require("./media");
const { createObservability } = require("./observability");
const { ensureResourceLayout } = require("./resources");
const { refreshWeatherStore } = require("./weather");

function createServer(config) {
  const app = express();
  fs.mkdirSync(config.resourceDir, { recursive: true });
  ensureResourceLayout(config);
  ensureServerMediaLibrary(config);
  const store = createStore(config);
  const eventBus = createEventBus();
  const observability = createObservability(config);
  config.observability = observability;
  if (config.weatherProvider === "open-meteo") {
    const runWeatherRefresh = () => {
      refreshWeatherStore(store, config).then((result) => {
        observability.recordDependency("weather.open-meteo", result);
        if (!result.ok) {
          console.warn(`[weather] refresh failed, using cache: ${result.error}`);
        } else {
          eventBus.publish("summary.updated", { reason: "weather.scheduled_refresh" });
        }
      }).catch((error) => {
        console.warn(`[weather] refresh failed: ${error.message}`);
      });
    };
    setTimeout(runWeatherRefresh, 1000).unref();
    const intervalMs = Math.max(1, Number(config.weatherRefreshIntervalMinutes) || 30) * 60 * 1000;
    setInterval(runWeatherRefresh, intervalMs).unref();
  }
  if (Number(config.podcastRefreshIntervalMinutes || 0) > 0) {
    const intervalMs = Math.max(1, Number(config.podcastRefreshIntervalMinutes)) * 60 * 1000;
    const runPodcastRefresh = () => {
      refreshPodcastFeeds(store, config).catch((error) => {
        console.warn(`[podcast] scheduled refresh failed: ${error.message}`);
      });
    };
    setTimeout(runPodcastRefresh, 5000).unref();
    setInterval(runPodcastRefresh, intervalMs).unref();
  }

  app.disable("x-powered-by");
  app.use(observability.middleware);
  app.use(express.json({ limit: "6mb" }));
  app.use((req, res, next) => {
    const origin = String(req.get("origin") || "");
    let originAllowed = false;
    if (origin) {
      try {
        const originUrl = new URL(origin);
        const configured = new Set(config.corsAllowedOrigins || []);
        const publicOrigin = new URL(config.publicBaseUrl).origin;
        originAllowed = configured.has(origin) || origin === publicOrigin ||
          /^(localhost|127\.0\.0\.1|192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(originUrl.hostname);
      } catch (error) {
        originAllowed = false;
      }
    }
    if (originAllowed) res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Admin-Token, X-Device-Token, X-AI-Tool-Token, X-Xiaozhi-Tool-Token, X-Request-Id, X-Correlation-Id, Idempotency-Key");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }
    next();
  });

  app.get("/", (req, res) => {
    res.json({
      ok: true,
      name: config.name,
      version: config.version,
      api: "/api/health",
      admin: "/admin",
      companion: "/companion"
    });
  });

  app.get("/admin", adminPageMiddleware(config, store), (req, res) => {
    res.sendFile(path.join(__dirname, "..", "public", "admin.html"));
  });

  app.get("/companion", (req, res) => {
    res.sendFile(path.join(__dirname, "..", "public", "companion.html"));
  });

  // PWA assets (manifest + icons). Scoped to the pwa/ subdirectory so the
  // admin-token protection on /admin (admin.html) is never bypassed.
  const pwaDir = path.join(__dirname, "..", "public", "pwa");
  app.use(
    "/pwa",
    express.static(pwaDir, {
      setHeaders(res, filePath) {
        if (filePath.endsWith(".webmanifest")) {
          res.setHeader("Content-Type", "application/manifest+json; charset=utf-8");
        }
      }
    })
  );

  // Service worker must be served from the root so its control scope can cover
  // /companion. The Service-Worker-Allowed header widens the scope to "/".
  app.get("/sw.js", (req, res) => {
    res.setHeader("Content-Type", "text/javascript; charset=utf-8");
    res.setHeader("Service-Worker-Allowed", "/");
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(path.join(pwaDir, "sw.js"));
  });

  app.use("/api", createApiRouter(store, config, eventBus, observability));

  app.use((req, res) => {
    res.status(404).json({
      ok: false,
      error: `not found: ${req.method} ${req.path}`
    });
  });

  app.use((error, req, res, next) => {
    if (res.headersSent) {
      next(error);
      return;
    }
    const status = error.statusCode || 500;
    res.status(status).json({
      ok: false,
      error: error.message || "internal error"
    });
  });

  return { app, store, eventBus };
}

module.exports = {
  createServer,
  createApiRouter
};

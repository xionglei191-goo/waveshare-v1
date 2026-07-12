const SOURCE_STATUSES = new Set(["real", "cached", "mock", "simulated", "unavailable"]);

function sourceStatus(value, fallback = "unavailable") {
  return SOURCE_STATUSES.has(value) ? value : fallback;
}

function weatherSourceStatus(weather = {}, configuredProvider = "mock") {
  if (configuredProvider === "mock" || weather.provider === "mock") return "mock";
  if (weather.lastRefreshError && weather.updatedAt) return "cached";
  if (weather.provider === "open-meteo" && weather.updatedAt) return "real";
  return "unavailable";
}

function executionSourceStatus(configured, simulated = false) {
  if (simulated) return "simulated";
  return configured ? "real" : "unavailable";
}

module.exports = {
  SOURCE_STATUSES,
  executionSourceStatus,
  sourceStatus,
  weatherSourceStatus
};

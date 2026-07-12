const assert = require("node:assert/strict");
const test = require("node:test");

const { createInitialState } = require("../src/fixtures");
const { prepareCapability } = require("../src/capabilities");

test("ordinary weather query returns cached state without external refresh", async () => {
  const state = createInitialState();
  state.weather = {
    provider: "open-meteo",
    updatedAt: new Date().toISOString(),
    condition: "晴",
    summary: "晴 25℃",
    temperature: 25
  };
  const prepared = await prepareCapability("family.weather.today", {}, state, {
    weatherProvider: "open-meteo",
    weatherAgentCacheMaxAgeMs: 35 * 60 * 1000,
    weatherAgentRefreshTimeoutMs: 800
  });
  assert.equal(prepared.weather.condition, "晴");
  assert.equal(prepared.weatherRefresh.cached, true);
  assert.equal(prepared.weatherRefresh.skipped, true);
});

test("explicit weather refresh returns cached state at the agent timeout", async () => {
  const state = createInitialState();
  state.weather = {
    provider: "open-meteo",
    updatedAt: new Date().toISOString(),
    condition: "晴",
    summary: "晴 25℃",
    temperature: 25
  };
  const startedAt = Date.now();
  const prepared = await prepareCapability("family.weather.today", { forceRefresh: true }, state, {
    weatherProvider: "open-meteo",
    weatherAgentCacheMaxAgeMs: 35 * 60 * 1000,
    weatherAgentRefreshTimeoutMs: 100
  }, {
    fetchImpl: (_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true });
    })
  });
  const elapsedMs = Date.now() - startedAt;
  assert.equal(prepared.weather.condition, "晴");
  assert.equal(prepared.weatherRefresh.ok, false);
  assert.equal(prepared.weatherRefresh.cached, true);
  assert.match(prepared.weatherRefresh.error, /abort/i);
  assert.ok(elapsedMs >= 80 && elapsedMs < 500, `unexpected refresh timeout: ${elapsedMs}ms`);
});

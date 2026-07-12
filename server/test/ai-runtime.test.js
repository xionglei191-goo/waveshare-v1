const assert = require("node:assert/strict");
const test = require("node:test");

const { createInitialState } = require("../src/fixtures");
const { summarizeAiLatency, upsertAiTrace } = require("../src/ai-runtime");

test("latency summary separates deterministic and model-backed turns", () => {
  const state = createInitialState();
  upsertAiTrace(state, { traceId: "d1", status: "handled", timings: { firstAudioMs: 800 } });
  upsertAiTrace(state, { traceId: "l1", status: "fallback", modelTier: "lightweight", timings: { firstAudioMs: 2400 } });
  upsertAiTrace(state, { traceId: "l2", status: "failed", modelTier: "lightweight", timings: { firstAudioMs: 6000 }, errorType: "Timeout" });
  upsertAiTrace(state, { traceId: "c1", status: "fallback", modelTier: "complex", timings: { firstAudioMs: 9000 } });

  const summary = summarizeAiLatency(state);
  assert.equal(summary.deterministic.firstAudioP50Ms, 800);
  assert.equal(summary.lightweight.firstAudioP50Ms, 2400);
  assert.equal(summary.lightweight.firstAudioP95Ms, 6000);
  assert.equal(summary.lightweight.failureRate, 0.5);
  assert.equal(summary.complex.firstAudioP95Ms, 9000);
});

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  executableStatus,
  runOpenClaw,
  runOpenClawSync
} = require("../src/adapters/openclaw");

test("openclaw adapter checks executables and preserves sync output", () => {
  assert.equal(executableStatus(""), "missing command");
  assert.equal(executableStatus("/definitely/missing/openclaw"), "command not found");
  assert.equal(executableStatus("/bin/echo"), "");
  const result = runOpenClawSync("/bin/echo", "diagnostics", 1000);
  assert.equal(result.status, 0);
  assert.equal(result.timedOut, false);
  assert.equal(result.stdout, "diagnostics");
});

test("openclaw adapter executes asynchronously without leaking process details", async () => {
  const result = await runOpenClaw("/bin/echo", "music", 1000);
  assert.equal(result.status, 0);
  assert.equal(result.timedOut, false);
  assert.equal(result.stdout, "music");
  assert.equal(result.stderr, "");
});

const assert = require("node:assert/strict");
const test = require("node:test");

const { createRequestControls } = require("../src/request-controls");

function request(path, headers = {}) {
  return {
    method: "POST",
    path,
    body: {},
    ip: "127.0.0.1",
    get(name) { return headers[String(name).toLowerCase()] || ""; }
  };
}

function response() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(name, value) { this.headers[String(name).toLowerCase()] = String(value); },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

test("rate limiting rejects requests beyond the configured bucket limit", () => {
  const controls = createRequestControls({ rateLimitActionPerMinute: 2 });
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    let called = false;
    controls.rateLimitMiddleware(request("/action"), response(), () => { called = true; });
    assert.equal(called, true);
  }
  const blocked = response();
  let called = false;
  controls.rateLimitMiddleware(request("/action"), blocked, () => { called = true; });
  assert.equal(called, false);
  assert.equal(blocked.statusCode, 429);
  assert.equal(blocked.headers["retry-after"], "60");
  assert.equal(controls.snapshot().stats.rateLimited, 1);
});

test("idempotency replays the first response without invoking business logic", () => {
  const controls = createRequestControls({ idempotencyTtlMs: 60_000 });
  const headers = { "idempotency-key": "same-command" };
  const first = response();
  let executions = 0;
  controls.idempotencyMiddleware(request("/action", headers), first, () => {
    executions += 1;
    first.status(202).json({ ok: true, data: { commandId: "cmd-1" } });
  });
  const replay = response();
  controls.idempotencyMiddleware(request("/action", headers), replay, () => { executions += 1; });
  assert.equal(executions, 1);
  assert.equal(replay.statusCode, 202);
  assert.deepEqual(replay.body, first.body);
  assert.equal(replay.headers["idempotency-replayed"], "true");
  assert.deepEqual(controls.snapshot().stats, {
    rateLimited: 0,
    idempotencyWrites: 1,
    idempotencyReplays: 1
  });
});

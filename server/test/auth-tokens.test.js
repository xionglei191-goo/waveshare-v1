const assert = require("node:assert/strict");
const test = require("node:test");

const {
  createAuthToken,
  listAuthTokens,
  revokeAuthToken,
  rotateAuthToken,
  verifyAuthToken
} = require("../src/auth-tokens");
const { createInitialState } = require("../src/fixtures");

test("managed tokens store only hashes and enforce scopes", () => {
  const state = createInitialState();
  const created = createAuthToken(state, { kind: "device", name: "round screen" });
  assert.match(created.token, /^fh_device_/);
  assert.equal(JSON.stringify(state).includes(created.token), false);
  assert.equal(state.security.tokens[0].tokenHash.length, 64);
  assert.ok(verifyAuthToken(state, created.token, "device:write"));
  assert.equal(verifyAuthToken(state, created.token, "agent:invoke"), null);
});

test("token rotation revokes the old token and returns a new secret once", () => {
  const state = createInitialState();
  const first = createAuthToken(state, { kind: "agent" });
  const rotated = rotateAuthToken(state, first.record.id);
  assert.equal(verifyAuthToken(state, first.token, "agent:invoke"), null);
  assert.ok(verifyAuthToken(state, rotated.token, "agent:invoke"));
  revokeAuthToken(state, rotated.record.id);
  assert.equal(verifyAuthToken(state, rotated.token, "agent:invoke"), null);
  assert.equal(listAuthTokens(state).length, 2);
});

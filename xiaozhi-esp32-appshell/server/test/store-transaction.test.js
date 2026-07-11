const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { SqliteStore } = require("../src/sqlite-store");

function store() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "family-store-"));
  return new SqliteStore(path.join(dir, "state.sqlite"));
}

test("failed mutations do not alter in-memory or persisted state", () => {
  const instance = store();
  const before = instance.snapshot().familyMode;
  assert.throws(() => instance.update((state) => {
    state.familyMode = "儿童";
    throw new Error("stop");
  }), /stop/);
  assert.equal(instance.snapshot().familyMode, before);
});

test("twenty queued async writes do not lose updates", async () => {
  const instance = store();
  const before = instance.snapshot().sync.stats.received;
  await Promise.all(Array.from({ length: 20 }, () => instance.updateAsync(async (state) => {
    await Promise.resolve();
    state.sync.stats.received += 1;
  })));
  assert.equal(instance.snapshot().sync.stats.received, before + 20);
  assert.equal(instance.schemaInfo().integrity, "ok");
  assert.equal(instance.schemaInfo().mirrorConsistency.ok, true);
});

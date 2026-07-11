const fs = require("fs");
const path = require("path");

const { createInitialState } = require("./fixtures");
const { SqliteStore, sqliteAvailable } = require("./sqlite-store");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function mergeDefaults(state, defaults) {
  if (Array.isArray(defaults)) {
    return Array.isArray(state) ? state : clone(defaults);
  }
  if (defaults && typeof defaults === "object") {
    const output = state && typeof state === "object" && !Array.isArray(state) ? { ...state } : {};
    for (const [key, value] of Object.entries(defaults)) {
      output[key] = mergeDefaults(output[key], value);
    }
    return output;
  }
  return state === undefined ? defaults : state;
}

class JsonStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.driver = "json";
    this.state = createInitialState();
    this.load();
  }

  load() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    if (!fs.existsSync(this.filePath)) {
      this.save();
      return;
    }

    const raw = fs.readFileSync(this.filePath, "utf8");
    const parsed = raw.trim() ? JSON.parse(raw) : {};
    this.state = mergeDefaults(parsed, createInitialState());
    this.save();
  }

  save(sourceState = this.state) {
    const nextState = {
      ...sourceState,
      updatedAt: new Date().toISOString()
    };
    fs.writeFileSync(this.filePath, `${JSON.stringify(nextState, null, 2)}\n`);
    this.state = nextState;
  }

  snapshot() {
    return clone(this.state);
  }

  update(mutator) {
    const draft = clone(this.state);
    mutator(draft);
    this.save(draft);
    return this.snapshot();
  }

  async updateAsync(mutator) {
    const draft = clone(this.state);
    await mutator(draft);
    this.save(draft);
    return this.snapshot();
  }

  reset() {
    this.state = createInitialState();
    this.save();
    return this.snapshot();
  }
}

function createStore(config) {
  if (config.storeDriver === "sqlite") {
    if (sqliteAvailable()) {
      return new SqliteStore(config.sqliteFile, config.stateFile, {
        relationalReads: Boolean(config.sqliteRelationalReads),
        compactKv: Boolean(config.sqliteCompactKv)
      });
    }
    throw new Error("STORE_DRIVER=sqlite requested, but this Node.js runtime does not provide node:sqlite.");
  }
  return new JsonStore(config.stateFile);
}

module.exports = {
  createStore,
  JsonStore,
  clone
};

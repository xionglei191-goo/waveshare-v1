function ensureSyncState(state) {
  if (!state.sync || typeof state.sync !== "object") {
    state.sync = {};
  }
  if (!Array.isArray(state.sync.events)) {
    state.sync.events = [];
  }
  if (!state.sync.stats || typeof state.sync.stats !== "object") {
    state.sync.stats = { received: 0, lastPushAt: null };
  }
  return state.sync;
}

function normalizeEvents(body) {
  if (Array.isArray(body?.events)) {
    return body.events;
  }
  if (body?.event && typeof body.event === "object") {
    return [body.event];
  }
  return [];
}

function applyPushedEvents(state, body) {
  const sync = ensureSyncState(state);
  const events = normalizeEvents(body).slice(0, 32).map((event) => ({
    id: String(event.id || `evt_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`),
    type: String(event.type || "unknown"),
    createdAt: event.createdAt || new Date().toISOString(),
    receivedAt: new Date().toISOString(),
    payload: event.payload || {}
  }));

  sync.events.unshift(...events);
  sync.events = sync.events.slice(0, 200);
  sync.stats.received += events.length;
  sync.stats.lastPushAt = new Date().toISOString();
  return {
    accepted: events.length,
    totalReceived: sync.stats.received,
    lastPushAt: sync.stats.lastPushAt
  };
}

function buildPullPayload(state, config) {
  const sync = ensureSyncState(state);
  return {
    schema: 1,
    serverTime: new Date().toISOString(),
    familyMode: state.familyMode,
    backend: {
      name: config.name,
      version: config.version,
      publicBaseUrl: config.publicBaseUrl
    },
    sync: {
      pendingServerEvents: 0,
      received: sync.stats.received,
      lastPushAt: sync.stats.lastPushAt
    },
    commands: []
  };
}

module.exports = {
  applyPushedEvents,
  buildPullPayload,
  ensureSyncState
};

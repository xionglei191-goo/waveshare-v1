function nowIso() {
  return new Date().toISOString();
}

function safeId(value, fallback = "item") {
  const text = String(value || fallback)
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 64);
  return text || fallback;
}

function safeText(value, limit = 240) {
  return String(value || "").trim().slice(0, limit);
}

function safeTags(tags) {
  return Array.isArray(tags)
    ? tags.map((tag) => safeText(tag, 24)).filter(Boolean).slice(0, 8)
    : [];
}

function safeNumber(value, fallback, min, max) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function isExpired(item, now = Date.now()) {
  if (!item.expiresAt) {
    return false;
  }
  const expiresAt = Date.parse(item.expiresAt);
  return Number.isFinite(expiresAt) && expiresAt <= now;
}

function ensureMemoryState(state) {
  state.memory = state.memory || {};
  state.memory.items = Array.isArray(state.memory.items) ? state.memory.items : [];
  state.memory.recentContext = Array.isArray(state.memory.recentContext) ? state.memory.recentContext : [];
  state.memory.lastUpdatedAt = state.memory.lastUpdatedAt || null;

  state.learning = state.learning || {};
  state.learning.records = Array.isArray(state.learning.records) ? state.learning.records : [];
  state.learning.lastRecordAt = state.learning.lastRecordAt || null;
}

function listMemory(state, filters = {}) {
  ensureMemoryState(state);
  const memberId = safeText(filters.memberId || filters.member || "", 48);
  const visibility = safeText(filters.visibility || filters.scope || "", 32);
  const includeDeleted = Boolean(filters.includeDeleted);
  const includeExpired = Boolean(filters.includeExpired);
  const includeFamily = filters.includeFamily !== false;
  const query = safeText(filters.query || filters.text || "", 160).toLowerCase();
  const terms = query.split(/\s+/).filter((term) => term.length > 1).slice(0, 12);
  const limit = safeNumber(filters.limit, 300, 1, 300);

  return state.memory.items.filter((item) => {
    if (!includeDeleted && item.deletedAt) {
      return false;
    }
    if (!includeExpired && isExpired(item)) {
      return false;
    }
    if (memberId) {
      const ownMemory = item.memberId === memberId;
      const sharedFamilyMemory = includeFamily && item.visibility === "family";
      if (!ownMemory && !sharedFamilyMemory) {
        return false;
      }
    }
    if (visibility && item.visibility !== visibility) {
      return false;
    }
    if (terms.length > 0) {
      const haystack = `${item.title || ""} ${item.text || ""} ${(item.tags || []).join(" ")} ${item.kind || ""}`.toLowerCase();
      if (!terms.some((term) => haystack.includes(term))) {
        return false;
      }
    }
    return true;
  }).sort((a, b) => {
    const importance = Number(b.importance || 3) - Number(a.importance || 3);
    if (importance !== 0) {
      return importance;
    }
    return String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""));
  }).slice(0, limit);
}

function createMemory(state, body = {}) {
  ensureMemoryState(state);
  const text = safeText(body.text || body.value || body.note || "");
  if (!text) {
    const error = new Error("memory text is required");
    error.statusCode = 400;
    throw error;
  }

  const now = nowIso();
  let expiresAt = null;
  if (body.expiresAt) {
    const parsed = new Date(body.expiresAt);
    if (Number.isNaN(parsed.getTime())) {
      const error = new Error("invalid memory expiresAt");
      error.statusCode = 400;
      throw error;
    }
    expiresAt = parsed.toISOString();
  }
  const item = {
    id: safeId(body.id || `mem_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`, "memory"),
    title: safeText(body.title || text, 64),
    text,
    memberId: safeText(body.memberId || body.member || "family", 48),
    visibility: safeText(body.visibility || body.scope || "family", 32),
    kind: safeText(body.kind || body.type || "fact", 32),
    importance: safeNumber(body.importance, 3, 1, 5),
    expiresAt,
    source: safeText(body.source || "manual", 32),
    tags: safeTags(body.tags),
    createdAt: now,
    updatedAt: now,
    deletedAt: null
  };
  state.memory.items.unshift(item);
  state.memory.items = state.memory.items.slice(0, 300);
  state.memory.lastUpdatedAt = now;
  return item;
}

function updateMemory(state, id, body = {}) {
  ensureMemoryState(state);
  const item = state.memory.items.find((entry) => entry.id === id && !entry.deletedAt);
  if (!item) {
    const error = new Error("memory not found");
    error.statusCode = 404;
    throw error;
  }
  if (body.title !== undefined) {
    item.title = safeText(body.title, 64);
  }
  if (body.text !== undefined || body.value !== undefined || body.note !== undefined) {
    const nextText = safeText(body.text || body.value || body.note || "");
    if (!nextText) {
      const error = new Error("memory text is required");
      error.statusCode = 400;
      throw error;
    }
    item.text = nextText;
  }
  if (body.memberId !== undefined || body.member !== undefined) {
    item.memberId = safeText(body.memberId || body.member || "family", 48);
  }
  if (body.visibility !== undefined || body.scope !== undefined) {
    item.visibility = safeText(body.visibility || body.scope || "family", 32);
  }
  if (body.kind !== undefined || body.type !== undefined) {
    item.kind = safeText(body.kind || body.type || "fact", 32);
  }
  if (body.importance !== undefined) {
    item.importance = safeNumber(body.importance, 3, 1, 5);
  }
  if (body.expiresAt !== undefined) {
    if (!body.expiresAt) {
      item.expiresAt = null;
    } else {
      const parsed = new Date(body.expiresAt);
      if (Number.isNaN(parsed.getTime())) {
        const error = new Error("invalid memory expiresAt");
        error.statusCode = 400;
        throw error;
      }
      item.expiresAt = parsed.toISOString();
    }
  }
  if (body.tags !== undefined) {
    item.tags = safeTags(body.tags);
  }
  item.updatedAt = nowIso();
  state.memory.lastUpdatedAt = item.updatedAt;
  return item;
}

function deleteMemory(state, id) {
  ensureMemoryState(state);
  const item = state.memory.items.find((entry) => entry.id === id && !entry.deletedAt);
  if (!item) {
    const error = new Error("memory not found");
    error.statusCode = 404;
    throw error;
  }
  item.deletedAt = nowIso();
  item.updatedAt = item.deletedAt;
  state.memory.lastUpdatedAt = item.deletedAt;
  return item;
}

function addLearningRecord(state, body = {}) {
  ensureMemoryState(state);
  const now = nowIso();
  const record = {
    id: safeId(body.id || `learn_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`, "learning"),
    at: body.at || now,
    memberId: safeText(body.memberId || body.member || "child", 48),
    type: safeText(body.type || "english", 32),
    title: safeText(body.title || body.topic || "学习记录", 80),
    score: Number(body.score || 0),
    progress: safeText(body.progress || "", 32),
    source: safeText(body.source || "device", 32),
    metadata: body.metadata && typeof body.metadata === "object" ? body.metadata : {}
  };
  state.learning.records.unshift(record);
  state.learning.records = state.learning.records.slice(0, 500);
  state.learning.lastRecordAt = record.at;
  return record;
}

function listLearningRecords(state, filters = {}) {
  ensureMemoryState(state);
  const memberId = safeText(filters.memberId || filters.member || "", 48);
  const type = safeText(filters.type || "", 32);
  return state.learning.records.filter((record) => {
    if (memberId && record.memberId !== memberId) {
      return false;
    }
    if (type && record.type !== type) {
      return false;
    }
    return true;
  });
}

function recordAgentInteraction(state, body = {}) {
  ensureMemoryState(state);
  const storeConversationText = body.storeConversationText === true;
  const utterance = safeText(body.utterance || "", 180);
  const speech = safeText(body.speech || "", 180);
  const item = {
    id: safeId(body.id || `ctx_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`, "context"),
    at: body.at || nowIso(),
    memberId: safeText(body.memberId || "device", 48),
    page: safeText(body.page || "ai", 32),
    agent: safeText(body.agent || "general", 32),
    intent: safeText(body.intent || "", 64),
    utteranceLength: utterance.length,
    speechLength: speech.length
  };
  if (storeConversationText) {
    item.utterance = utterance;
    item.speech = speech;
  }
  state.memory.recentContext.unshift(item);
  state.memory.recentContext = state.memory.recentContext.slice(0, 100);
  return item;
}

module.exports = {
  addLearningRecord,
  createMemory,
  deleteMemory,
  ensureMemoryState,
  listLearningRecords,
  listMemory,
  recordAgentInteraction,
  updateMemory
};

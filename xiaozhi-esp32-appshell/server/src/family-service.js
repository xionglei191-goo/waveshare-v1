const { normalizeMember: normalizeMemberProfile } = require("./member-context");
const { DEFAULT_POLICIES, auditAction, ensureSecurityState } = require("./security");

function safeFamilyText(value, fallback = "", limit = 80) {
  return String(value || fallback).replace(/[<>]/g, "").trim().slice(0, limit);
}

function normalizeRelationship(value, role = "") {
  const text = safeFamilyText(value, "", 16);
  if (["爸爸", "妈妈", "监护人", "孩子", "访客"].includes(text)) return text;
  return role === "child" ? "孩子" : role === "guest" ? "访客" : "监护人";
}

function safeMemberId(value) {
  return String(value || "").replace(/[^a-zA-Z0-9._-]/g, "_").replace(/^_+|_+$/g, "").slice(0, 48);
}

function familyModeForMemberRole(role) {
  return role === "child" ? "儿童" : role === "guest" ? "访客" : "默认";
}

function normalizeFamilyMember(body = {}, fallbackId = "") {
  const id = safeMemberId(body.id || body.memberId || fallbackId);
  if (!id) {
    const error = new Error("member id is required");
    error.statusCode = 400;
    throw error;
  }
  const role = safeFamilyText(body.role, "", 32);
  if (!["parent", "child", "guest"].includes(role)) {
    const error = new Error("member role must be parent, child, or guest");
    error.statusCode = 400;
    throw error;
  }
  return normalizeMemberProfile({
    id,
    name: safeFamilyText(body.name, id, 48),
    role,
    relationship: normalizeRelationship(body.relationship, role),
    profileVersion: Number(body.profileVersion || 1) || 1,
    createdAt: body.createdAt,
    updatedAt: body.updatedAt,
    archivedAt: body.archivedAt,
    status: safeFamilyText(body.status, "unknown", 48),
    avatar: safeFamilyText(body.avatar, "", 160),
    notes: safeFamilyText(body.notes, "", 240),
    profile: body.profile,
    persona: body.persona,
    memoryPolicy: body.memoryPolicy
  });
}

function upsertFamilyMember(state, body = {}, fallbackId = "") {
  ensureSecurityState(state);
  const requestedId = safeMemberId(body.id || body.memberId || fallbackId);
  const existing = state.family.members.find((item) => item.id === requestedId);
  const next = normalizeFamilyMember({
    ...(existing || {}),
    ...body,
    relationship: body.relationship || existing?.relationship,
    profileVersion: existing?.profileVersion || body.profileVersion || 1,
    profile: { ...(existing?.profile || {}), ...(body.profile || {}) },
    persona: { ...(existing?.persona || {}), ...(body.persona || {}) },
    memoryPolicy: { ...(existing?.memoryPolicy || {}), ...(body.memoryPolicy || {}) }
  }, fallbackId);
  const updatedAt = new Date().toISOString();
  if (existing) {
    Object.assign(existing, {
      ...next,
      id: existing.id,
      relationship: normalizeRelationship(next.relationship || existing.relationship, next.role || existing.role),
      profileVersion: Math.max(1, Number(existing.profileVersion || 1) + 1),
      createdAt: existing.createdAt || updatedAt,
      updatedAt
    });
    return existing;
  }
  const item = { ...next, profileVersion: 1, createdAt: updatedAt, updatedAt };
  state.family.members.unshift(item);
  state.family.members = state.family.members.slice(0, 32);
  return item;
}

function repairActiveMemberPointers(state, removedId = "") {
  for (const [mode, activeId] of Object.entries(state.family.activeMembers || {})) {
    if (!removedId || activeId === removedId) {
      const role = mode === "儿童" ? "child" : mode === "访客" ? "guest" : "parent";
      state.family.activeMembers[mode] = state.family.members.find((member) => member.role === role && !member.archivedAt)?.id || "";
    }
  }
}

function exportFamilyMember(state, memberId) {
  ensureSecurityState(state);
  const id = safeMemberId(memberId);
  const member = state.family.members.find((item) => item.id === id);
  if (!member) {
    const error = new Error("family member not found");
    error.statusCode = 404;
    throw error;
  }
  return {
    schema: 1,
    exportedAt: new Date().toISOString(),
    member: normalizeMemberProfile(member),
    memory: (state.memory?.items || []).filter((item) => item.memberId === id),
    learning: (state.learning?.records || []).filter((item) => item.memberId === id),
    recentInteractions: (state.memory?.recentContext || []).filter((item) => item.memberId === id)
  };
}

function archiveFamilyMember(state, memberId) {
  ensureSecurityState(state);
  const id = safeMemberId(memberId);
  if (["parent", "child", "guest"].includes(id)) {
    const error = new Error("built-in fallback members cannot be archived");
    error.statusCode = 400;
    throw error;
  }
  const member = state.family.members.find((item) => item.id === id);
  if (!member) {
    const error = new Error("family member not found");
    error.statusCode = 404;
    throw error;
  }
  member.archivedAt = member.archivedAt || new Date().toISOString();
  member.updatedAt = member.archivedAt;
  member.status = "archived";
  member.profileVersion = Math.max(1, Number(member.profileVersion || 1) + 1);
  repairActiveMemberPointers(state, id);
  return normalizeMemberProfile(member);
}

function deleteFamilyMember(state, memberId, options = {}) {
  ensureSecurityState(state);
  const id = safeMemberId(memberId);
  if (["parent", "child", "guest"].includes(id)) {
    const error = new Error("built-in fallback members cannot be deleted");
    error.statusCode = 400;
    throw error;
  }
  if (safeMemberId(options.confirmId) !== id) {
    const error = new Error("confirmId must match the member id");
    error.statusCode = 400;
    throw error;
  }
  const memoryAction = ["delete", "transfer", "retain"].includes(options.memoryAction) ? options.memoryAction : "";
  if (!memoryAction) {
    const error = new Error("memoryAction must be delete, transfer, or retain");
    error.statusCode = 400;
    throw error;
  }
  const targetId = safeMemberId(options.targetMemberId);
  if (memoryAction === "transfer" && !state.family.members.some((item) => item.id === targetId && item.id !== id && !item.archivedAt)) {
    const error = new Error("valid targetMemberId is required for memory transfer");
    error.statusCode = 400;
    throw error;
  }
  if (!state.family.members.some((item) => item.id === id)) {
    const error = new Error("family member not found");
    error.statusCode = 404;
    throw error;
  }
  state.family.members = state.family.members.filter((item) => item.id !== id);
  const memory = state.memory?.items || [];
  const learning = state.learning?.records || [];
  const interactions = state.memory?.recentContext || [];
  const affected = {
    memory: memory.filter((item) => item.memberId === id).length,
    learning: learning.filter((item) => item.memberId === id).length,
    recentInteractions: interactions.filter((item) => item.memberId === id).length
  };
  const destination = memoryAction === "transfer" ? targetId : "family";
  if (memoryAction === "delete") {
    state.memory.items = memory.filter((item) => item.memberId !== id);
    state.learning.records = learning.filter((item) => item.memberId !== id);
    state.memory.recentContext = interactions.filter((item) => item.memberId !== id);
  } else {
    for (const item of [...memory, ...learning, ...interactions]) if (item.memberId === id) item.memberId = destination;
  }
  repairActiveMemberPointers(state, id);
  return { id, deleted: true, memoryAction, targetMemberId: destination, affected };
}

function normalizePolicyPatch(body = {}) {
  const source = body.policy && typeof body.policy === "object" ? body.policy : body;
  const allowed = new Set(Object.keys(DEFAULT_POLICIES["默认"] || {}));
  return Object.fromEntries(Object.keys(source).filter((key) => allowed.has(key)).map((key) => [key, Boolean(source[key])]));
}

function auditAdminFamily(state, action, params = {}, requestId = "") {
  auditAction(state, action, { ...params, requestId, memberId: params.memberId || "admin" }, {
    allowed: true,
    category: "family",
    mode: state.familyMode || "默认",
    reason: "admin family management"
  });
}

module.exports = {
  archiveFamilyMember,
  auditAdminFamily,
  deleteFamilyMember,
  exportFamilyMember,
  familyModeForMemberRole,
  normalizeFamilyMember,
  normalizePolicyPatch,
  normalizeRelationship,
  repairActiveMemberPointers,
  safeFamilyText,
  safeMemberId,
  upsertFamilyMember
};

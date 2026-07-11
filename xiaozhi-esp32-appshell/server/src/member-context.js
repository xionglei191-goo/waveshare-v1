const { listMemory, listLearningRecords } = require("./memory");

const FAMILY_MODES = ["默认", "儿童", "访客"];
const MODE_ROLES = {
  默认: "parent",
  儿童: "child",
  访客: "guest"
};
const GENERIC_MEMBER_IDS = new Set(["", "device", "xiaozhi", "family", "current"]);
const RELATIONSHIPS = new Set(["爸爸", "妈妈", "监护人", "孩子", "访客"]);

function safeText(value, limit = 240) {
  return String(value || "").replace(/[<>]/g, "").trim().slice(0, limit);
}

function safeList(value, limit = 8, itemLimit = 48) {
  const items = Array.isArray(value)
    ? value
    : String(value || "").split(/[,，\n]/);
  return items
    .map((item) => safeText(item, itemLimit))
    .filter(Boolean)
    .slice(0, limit);
}

function defaultProfile(member = {}) {
  return {
    preferredName: safeText(member.name || member.id || "", 48),
    ageGroup: "",
    locale: "zh-CN",
    timezone: "Asia/Shanghai",
    interests: [],
    avoidTopics: [],
    accessibility: []
  };
}

function defaultPersona(member = {}) {
  const isGuest = member.role === "guest";
  return {
    assistantName: "小智",
    addressAs: safeText(member.name || "", 32),
    tone: member.role === "child"
      ? "温暖、耐心、鼓励"
      : isGuest ? "礼貌、克制、简洁" : "自然、可靠、简洁",
    verbosity: "brief",
    traits: member.role === "child"
      ? ["鼓励", "耐心", "清晰"]
      : isGuest ? ["礼貌", "克制"] : ["可靠", "自然", "尊重"],
    instructions: ""
  };
}

function defaultMemoryPolicy() {
  return {
    enabled: true,
    maxContextItems: 8,
    includeFamilyMemory: true,
    includeLearning: true,
    retentionDays: 365
  };
}

function normalizeProfile(value = {}, member = {}) {
  const source = value && typeof value === "object" ? value : {};
  const defaults = defaultProfile(member);
  return {
    preferredName: safeText(source.preferredName || source.nickname || defaults.preferredName, 48),
    ageGroup: safeText(source.ageGroup || source.age || "", 24),
    locale: safeText(source.locale || defaults.locale, 24),
    timezone: safeText(source.timezone || defaults.timezone, 48),
    interests: safeList(source.interests, 12, 48),
    avoidTopics: safeList(source.avoidTopics, 12, 64),
    accessibility: safeList(source.accessibility, 8, 64)
  };
}

function normalizePersona(value = {}, member = {}) {
  const source = value && typeof value === "object" ? value : {};
  const defaults = defaultPersona(member);
  const verbosity = safeText(source.verbosity || defaults.verbosity, 16);
  return {
    assistantName: safeText(source.assistantName || defaults.assistantName, 32),
    addressAs: safeText(source.addressAs || defaults.addressAs, 32),
    tone: safeText(source.tone || defaults.tone, 120),
    verbosity: ["brief", "balanced", "detailed"].includes(verbosity) ? verbosity : "brief",
    traits: safeList(source.traits?.length ? source.traits : defaults.traits, 8, 32),
    instructions: safeText(source.instructions || "", 400)
  };
}

function normalizeMemoryPolicy(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  const defaults = defaultMemoryPolicy();
  const maxContextItems = Number(source.maxContextItems ?? defaults.maxContextItems);
  const retentionDays = Number(source.retentionDays ?? defaults.retentionDays);
  return {
    enabled: source.enabled !== false,
    maxContextItems: Math.min(20, Math.max(1, Number.isFinite(maxContextItems) ? maxContextItems : defaults.maxContextItems)),
    includeFamilyMemory: source.includeFamilyMemory !== false,
    includeLearning: source.includeLearning !== false,
    retentionDays: Math.min(3650, Math.max(1, Number.isFinite(retentionDays) ? retentionDays : defaults.retentionDays))
  };
}

function normalizeMember(member = {}) {
  const role = safeText(member.role || "", 32);
  const relationshipFallback = role === "child" ? "孩子" : role === "guest" ? "访客" : "监护人";
  const base = {
    id: safeText(member.id || "device", 48),
    name: safeText(member.name || member.id || "设备用户", 48),
    role,
    relationship: RELATIONSHIPS.has(safeText(member.relationship || "", 16))
      ? safeText(member.relationship, 16)
      : relationshipFallback,
    profileVersion: Math.max(1, Number(member.profileVersion || 1) || 1),
    createdAt: safeText(member.createdAt || "", 48),
    updatedAt: safeText(member.updatedAt || "", 48),
    archivedAt: safeText(member.archivedAt || "", 48),
    status: safeText(member.status || "unknown", 48),
    avatar: safeText(member.avatar || "", 160),
    notes: safeText(member.notes || "", 240)
  };
  return {
    ...base,
    profile: normalizeProfile(member.profile, base),
    persona: normalizePersona(member.persona, base),
    memoryPolicy: normalizeMemoryPolicy(member.memoryPolicy)
  };
}

function normalizeFamilyMode(value) {
  return FAMILY_MODES.includes(String(value || "").trim()) ? String(value).trim() : "默认";
}

function roleForMode(mode) {
  return MODE_ROLES[normalizeFamilyMode(mode)];
}

function membersForMode(state, mode) {
  const role = roleForMode(mode);
  return (state.family?.members || [])
    .filter((member) => member.role === role && !member.archivedAt)
    .map(normalizeMember);
}

function activeMemberIdForMode(state, mode) {
  const normalizedMode = normalizeFamilyMode(mode);
  const members = membersForMode(state, normalizedMode);
  const configured = safeText(state.family?.activeMembers?.[normalizedMode] || "", 48);
  if (configured && members.some((member) => member.id === configured)) {
    return configured;
  }
  return members[0]?.id || "";
}

function resolveMember(state, memberId, mode, requestedRole = "") {
  const normalizedMode = normalizeFamilyMode(mode || state.familyMode);
  const requiredRole = roleForMode(normalizedMode);
  const id = safeText(memberId || "", 48);
  const requested = (state.family?.members || []).find((item) => item.id === id);
  if (!GENERIC_MEMBER_IDS.has(id) && requested?.role === requiredRole) {
    return normalizeMember(requested);
  }

  const activeId = activeMemberIdForMode(state, normalizedMode);
  const active = (state.family?.members || []).find((item) => item.id === activeId);
  if (active) {
    return normalizeMember(active);
  }

  const fallbackName = normalizedMode === "儿童" ? "孩子" : normalizedMode === "访客" ? "访客" : "家长";
  return normalizeMember({
    id: activeId || requiredRole,
    name: fallbackName,
    role: requiredRole || safeText(requestedRole, 32)
  });
}

function findMember(state, memberId) {
  const id = safeText(memberId || "device", 48);
  const member = (state.family?.members || []).find((item) => item.id === id);
  return member ? normalizeMember(member) : normalizeMember({ id, name: id === "device" ? "设备用户" : id });
}

function queryTerms(input = {}) {
  return [
    input.utterance,
    input.query,
    input.page,
    input.agent
  ].map((item) => safeText(item, 160)).filter(Boolean).join(" ");
}

function buildMemberContext(state, input = {}, agentId = "") {
  const requestedId = input.user?.id || input.memberId || "device";
  const familyMode = normalizeFamilyMode(input.familyMode || input.modeContext || state.familyMode);
  const requestedRole = safeText(input.user?.role || input.role || "", 32);
  const member = resolveMember(state, requestedId, familyMode, requestedRole);

  const policy = member.role === "guest"
    ? { ...member.memoryPolicy, enabled: false, includeFamilyMemory: false, includeLearning: false }
    : member.memoryPolicy;
  let memories = policy.enabled
    ? listMemory(state, {
      memberId: member.id,
      includeFamily: policy.includeFamilyMemory,
      query: queryTerms({ ...input, agent: agentId }),
      limit: policy.maxContextItems
    })
    : [];
  if (policy.enabled && memories.length === 0) {
    memories = listMemory(state, {
      memberId: member.id,
      includeFamily: policy.includeFamilyMemory,
      limit: policy.maxContextItems
    });
  }
  const retentionStart = Date.now() - policy.retentionDays * 24 * 60 * 60 * 1000;
  memories = memories.filter((item) => {
    const updatedAt = Date.parse(item.updatedAt || item.createdAt || "");
    return !Number.isFinite(updatedAt) || updatedAt >= retentionStart || Number(item.importance || 3) >= 5;
  });
  const learning = policy.enabled && policy.includeLearning
    ? listLearningRecords(state, { memberId: member.id }).slice(0, 5)
    : [];
  const recentInteractions = (state.memory?.recentContext || [])
    .filter((item) => item.memberId === member.id)
    .slice(0, 5);

  return {
    familyMode,
    member,
    responseGuidance: {
      assistantName: member.persona.assistantName,
      addressAs: member.persona.addressAs || member.profile.preferredName || member.name,
      tone: member.persona.tone,
      verbosity: member.persona.verbosity,
      traits: member.persona.traits,
      instructions: member.persona.instructions,
      locale: member.profile.locale,
      ageGroup: member.profile.ageGroup,
      avoidTopics: member.profile.avoidTopics,
      accessibility: member.profile.accessibility
    },
    memory: memories.map((item) => ({
      id: item.id,
      kind: item.kind || "fact",
      text: item.text,
      tags: item.tags || [],
      visibility: item.visibility,
      importance: item.importance || 3,
      updatedAt: item.updatedAt
    })),
    learning: learning.map((item) => ({
      type: item.type,
      title: item.title,
      score: item.score,
      progress: item.progress,
      at: item.at
    })),
    recentInteractions
  };
}

function personalizeSpeech(speech, memberContext) {
  const text = safeText(speech, 600);
  const addressAs = safeText(memberContext?.responseGuidance?.addressAs || "", 32);
  if (!text || !addressAs || ["家长", "孩子", "访客", "设备用户", "device"].includes(addressAs)) {
    return text;
  }
  if (text.startsWith(`${addressAs}，`) || text.startsWith(`${addressAs},`)) {
    return text;
  }
  return `${addressAs}，${text}`;
}

module.exports = {
  FAMILY_MODES,
  MODE_ROLES,
  activeMemberIdForMode,
  buildMemberContext,
  findMember,
  membersForMode,
  normalizeMember,
  normalizeFamilyMode,
  normalizeMemoryPolicy,
  normalizePersona,
  normalizeProfile,
  personalizeSpeech,
  resolveMember,
  roleForMode,
  safeList
};

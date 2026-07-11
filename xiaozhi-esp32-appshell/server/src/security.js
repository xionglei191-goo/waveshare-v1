const DEFAULT_POLICIES = {
  默认: {
    ai: true,
    music: true,
    weather: true,
    learning: true,
    apps: true,
    schedule: true,
    screensaver: true,
    notifications: true,
    openclaw: true,
    homeControl: true,
    family: true,
    voice: true,
    diagnostics: true,
    quiet: false
  },
  儿童: {
    ai: true,
    music: true,
    weather: true,
    learning: true,
    apps: false,
    schedule: true,
    screensaver: true,
    notifications: true,
    openclaw: false,
    homeControl: false,
    family: true,
    voice: true,
    diagnostics: false,
    quiet: false
  },
  访客: {
    ai: false,
    music: true,
    weather: true,
    learning: false,
    apps: false,
    schedule: false,
    screensaver: true,
    notifications: false,
    openclaw: false,
    homeControl: false,
    family: true,
    voice: false,
    diagnostics: false,
    quiet: false
  }
};

const ACTION_CATEGORY = [
  [/^ai\./, "ai"],
  [/^music\./, "music"],
  [/^english\./, "learning"],
  [/^content\./, "learning"],
  [/^memory\./, "family"],
  [/^schedule\./, "schedule"],
  [/^weather\./, "weather"],
  [/^screensaver\./, "screensaver"],
  [/^notification\./, "notifications"],
  [/^toast$/, "notifications"],
  [/^dialog\./, "notifications"],
  [/^app\./, "apps"],
  [/^openclaw\./, "openclaw"],
  [/^homeassistant\./, "homeControl"],
  [/^speaker\./, "homeControl"],
  [/^nas\./, "homeControl"],
  [/^family\./, "family"],
  [/^voice\./, "voice"],
  [/^device\./, "diagnostics"],
  [/^admin\./, "diagnostics"]
];

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function mergePolicy(policy, defaults) {
  return {
    ...defaults,
    ...(policy && typeof policy === "object" ? policy : {})
  };
}

function ensureSecurityState(state) {
  state.family = state.family || { members: [], policies: {} };
  state.family.policies = state.family.policies || {};
  delete state.family.policies["夜间"];
  if (state.familyMode === "夜间") {
    state.familyMode = "默认";
  }
  state.family.activeMembers = state.family.activeMembers || {};
  const modeRoles = { 默认: "parent", 儿童: "child", 访客: "guest" };
  for (const [mode, role] of Object.entries(modeRoles)) {
    const members = (state.family.members || []).filter((member) => member.role === role && !member.archivedAt);
    if (!members.some((member) => member.id === state.family.activeMembers[mode])) {
      state.family.activeMembers[mode] = members[0]?.id || "";
    }
  }
  for (const [mode, policy] of Object.entries(DEFAULT_POLICIES)) {
    state.family.policies[mode] = mergePolicy(state.family.policies[mode], policy);
  }
  state.security = state.security || {};
  state.security.policyVersion = state.security.policyVersion || 1;
  state.security.audit = Array.isArray(state.security.audit) ? state.security.audit : [];
  state.security.tokens = Array.isArray(state.security.tokens) ? state.security.tokens : [];
  state.security.deniedCount = Number(state.security.deniedCount || 0);
  state.security.lastDecisionAt = state.security.lastDecisionAt || null;
}

function actionCategory(action) {
  for (const [pattern, category] of ACTION_CATEGORY) {
    if (pattern.test(action)) {
      return category;
    }
  }
  return "apps";
}

function policyForMode(state, mode = state.familyMode) {
  ensureSecurityState(state);
  return state.family.policies[mode] || state.family.policies["默认"] || clone(DEFAULT_POLICIES["默认"]);
}

function evaluateAction(state, action, params = {}) {
  ensureSecurityState(state);
  const mode = params.modeContext || state.familyMode || "默认";
  const role = params.role || params.memberRole || "";
  const category = actionCategory(action);
  const policy = policyForMode(state, mode);

  if (role === "parent" || role === "admin") {
    return { allowed: true, mode, category, reason: "parent override" };
  }
  if (params.allowUnsafe === true) {
    return { allowed: false, mode, category, reason: "unsafe override rejected" };
  }
  const allowed = policy[category] !== false;
  return {
    allowed,
    mode,
    category,
    reason: allowed ? "allowed by mode policy" : `${mode} 模式禁止 ${category}`
  };
}

function auditAction(state, action, params, decision, status = "ok") {
  ensureSecurityState(state);
  state.security.lastDecisionAt = new Date().toISOString();
  if (!decision.allowed || status === "denied") {
    state.security.deniedCount += 1;
  }
  state.security.audit.unshift({
    id: `audit_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`,
    at: state.security.lastDecisionAt,
    action,
    category: decision.category,
    mode: decision.mode,
    memberId: params.memberId || params.member || "device",
    requestId: params.requestId || params.request_id || "",
    status: decision.allowed && status !== "denied" ? status : "denied",
    reason: decision.reason
  });
  state.security.audit = state.security.audit.slice(0, 100);
}

function policySummary(state) {
  ensureSecurityState(state);
  return {
    mode: state.familyMode || "默认",
    current: policyForMode(state),
    policies: state.family.policies,
    deniedCount: state.security.deniedCount,
    lastDecisionAt: state.security.lastDecisionAt,
    recentAudit: state.security.audit.slice(0, 10)
  };
}

module.exports = {
  DEFAULT_POLICIES,
  actionCategory,
  auditAction,
  ensureSecurityState,
  evaluateAction,
  policyForMode,
  policySummary
};

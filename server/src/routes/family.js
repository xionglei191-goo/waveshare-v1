const {
  archiveFamilyMember,
  auditAdminFamily,
  deleteFamilyMember,
  exportFamilyMember,
  familyModeForMemberRole,
  normalizePolicyPatch,
  safeMemberId,
  upsertFamilyMember
} = require("../family-service");
const {
  activeMemberIdForMode,
  buildMemberContext,
  membersForMode,
  normalizeMember,
  normalizeFamilyMode
} = require("../member-context");
const { DEFAULT_POLICIES, ensureSecurityState, policySummary } = require("../security");

function registerFamilyRoutes(router, context) {
  const { store, adminAuth, updateAndPublish } = context;

  router.get("/family/members", (req, res) => {
    const state = store.snapshot();
    const mode = normalizeFamilyMode(state.familyMode);
    res.json({ ok: true, data: {
      members: (state.family?.members || []).filter((member) => !member.archivedAt).map(normalizeMember),
      mode,
      activeMembers: state.family?.activeMembers || {},
      activeMemberId: activeMemberIdForMode(state, mode),
      modeMembers: membersForMode(state, mode)
    } });
  });

  router.get("/family/policies", (req, res) => {
    res.json({ ok: true, data: policySummary(store.snapshot()) });
  });

  router.get("/admin/family", adminAuth, (req, res) => {
    const state = store.snapshot();
    const mode = normalizeFamilyMode(state.familyMode);
    res.json({ ok: true, data: {
      members: (state.family?.members || []).map(normalizeMember),
      policies: policySummary(state),
      mode,
      activeMembers: state.family?.activeMembers || {},
      activeMemberId: activeMemberIdForMode(state, mode),
      modeMembers: membersForMode(state, mode)
    } });
  });

  router.patch("/admin/family/active-member", adminAuth, (req, res, next) => {
    try {
      const mode = normalizeFamilyMode(req.body?.mode || store.snapshot().familyMode);
      const memberId = safeMemberId(req.body?.memberId || req.body?.id);
      let activeMember = null;
      const snapshot = updateAndPublish("admin.family.active_member", (state) => {
        const role = mode === "儿童" ? "child" : mode === "访客" ? "guest" : "parent";
        if (mode === "访客" && memberId !== "guest") {
          const error = new Error("guest mode must use the fixed guest profile");
          error.statusCode = 400;
          throw error;
        }
        activeMember = state.family.members.find((member) => member.id === memberId && member.role === role && !member.archivedAt);
        if (!activeMember) {
          const error = new Error(`member does not belong to ${mode} mode`);
          error.statusCode = 400;
          throw error;
        }
        state.family.activeMembers[mode] = activeMember.id;
        state.familyMode = mode;
        auditAdminFamily(state, "admin.family.active_member", { mode, memberId }, req.requestId);
      });
      res.json({ ok: true, data: { mode, activeMember: normalizeMember(activeMember), activeMembers: snapshot.family.activeMembers } });
    } catch (error) { next(error); }
  });

  router.get("/admin/family/members/:id/context", adminAuth, (req, res, next) => {
    try {
      const state = store.snapshot();
      const member = state.family.members.find((item) => item.id === safeMemberId(req.params.id));
      if (!member) {
        const error = new Error("family member not found");
        error.statusCode = 404;
        throw error;
      }
      res.json({ ok: true, data: buildMemberContext(state, {
        user: { id: member.id, role: member.role },
        familyMode: familyModeForMemberRole(member.role),
        page: req.query.page || "ai",
        utterance: req.query.query || ""
      }, req.query.agent || "general") });
    } catch (error) { next(error); }
  });

  router.get("/admin/family/members/:id/export", adminAuth, (req, res, next) => {
    try { res.json({ ok: true, data: exportFamilyMember(store.snapshot(), req.params.id) }); }
    catch (error) { next(error); }
  });

  router.post("/admin/family/members/:id/archive", adminAuth, (req, res, next) => {
    try {
      let member;
      const snapshot = updateAndPublish("admin.family.member.archive", (state) => {
        member = archiveFamilyMember(state, req.params.id);
        auditAdminFamily(state, "admin.family.member.archive", { memberId: member.id }, req.requestId);
      });
      res.json({ ok: true, data: { member, activeMembers: snapshot.family.activeMembers } });
    } catch (error) { next(error); }
  });

  router.post("/admin/family/members", adminAuth, (req, res, next) => {
    try {
      let member;
      const snapshot = updateAndPublish("admin.family.member.create", (state) => {
        member = upsertFamilyMember(state, req.body || {});
        auditAdminFamily(state, "admin.family.member.create", { memberId: member.id, role: member.role }, req.requestId);
      });
      res.json({ ok: true, data: { member, family: { members: snapshot.family.members, policies: policySummary(snapshot) } } });
    } catch (error) { next(error); }
  });

  router.patch("/admin/family/members/:id", adminAuth, (req, res, next) => {
    try {
      let member;
      const snapshot = updateAndPublish("admin.family.member.update", (state) => {
        member = upsertFamilyMember(state, req.body || {}, req.params.id);
        auditAdminFamily(state, "admin.family.member.update", { memberId: member.id, role: member.role }, req.requestId);
      });
      res.json({ ok: true, data: { member, family: { members: snapshot.family.members, policies: policySummary(snapshot) } } });
    } catch (error) { next(error); }
  });

  router.delete("/admin/family/members/:id", adminAuth, (req, res, next) => {
    try {
      let deleted;
      const snapshot = updateAndPublish("admin.family.member.delete", (state) => {
        deleted = deleteFamilyMember(state, req.params.id, {
          confirmId: req.body?.confirmId || req.query.confirmId,
          memoryAction: req.body?.memoryAction || req.query.memoryAction,
          targetMemberId: req.body?.targetMemberId || req.query.targetMemberId
        });
        auditAdminFamily(state, "admin.family.member.delete", { memberId: deleted.id }, req.requestId);
      });
      res.json({ ok: true, data: { deleted, family: { members: snapshot.family.members, policies: policySummary(snapshot) } } });
    } catch (error) { next(error); }
  });

  router.patch("/admin/family/policies/:mode", adminAuth, (req, res, next) => {
    try {
      const mode = String(req.params.mode || "").slice(0, 24);
      const patch = normalizePolicyPatch(req.body || {});
      if (!mode || !Object.keys(patch).length) {
        res.status(400).json({ ok: false, error: "mode and at least one policy field are required" });
        return;
      }
      let policy;
      const snapshot = updateAndPublish("admin.family.policy.update", (state) => {
        ensureSecurityState(state);
        state.family.policies[mode] = { ...(state.family.policies[mode] || DEFAULT_POLICIES[mode] || DEFAULT_POLICIES["默认"]), ...patch };
        state.security.policyVersion = Number(state.security.policyVersion || 1) + 1;
        policy = state.family.policies[mode];
      });
      res.json({ ok: true, data: { mode, policy, policies: policySummary(snapshot) } });
    } catch (error) { next(error); }
  });
}

module.exports = { registerFamilyRoutes };

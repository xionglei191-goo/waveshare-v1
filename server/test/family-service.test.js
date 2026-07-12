const assert = require("node:assert/strict");
const test = require("node:test");

const { createInitialState } = require("../src/fixtures");
const { archiveFamilyMember, deleteFamilyMember, upsertFamilyMember } = require("../src/family-service");
const { buildMemberContext } = require("../src/member-context");

test("family roles and archived active members are constrained", () => {
  const state = createInitialState();
  assert.throws(() => upsertFamilyMember(state, { id: "bad", role: "owner" }), /role must be/);
  upsertFamilyMember(state, { id: "mom", name: "妈妈", role: "parent", relationship: "妈妈" });
  state.family.activeMembers["默认"] = "mom";
  archiveFamilyMember(state, "mom");
  assert.equal(state.family.activeMembers["默认"], "parent");
});

test("member deletion explicitly transfers private data", () => {
  const state = createInitialState();
  upsertFamilyMember(state, { id: "mom", name: "妈妈", role: "parent", relationship: "妈妈" });
  state.memory.items.push({ id: "mom-memory", memberId: "mom", text: "private" });
  const result = deleteFamilyMember(state, "mom", { confirmId: "mom", memoryAction: "transfer", targetMemberId: "parent" });
  assert.equal(result.affected.memory, 1);
  assert.equal(state.memory.items[0].memberId, "parent");
});

test("guest context never receives family memory", () => {
  const state = createInitialState();
  state.memory.items.push({ id: "family-secret", memberId: "family", visibility: "family", text: "secret" });
  const context = buildMemberContext(state, { familyMode: "访客", user: { id: "device" } }, "general");
  assert.equal(context.member.id, "guest");
  assert.equal(context.memory.length, 0);
  assert.equal(context.learning.length, 0);
});

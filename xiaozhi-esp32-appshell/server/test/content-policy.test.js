const assert = require("node:assert/strict");
const test = require("node:test");

const { validateContentImport } = require("../src/content-policy");

function encoded(value) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64");
}

test("validates real English and game bundle payloads", () => {
  const english = validateContentImport({
    item: { type: "english" },
    path: "courses/english/family-lesson.json",
    contentBase64: encoded({ title: "Family English", lessons: [{ prompt: "Hello" }] })
  });
  assert.equal(english.type, "english");
  const game = validateContentImport({
    item: { type: "game" },
    path: "games/family-quiz.json",
    contentBase64: encoded({ title: "Family Quiz", questions: [{ text: "1+1" }] })
  });
  assert.equal(game.type, "game");
});

test("rejects traversal, wrong extensions, and incomplete JSON", () => {
  assert.throws(() => validateContentImport({ item: { type: "game" }, path: "../game.json", contentBase64: encoded({ title: "x", type: "quiz" }) }), /safe relative path/);
  assert.throws(() => validateContentImport({ item: { type: "english" }, path: "courses/english/x.mp3", contentBase64: encoded({ title: "x", prompt: "x" }) }), /not allowed/);
  assert.throws(() => validateContentImport({ item: { type: "game" }, path: "games/x.json", contentBase64: encoded({ title: "x" }) }), /requires levels/);
});

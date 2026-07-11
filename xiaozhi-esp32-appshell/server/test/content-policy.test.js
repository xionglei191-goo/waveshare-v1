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
  assert.throws(() => validateContentImport({ item: { type: "english" }, path: "courses/english/x.mp3", contentBase64: encoded({ title: "x", prompt: "x" }) }), /invalid header/);
  assert.throws(() => validateContentImport({ item: { type: "game" }, path: "games/x.json", contentBase64: encoded({ title: "x" }) }), /requires levels/);
});

test("accepts compatible English and game audio and cover signatures", () => {
  const mp3 = validateContentImport({
    item: { type: "english", assetRole: "audio" },
    path: "courses/english/lesson-1.mp3",
    contentBase64: Buffer.from([0x49, 0x44, 0x33, 0x04, 0x00]).toString("base64")
  });
  const ogg = validateContentImport({
    item: { type: "game", assetRole: "media" },
    path: "games/level-1.ogg",
    contentBase64: Buffer.from("OggSgame-audio", "ascii").toString("base64")
  });
  const png = validateContentImport({
    item: { type: "english", assetRole: "cover" },
    path: "courses/english/cover.png",
    contentBase64: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]).toString("base64")
  });
  assert.equal(mp3.relativePath, "courses/english/lesson-1.mp3");
  assert.equal(ogg.relativePath, "games/level-1.ogg");
  assert.equal(png.relativePath, "courses/english/cover.png");
});

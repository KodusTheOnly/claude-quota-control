// The verdict's faces: every level and Warming up has frames, all plain ASCII (so the font never changes),
// and the frames of a face are all as wide as each other (so the line does not jump while it plays).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..");

function loadFaces() {
  const stub = () => ({ parentElement: {}, addEventListener() {}, classList: { remove() {}, add() {} }, dataset: {} });
  const sandbox = {
    document: { getElementById: stub, addEventListener() {}, hidden: false },
    window: { quota: {} },
    ResizeObserver: class { observe() {} },
    I18N: { t: (k) => k, getLang: () => "en", locale: () => "en-US" },
  };
  vm.createContext(sandbox);
  for (const f of ["core.js", "compute.js", "ui.js", "blocks/verdict.js"]) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, "renderer", "js", f), "utf8"), sandbox);
  }
  return vm.runInContext("({ levels: VERDICT_FACES, early: EARLY_FACE, keys: LEVEL_KEYS })", sandbox);
}

const faces = loadFaces();
const all = [...faces.levels.map((frames, i) => [faces.keys[i], frames]), ["early", faces.early]];

test("every level and Warming up has a face with at least two frames", () => {
  assert.equal(faces.levels.length, faces.keys.length);
  for (const [key, frames] of all) {
    assert.ok(Array.isArray(frames), key);
    assert.ok(frames.length >= 2, `${key} has ${frames.length} frames`);
    for (const f of frames) assert.ok(typeof f === "string" && f.trim().length > 0, `${key}: empty frame`);
  }
});

test("the frames are plain printable ASCII", () => {
  for (const [key, frames] of all) {
    for (const f of frames) assert.ok(/^[\x20-\x7E]+$/.test(f), `${key}: "${f}"`);
  }
});

test("the frames of each face are all as wide as each other", () => {
  for (const [key, frames] of all) {
    const widths = new Set(frames.map((f) => f.length));
    assert.equal(widths.size, 1, `${key}: ${frames.map((f) => `"${f}"`).join(", ")}`);
  }
});

test("the CSS times a loop for every face", () => {
  const css = fs.readFileSync(path.join(ROOT, "renderer", "css", "overview.css"), "utf8");
  for (const [key] of all) assert.ok(css.includes(`[data-face="${key}"]`), key);
  assert.ok(/prefers-reduced-motion: reduce\)\s*\{\s*\.band \.face > span \{ animation: none/.test(css), "no motion when reduced");
});

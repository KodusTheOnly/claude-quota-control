// Level notifications: only when the week's level goes up to Tight or Pause, at most once per level per local day.
// The renderer builds the key (level and day); the main process shows a key only once. This test plays both parts.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..");

function load() {
  const stub = () => ({ parentElement: {}, addEventListener() {}, classList: { remove() {}, add() {} }, dataset: {} });
  const sandbox = {
    document: { getElementById: stub, addEventListener() {}, hidden: false },
    window: { quota: {} },
    ResizeObserver: class { observe() {} },
    I18N: { t: (k, p) => (p ? `${k} ${JSON.stringify(p)}` : k), getLang: () => "en", locale: () => "en-US" },
  };
  vm.createContext(sandbox);
  for (const f of ["core.js", "compute.js", "ui.js", "blocks/verdict.js", "alerts.js"]) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, "renderer", "js", f), "utf8"), sandbox);
  }
  return sandbox;
}

// The few fields levelAlert reads, for a week with a projection
const numbers = (level) => ({ forecast: { kind: "fits" }, w: { used: 50 }, head: { level, guide: "guide", reason: "reason" } });

// Plays a run of fresh readings: each one is [level, ms]. Returns the notes the main process would show.
function play(readings, startLevel = 1) {
  const sb = load();
  const shown = [];
  const notified = new Set(); // the main process: a key is shown once
  let last = startLevel;
  for (const [level, now] of readings) {
    const { level: kept, note } = vm.runInContext("levelAlert", sb)(numbers(level), last, now);
    last = kept;
    if (note && !notified.has(note.key)) {
      notified.add(note.key);
      shown.push({ level, title: note.title });
    }
  }
  return shown;
}

const at = (d, h) => new Date(2026, 10, d, h).getTime();

test("going up from Moderate to Tight notifies", () => {
  const shown = play([[2, at(7, 9)]]);
  assert.equal(shown.length, 1);
  assert.equal(shown[0].title, 'alert.level {"level":"level.tight.name"}');
});

test("staying at Tight does not notify again", () => {
  assert.equal(play([[2, at(7, 9)], [2, at(7, 10)], [2, at(7, 15)]]).length, 1);
});

test("going down and up again the same day does not notify again", () => {
  assert.equal(play([[2, at(7, 9)], [1, at(7, 11)], [2, at(7, 13)], [0, at(7, 14)], [2, at(7, 16)]]).length, 1);
});

test("Pause the same day notifies once", () => {
  const shown = play([[2, at(7, 9)], [3, at(7, 11)], [3, at(7, 12)], [2, at(7, 13)], [3, at(7, 18)]]);
  assert.deepEqual(shown.map((x) => x.level), [2, 3]);
});

test("the next day the same rise notifies again", () => {
  assert.equal(play([[2, at(7, 9)], [1, at(7, 20)], [2, at(8, 9)]]).length, 2);
});

test("Free and Moderate never notify, and neither does going down", () => {
  assert.equal(play([[0, at(7, 9)], [1, at(7, 10)], [0, at(7, 11)], [1, at(7, 12)]], 0).length, 0);
  assert.equal(play([[2, at(7, 9)]], 3).length, 0, "Pause to Tight is a drop");
});

test("while warming up the level is not rated, so nothing notifies", () => {
  const sb = load();
  const m = { ...numbers(2), forecast: { kind: "early" }, w: { used: 30 } };
  const res = vm.runInContext("levelAlert", sb)(m, 0, at(7, 9));
  assert.equal(res.level, null);
  assert.equal(res.note, null);
});

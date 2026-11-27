const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// core.js is a plain browser script: load it in a sandbox
function load() {
  const sandbox = {
    document: { getElementById: () => ({}) },
    window: { quota: {} },
    I18N: { t: (k) => k, getLang: () => "en", locale: () => "en-US" },
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "renderer", "js", "core.js"), "utf8"), sandbox);
  return sandbox;
}
const { sessionLocks, extraCoversLimit } = load();
const plain = (v) => JSON.parse(JSON.stringify(v));

const MIN = 60000;
const at = (h, m = 0) => new Date(2026, 10, 26, h, m).getTime();
const SR = at(18, 50); // the window runs 13:50 to 18:50
const FROM = at(0);
const TO = at(23, 59);

test("the first reading at 100% is the limit, exact when the one before it is close", () => {
  const readings = [
    { at: at(14, 0), w: 30, s: 20, sr: SR },
    { at: at(15, 7), w: 40, s: 97, sr: SR },
    { at: at(15, 8), w: 41, s: 100, sr: SR },
    { at: at(15, 25), w: 41, s: 100, sr: SR },
  ];
  assert.deepEqual(plain(sessionLocks(readings, FROM, TO)), [{ at: at(15, 8), from: at(15, 7), until: SR, exact: true }]);
});

test("a long gap before the first 100% makes it a range, not an exact time", () => {
  const readings = [
    { at: at(14, 10), w: 30, s: 40, sr: SR },
    { at: at(15, 25), w: 41, s: 100, sr: SR },
  ];
  const [l] = sessionLocks(readings, FROM, TO);
  assert.equal(l.from, at(14, 10));
  assert.equal(l.at, at(15, 25));
  assert.equal(l.exact, false);
});

test("a reading that was repeated counts until its last time", () => {
  // 14:00 seen again at 15:00 (to), then 100% at 15:10: exact
  const readings = [
    { at: at(14, 0), to: at(15, 0), w: 30, s: 80, sr: SR },
    { at: at(15, 10), w: 35, s: 100, sr: SR },
  ];
  const [l] = sessionLocks(readings, FROM, TO);
  assert.equal(l.from, at(15, 0));
  assert.equal(l.exact, true);
});

test("with no reading under the limit in the window, it was hit after the window started", () => {
  const readings = [{ at: at(16, 0), w: 41, s: 100, sr: SR }];
  const [l] = sessionLocks(readings, FROM, TO);
  assert.equal(l.from, at(13, 50));
  assert.equal(l.exact, false);
});

test("99.6% shows as 100%, so it is the limit; 99.4% is not", () => {
  assert.equal(sessionLocks([{ at: at(15, 0), w: 40, s: 99.6, sr: SR }], FROM, TO).length, 1);
  assert.equal(sessionLocks([{ at: at(15, 0), w: 40, s: 99.4, sr: SR }], FROM, TO).length, 0);
});

test("one entry per window, oldest first; resets a few minutes apart are the same window", () => {
  const sr1 = at(9, 0);
  const readings = [
    { at: at(15, 8), w: 41, s: 100, sr: SR + 3 * MIN },
    { at: at(8, 0), w: 10, s: 100, sr: sr1 },
    { at: at(15, 30), w: 41, s: 100, sr: SR },
  ];
  const out = sessionLocks(readings, FROM, TO);
  assert.equal(out.length, 2);
  assert.equal(out[0].until, sr1);
  assert.equal(out[1].at, at(15, 8));
});

test("only the locks that touch from..to, and readings with no session are ignored", () => {
  const readings = [
    { at: at(8, 0), w: 10, s: 100, sr: at(9, 0) },
    { at: at(12, 0), w: 20, s: null, sr: null },
  ];
  assert.equal(sessionLocks(readings, at(10, 0), TO).length, 0);
  assert.equal(sessionLocks(readings, at(8, 30), TO).length, 1);
});

test("extra usage covers the limit only with credits or room under its monthly limit", () => {
  assert.equal(extraCoversLimit(null), false);
  assert.equal(extraCoversLimit({ balance: 5, limit: null, spent: null }), true);
  assert.equal(extraCoversLimit({ balance: 0, limit: 50, spent: 20 }), true);
  assert.equal(extraCoversLimit({ balance: 0, limit: 50, spent: 50 }), false);
  assert.equal(extraCoversLimit({ balance: null, limit: 0, spent: 0 }), false);
});

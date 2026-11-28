const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { spawnSync } = require("node:child_process");

// core.js is a plain browser script: load it with a fake settings store
// slow: the store answers after a moment with a copy, the way the IPC round trip does
function load(settings = {}, { slow = false } = {}) {
  const store = settings;
  const setSettings = slow
    ? async (patch) => { await new Promise((r) => setTimeout(r, 5)); Object.assign(store, patch); return { ...store }; }
    : async (patch) => Object.assign(store, patch);
  const sandbox = {
    document: { getElementById: () => ({}) },
    window: { quota: { setSettings } },
    I18N: { t: (k) => k, getLang: () => "en", locale: () => "en-US" },
    store,
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "renderer", "js", "core.js"), "utf8"), sandbox);
  vm.runInContext("state.settings = store;", sandbox);
  return { log: vm.runInContext("logReading", sandbox), store };
}
const MIN = 60000;
const T = 1_800_000_000_000;

test("a repeated reading only moves the to time of the last one", async () => {
  const { log, store } = load({ readings: [], sessions: [] });
  const one = { weekly: 10, session: 5, sessionResetsAt: T + 3600000 };
  await log({ at: T, ...one });
  await log({ at: T + 5 * MIN, ...one });
  await log({ at: T + 10 * MIN, ...one });
  assert.equal(store.readings.length, 1);
  assert.equal(store.readings[0].to, T + 10 * MIN);
  await log({ at: T + 15 * MIN, ...one, weekly: 11 });
  assert.equal(store.readings.length, 2);
});

test("two readings logged at the same time are both kept", async () => {
  const { log, store } = load({ readings: [], sessions: [] }, { slow: true });
  await Promise.all([
    log({ at: T, weekly: 10, session: 5, sessionResetsAt: null }),
    log({ at: T + MIN, weekly: 11, session: 6, sessionResetsAt: null }),
  ]);
  assert.equal(store.readings.map((r) => r.w).join(), "10,11"); // the arrays come from the script's own realm
});

test("the collector keeps a short log of readings and extends it when nothing changed", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "cqc-home-"));
  const FIVE = Math.floor(Date.now() / 1000) + 3600;
  const WEEK = Math.floor(Date.now() / 1000) + 3 * 24 * 3600;
  try {
    const script = path.join(__dirname, "..", "collector", "statusline.js");
    const send = (used) => {
      const input = { rate_limits: { five_hour: { used_percentage: used, resets_at: FIVE }, seven_day: { used_percentage: 40, resets_at: WEEK } } };
      const run = spawnSync(process.execPath, [script], { input: JSON.stringify(input), env: { ...process.env, HOME: home, USERPROFILE: home } });
      assert.equal(run.status, 0, String(run.stderr));
      return JSON.parse(fs.readFileSync(path.join(home, ".claude", "claude-quota-control.json"), "utf8"));
    };
    send(10);
    send(10);
    const saved = send(12);
    assert.equal(saved.recent.length, 2);
    assert.ok(saved.recent[0].to >= saved.recent[0].at);
    assert.equal(saved.recent[1].s, 12);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("a reading older than the last one saved is left out", async () => {
  // The collector's file is read again at start, after newer readings came from the account
  const { log, store } = load({ readings: [], sessions: [] });
  await log({ at: T, weekly: 10, session: null, sessionResetsAt: null });
  await log({ at: T + 30 * MIN, weekly: 12, session: null, sessionResetsAt: null });
  await log({ at: T + 10 * MIN, weekly: 11, session: null, sessionResetsAt: null });
  assert.deepEqual(JSON.parse(JSON.stringify(store.readings.map((r) => r.at))), [T, T + 30 * MIN]);
});

test("lastStep: what the last reading added, as the shown whole numbers", () => {
  const { sandbox } = loadStep();
  const step = (list, ws = 0) => JSON.parse(JSON.stringify(vm.runInContext(`lastStep(${JSON.stringify(list)}, ${ws})`, sandbox)));
  const sr = T + 3 * 3600000;
  // both rose: week 31 -> 32, session 42 -> 45, since the end of the reading before
  assert.deepEqual(step([{ at: T, to: T + 5 * MIN, w: 31.2, s: 42, sr }, { at: T + 20 * MIN, w: 31.6, s: 45, sr }]), {
    week: { a: 31.2, b: 31.6, d: 1, since: T + 5 * MIN },
    session: { a: 42, b: 45, d: 3, since: T + 5 * MIN },
  });
  // a rise that does not change the shown number
  assert.equal(step([{ at: T, w: 31.1, s: 42, sr }, { at: T + MIN, w: 31.4, s: 42.2, sr }]).week, null);
  // a later reading saw no change: nothing to mark
  assert.deepEqual(step([{ at: T, w: 31, s: 42, sr }, { at: T + MIN, to: T + 2 * MIN, w: 33, s: 44, sr }]), { week: null, session: null });
  // another 5-hour window, and a reading from before the week's start
  const other = step([{ at: T, w: 31, s: 90, sr }, { at: T + MIN, w: 33, s: 4, sr: sr + 5 * 3600000 }], T + 1);
  assert.deepEqual(other, { week: null, session: null });
  // a single reading
  assert.deepEqual(step([{ at: T, w: 31, s: 42, sr }]), { week: null, session: null });
});

function loadStep() {
  const sandbox = {
    document: { getElementById: () => ({}) },
    window: { quota: {} },
    I18N: { t: (k) => k, getLang: () => "en", locale: () => "en-US" },
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "renderer", "js", "core.js"), "utf8"), sandbox);
  return { sandbox };
}

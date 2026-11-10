const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { spawnSync } = require("node:child_process");

// Active hours: a day keeps its weight, spread only over the window (Settings > Plan).
// core.js and compute.js are plain browser scripts that share one scope, so load both in a sandbox.
function load(nowMs, settings = {}) {
  const RealDate = Date;
  class FakeDate extends RealDate {
    constructor(...a) { super(...(a.length ? a : [nowMs])); }
    static now() { return nowMs; }
  }
  const sandbox = {
    Date: FakeDate,
    document: { getElementById: () => ({}) },
    window: { quota: {} },
    I18N: { t: (k) => k, getLang: () => "en", locale: () => "en-US" },
  };
  vm.createContext(sandbox);
  for (const f of ["core.js", "compute.js"]) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "renderer", "js", f), "utf8"), sandbox);
  }
  vm.runInContext(`state.settings = ${JSON.stringify(settings)};`, sandbox);
  return sandbox;
}
const at = (y, m, d, h = 0, min = 0) => new Date(y, m - 1, d, h, min).getTime();
const plain = (v) => JSON.parse(JSON.stringify(v));
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg || ""} ${a} vs ${b}`);
const EVEN = [1, 1, 1, 1, 1, 1, 1];
const NIGHT_OWL = { activeHours: { start: 9, end: 1 } }; // 16 h a day, crossing midnight
const OFFICE = { activeHours: { start: 9, end: 18 } }; // 9 h a day, inside the day
const ev = (sb, expr) => plain(vm.runInContext(expr, sb));

test("active hours: only whole hours with some length count, anything else is the whole day", () => {
  const sb = load(at(2026, 11, 4, 12));
  for (const bad of [null, {}, { start: 9, end: 9 }, { start: -1, end: 5 }, { start: 9, end: 24 }, { start: 9.5, end: 18 }, { start: "9", end: 18 }]) {
    assert.equal(ev(sb, `activeHours({ activeHours: ${JSON.stringify(bad)} })`), null, JSON.stringify(bad));
  }
  assert.deepEqual(ev(sb, "activeHours({ activeHours: { start: 9, end: 1 } })"), { start: 9, end: 1 });
});

test("a whole day weighs its weight with or without a window", () => {
  for (const settings of [{}, NIGHT_OWL, OFFICE]) {
    const sb = load(at(2026, 11, 4, 12), settings);
    near(ev(sb, `weightedDays(${at(2026, 11, 4)}, ${at(2026, 11, 5)}, [1, 1, 1, 1, 1, 1, 1])`), 1);
    near(ev(sb, `weightedDays(${at(2026, 10, 28)}, ${at(2026, 11, 4)}, [0, 2, 0.5, 1, 1, 1, 0])`), 1 + 1 + 1 + 0 + 0 + 2 + 0.5);
  }
});

test("the time outside the window counts as nothing, and the hours after midnight count for that calendar day", () => {
  const sb = load(at(2026, 11, 4, 12), NIGHT_OWL);
  const wd = (a, b) => ev(sb, `weightedDays(${a}, ${b}, ${JSON.stringify(EVEN)})`);
  near(wd(at(2026, 11, 4, 2), at(2026, 11, 4, 9)), 0, "02:00 to 09:00");
  near(wd(at(2026, 11, 4, 0), at(2026, 11, 4, 1)), 1 / 16, "00:00 to 01:00");
  near(wd(at(2026, 11, 4, 9), at(2026, 11, 4, 17)), 8 / 16, "09:00 to 17:00");
  const office = load(at(2026, 11, 4, 12), OFFICE);
  near(ev(office, `weightedDays(${at(2026, 11, 4, 12)}, ${at(2026, 11, 4, 15)}, ${JSON.stringify(EVEN)})`), 3 / 9);
});

test("the expected line stays flat outside the window and moves inside it", () => {
  const reset = at(2026, 11, 10, 8); // Tue 08:00, as on the reported chart
  const sb = load(at(2026, 11, 5, 12), NIGHT_OWL);
  const exp = (ms) => ev(sb, `expectedUsed(${reset}, ${ms}, ${JSON.stringify(EVEN)})`);
  near(exp(at(2026, 11, 5, 2)), exp(at(2026, 11, 5, 9)), "night");
  assert.ok(exp(at(2026, 11, 5, 15)) > exp(at(2026, 11, 5, 9)));
  near(exp(reset), 100);
  // The reset day: the week starts at 08:00, before the window opens, so Tuesday keeps 15 of its 16 hours
  near(exp(at(2026, 11, 4)), (100 * (15 / 16)) / 7, "Tuesday's share");
  const whole = load(at(2026, 11, 5, 12));
  near(ev(whole, `expectedUsed(${reset}, ${at(2026, 11, 4)}, ${JSON.stringify(EVEN)})`), (100 * (16 / 24)) / 7, "without a window");
});

test("a whole day keeps its weight; only the partial days at the edges of the week weigh differently", () => {
  const reset = at(2026, 11, 10, 8);
  const budget = (settings, now) => ev(load(now, settings), `dayBudget(60, ${reset}, ${now}, ${JSON.stringify(EVEN)})`);
  const share = (settings, ms) => ev(load(ms, settings), `dayShare(${ms}, ${reset}, ${JSON.stringify(EVEN)})`);
  const thu = at(2026, 11, 5, 0);
  near(share(NIGHT_OWL, thu), share({}, thu), "a midweek day");
  // Thursday splits what is left with Fri..Mon and the last Tuesday's night hours (8/24 of a day, or 1/16 with the window)
  near(budget({}, thu), 60 / (5 + 8 / 24));
  near(budget(NIGHT_OWL, thu), 60 / (5 + 1 / 16));
  // The last Monday: the week ends Tue 08:00, so without a window Tuesday's 8 night hours share the rest
  const mon = at(2026, 11, 9, 0);
  near(budget({}, mon), (60 * 1) / (1 + 8 / 24));
  near(budget(NIGHT_OWL, mon), (60 * 1) / (1 + 1 / 16));
});

test("the pace reaches its target inside the window, never in the night", () => {
  const reset = at(2026, 11, 10, 8);
  const now = at(2026, 11, 6, 23);
  const sb = load(now, NIGHT_OWL);
  const rate = 20; // % per weighted day
  const T = ev(sb, `paceReaches(95, 70, ${rate}, ${now}, ${reset}, ${JSON.stringify(EVEN)})`);
  const h = new Date(T).getHours();
  assert.ok(h >= 9 || h < 1, `lands at ${new Date(T)}`);
  near(ev(sb, `weightedDays(${now}, ${T}, ${JSON.stringify(EVEN)})`) * rate, 25, "it uses exactly the weighted time it needs");
});

test("the chart bends at the window's edges and the projection stays flat in the night", () => {
  const reset = at(2026, 11, 10, 8);
  const now = at(2026, 11, 7, 3); // Saturday, 03:00, outside the window
  const sb = load(now, { ...NIGHT_OWL, manual: {} });
  sb.__src = {
    kind: "manual",
    data: { updatedAt: now, weekly: { used: 50, resetsAt: reset }, fiveHour: null, dayStart: { day: "2026-11-07", at: at(2026, 11, 7), used: 50 }, days: {} },
  };
  vm.runInContext("var __m = compute(__src); var __s = paceSeries(__m);", sb);
  const s = ev(sb, "__s");
  // Every point of the expected line rises or stays; a flat piece covers 01:00 to 09:00
  for (let i = 1; i < s.expected.length; i++) assert.ok(s.expected[i].y >= s.expected[i - 1].y - 1e-9);
  vm.runInContext(`var toXOf = (ms) => Math.round((startOfDay(ms) - startOfDay(${reset - 7 * 86400000})) / 86400000) + (ms - startOfDay(ms)) / 86400000;`, sb);
  const x = (ms) => ev(sb, `toXOf(${ms})`);
  const yAt = (px) => s.expected.find((p) => Math.abs(p.x - px) < 1e-9);
  const p1 = yAt(x(at(2026, 11, 6, 1)));
  const p9 = yAt(x(at(2026, 11, 6, 9)));
  assert.ok(p1 && p9, "points at 01:00 and 09:00");
  near(p1.y, p9.y, "flat through the night");
  // The projection starts flat (it is 03:00) and ends at the reset
  assert.equal(s.proj[0].y, 50);
  assert.equal(s.proj[1].y, 50);
  near(s.proj[1].x, x(at(2026, 11, 7, 9)), "flat until 09:00");
  near(s.proj[s.proj.length - 1].x, s.span, "ends at the reset");
  // The night is shaded: 01:00 to 09:00 on Friday is one of the resting pieces
  assert.ok(s.rest.some((r) => Math.abs(r.x0 - x(at(2026, 11, 6, 1))) < 1e-9 && Math.abs(r.x1 - x(at(2026, 11, 6, 9))) < 1e-9));
  // The reset day's 08:00 to 09:00 rests too, and nothing rests before the week starts
  assert.ok(s.rest.every((r) => r.x0 >= s.s0 - 1e-9 && r.x1 <= s.span + 1e-9));
  assert.ok(s.rest.some((r) => Math.abs(r.x0 - s.s0) < 1e-9 && Math.abs(r.x1 - x(at(2026, 11, 3, 9))) < 1e-9));
});

test("without a window the chart and the numbers are the same as before", () => {
  const reset = at(2026, 11, 10, 8);
  const now = at(2026, 11, 7, 15);
  const sb = load(now, {});
  near(ev(sb, `weightedDays(${at(2026, 11, 7, 3)}, ${at(2026, 11, 7, 9)}, ${JSON.stringify(EVEN)})`), 6 / 24);
  near(ev(sb, `paceReaches(80, 70, 10, ${now}, ${reset}, ${JSON.stringify(EVEN)})`), now + 86400000);
  sb.__src = { kind: "manual", data: { updatedAt: now, weekly: { used: 50, resetsAt: reset }, fiveHour: null, dayStart: { day: "2026-11-07", at: at(2026, 11, 7), used: 45 }, days: {} } };
  vm.runInContext("state.settings.manual = __src.data; var __s = paceSeries(compute(__src));", sb);
  const s = ev(sb, "__s");
  assert.deepEqual(s.rest, [], "nothing shaded");
  assert.deepEqual(s.expected.map((p) => Math.round(p.x * 1000) / 1000), [8 / 24, 1, 2, 3, 4, 5, 6, 7, 7 + 8 / 24].map((v) => Math.round(v * 1000) / 1000), "a point at each midnight");
});

test("the collector and the app compute the same day budget with active hours", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "cqc-active-"));
  try {
    fs.mkdirSync(path.join(home, ".claude"), { recursive: true });
    fs.writeFileSync(path.join(home, ".claude", "claude-quota-control-config.json"), JSON.stringify({ weights: EVEN, activeHours: NIGHT_OWL.activeHours }));
    // A reset close enough that the night before it falls in the week, so the window changes the budget
    const resetsAt = Date.now() + 30 * 3600000;
    const input = { rate_limits: { seven_day: { used_percentage: 40, resets_at: resetsAt } } };
    const script = path.join(__dirname, "..", "collector", "statusline.js");
    const run = spawnSync(process.execPath, [script], { input: JSON.stringify(input), env: { ...process.env, HOME: home, USERPROFILE: home } });
    assert.equal(run.status, 0, String(run.stderr));
    const saved = JSON.parse(fs.readFileSync(path.join(home, ".claude", "claude-quota-control.json"), "utf8"));
    const today = Object.values(saved.days)[0];
    const sb = load(saved.dayStart.at, NIGHT_OWL);
    const expected = ev(sb, `dayBudget(${100 - saved.dayStart.used}, ${resetsAt}, ${saved.dayStart.at}, ${JSON.stringify(EVEN)})`);
    assert.ok(Math.abs(today.budget - Math.round(expected * 100) / 100) < 0.011, `${today.budget} vs ${expected}`);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

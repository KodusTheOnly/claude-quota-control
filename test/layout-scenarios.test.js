// The layout test has one scenario per level. This checks, without a browser, that each one still reads its
// level under the rules in core.js, so a change in the rules cannot quietly leave a level untested.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { NOW, LEVEL_OF, settingsFor } = require("./layout/scenarios");

function levelOf(name) {
  const RealDate = Date;
  class FakeDate extends RealDate {
    constructor(...a) { super(...(a.length ? a : [NOW])); }
    static now() { return NOW; }
  }
  const sandbox = {
    Date: FakeDate,
    document: { getElementById: () => ({}) },
    window: { quota: {} },
    I18N: { t: (k) => k, getLang: () => "en", locale: () => "en-US" },
  };
  vm.createContext(sandbox);
  for (const f of ["core.js", "compute.js"]) vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "renderer", "js", f), "utf8"), sandbox);
  vm.runInContext(`state.settings = ${JSON.stringify(settingsFor(name))};`, sandbox);
  return vm.runInContext("(() => { const m = compute(pickSource()); return { head: m.head.level, room: Boolean(m.head.room), endRoom: m.endRoom, week: m.lv.week, hours: m.lv.lock && m.lv.lock.hours }; })()", sandbox);
}

const KEYS = ["free", "moderate", "tight", "pause"];

// LEVEL_OF names the mark the ruler lights. "room" is not a level: it is Free with quota to spare (m.head.room),
// so that scenario must read Free with the room flag on.
test("each level scenario of the layout test reads its level", () => {
  assert.deepEqual(Object.keys(LEVEL_OF).sort(), [...KEYS].sort(), "one scenario per level");
  for (const [name, mark] of Object.entries(LEVEL_OF)) {
    const r = levelOf(name);
    const key = mark === "room" ? "free" : mark;
    assert.equal(KEYS[r.head], key, `${name}: verdict (${r.hours} h locked out)`);
    assert.equal(r.room, mark === "room", `${name}: room to spend`);
    assert.equal(KEYS[r.week], key, `${name}: week`);
  }
});

// Not a level scenario: the last day with room, where the week takes the accent
test("the last-day scenario of the layout test has room to spend on its last day", () => {
  const r = levelOf("lastday");
  assert.equal(KEYS[r.head], "free");
  assert.equal(r.room, true);
  assert.equal(r.endRoom, true);
});

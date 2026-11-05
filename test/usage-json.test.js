const test = require("node:test");
const assert = require("node:assert/strict");
const { parseUsageJson, describeShape } = require("../usage-json");

// Same shape as the real response, with made-up numbers
const GOOD = () => ({
  five_hour: { utilization: 13, resets_at: "2026-01-05T12:00:00+00:00", limit_dollars: null },
  seven_day: { utilization: 3, resets_at: "2026-01-12T12:00:00+00:00", limit_dollars: null },
  seven_day_opus: null,
  something_new: null,
});

test("reads session and week from the usage data", () => {
  const r = parseUsageJson(GOOD());
  assert.equal(r.ok, true);
  assert.equal(r.weekly.used, 3);
  assert.equal(r.weekly.resetsAt, Date.parse("2026-01-12T12:00:00Z"));
  assert.equal(r.session.used, 13);
  assert.equal(typeof r.session.resetsAt, "number");
});

test("accepts a week at 0 and at 100", () => {
  for (const used of [0, 100]) {
    const d = GOOD();
    d.seven_day.utilization = used;
    assert.equal(parseUsageJson(d).weekly.used, used);
  }
});

test("a session that has not started is normal", () => {
  const a = GOOD();
  a.five_hour = null;
  assert.deepEqual(parseUsageJson(a).session, null);
  const b = GOOD();
  b.five_hour.resets_at = null;
  assert.equal(parseUsageJson(b).session.resetsAt, null);
});

test("ignores fields it does not know", () => {
  const d = GOOD();
  d.brand_new_field = { anything: [1, 2, 3] };
  assert.equal(parseUsageJson(d).ok, true);
});

// Every one of these must be an error, never a guess
const BROKEN = {
  "not an object": () => "oops",
  "an array": () => [],
  "null": () => null,
  "seven_day missing": () => { const d = GOOD(); delete d.seven_day; return d; },
  "seven_day is null": () => { const d = GOOD(); d.seven_day = null; return d; },
  "week used is a string": () => { const d = GOOD(); d.seven_day.utilization = "3"; return d; },
  "week used is a fraction scale above 100": () => { const d = GOOD(); d.seven_day.utilization = 250; return d; },
  "week used is negative": () => { const d = GOOD(); d.seven_day.utilization = -1; return d; },
  "week used is NaN": () => { const d = GOOD(); d.seven_day.utilization = NaN; return d; },
  "week reset missing": () => { const d = GOOD(); delete d.seven_day.resets_at; return d; },
  "week reset not a date": () => { const d = GOOD(); d.seven_day.resets_at = "soon"; return d; },
  "week reset is a number": () => { const d = GOOD(); d.seven_day.resets_at = 1762761600; return d; },
  "week field renamed": () => { const d = GOOD(); d.weekly = d.seven_day; delete d.seven_day; return d; },
  "five_hour key gone": () => { const d = GOOD(); delete d.five_hour; return d; },
  "session used is a string": () => { const d = GOOD(); d.five_hour.utilization = "13"; return d; },
  "session reset not a date": () => { const d = GOOD(); d.five_hour.resets_at = "later"; return d; },
  "session is a number": () => { const d = GOOD(); d.five_hour = 13; return d; },
};
for (const [name, make] of Object.entries(BROKEN)) {
  test(`format error: ${name}`, () => {
    const r = parseUsageJson(make());
    assert.equal(r.ok, false);
    assert.equal(typeof r.problem, "string");
  });
}

test("the problem text never carries a value from the response", () => {
  const d = GOOD();
  d.seven_day.utilization = "secret-123";
  const r = parseUsageJson(d);
  assert.doesNotMatch(r.problem, /secret|123/);
});

test("the shape description keeps names and types, and no values", () => {
  const shape = JSON.stringify(describeShape(GOOD()));
  assert.match(shape, /"utilization":"number"/);
  assert.match(shape, /"resets_at":"string"/);
  assert.doesNotMatch(shape, /2026/);
});

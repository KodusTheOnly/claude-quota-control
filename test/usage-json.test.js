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

// Use per product and Claude's resets are optional parts of the answer: never a reason for a failed reading
const { parseProducts, parseResets } = require("../usage-json");
const NOW = Date.parse("2026-11-20T12:00:00Z");

test("the products are read from seven_day_breakdown, biggest first", () => {
  const data = { seven_day_breakdown: { as_of: "x", window_started_at: "x", rows: [
    { key: "chat", display_name: "Chat", percent: 25, percent_of_limit: 5 },
    { key: "code", display_name: "Claude Code", percent: 75, percent_of_limit: 15 },
  ] } };
  assert.deepEqual(parseProducts(data), [{ key: "code", name: "Claude Code", pct: 15 }, { key: "chat", name: "Chat", pct: 5 }]);
});

test("products that look different are left out, and the reading still works", () => {
  assert.equal(parseProducts({}), null);
  assert.equal(parseProducts({ seven_day_breakdown: null }), null);
  assert.equal(parseProducts({ seven_day_breakdown: { rows: [] } }), null);
  assert.equal(parseProducts({ seven_day_breakdown: { rows: [{ display_name: "Chat", percent_of_limit: "5" }] } }), null);
  assert.equal(parseProducts({ seven_day_breakdown: { rows: [{ display_name: "", percent_of_limit: 5 }] } }), null);
  const full = { seven_day: { utilization: 20, resets_at: "2026-11-24T08:00:00Z" }, five_hour: null, seven_day_breakdown: { rows: "?" }, cedar_ember: 7 };
  assert.equal(parseUsageJson(full).ok, true);
});

const grant = (over = {}) => ({ id: "g", label: "x", resets_total: 2, resets_left: 1, ends_at: "2026-12-01T00:00:00Z", usable_now: true, gives_back_weekly: true, ...over });

test("the resets count the offers that give the week back and have not ended", () => {
  const data = { cedar_ember: { grants: [
    grant(),
    grant({ resets_total: 1, resets_left: 1, ends_at: "2026-11-25T00:00:00Z", usable_now: false }),
    grant({ gives_back_weekly: false, resets_total: 5, resets_left: 5 }),
    grant({ ends_at: "2026-11-01T00:00:00Z" }),
  ] } };
  assert.deepEqual(parseResets(data, NOW), { left: 2, total: 3, endsAt: Date.parse("2026-11-25T00:00:00Z"), usableNow: true });
});

test("resets that look different, or none on offer, are left out", () => {
  assert.equal(parseResets({}, NOW), null);
  assert.equal(parseResets({ cedar_ember: { grants: [] } }, NOW), null);
  assert.equal(parseResets({ cedar_ember: { grants: [grant({ resets_left: 3 })] } }, NOW), null, "more left than in all");
  assert.equal(parseResets({ cedar_ember: { grants: [grant({ ends_at: "soon" })] } }, NOW), null);
  assert.equal(parseResets({ cedar_ember: { grants: [grant({ resets_left: 1.5 })] } }, NOW), null);
});

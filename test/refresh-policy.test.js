const test = require("node:test");
const assert = require("node:assert/strict");
const { MIN_GAP, FOCUS_GAP, TIMER_EVERY, TIMER_MAX_FAILS, timerVerdict, decide, createRefreshPolicy, normalizeAccelerator } = require("../refresh-policy");

const MIN = 60 * 1000;
const NOW = 1_000_000_000_000;

test("what the user does on purpose always runs, even without an account", () => {
  for (const reason of ["button", "menu", "keyboard", "shortcut", "strip", "popup-button", "notification"]) {
    for (const connected of [true, false]) {
      assert.deepEqual(decide(reason, { connected, now: NOW, lastAttemptAt: NOW }), { run: true, auto: false }, reason);
    }
  }
});

test("automatic triggers need a connected account and stay silent", () => {
  for (const reason of ["open", "focus", "popup"]) {
    assert.deepEqual(decide(reason, { connected: false, now: NOW, lastAttemptAt: 0 }), { run: false, auto: true }, reason);
    assert.equal(decide(reason, { connected: true, now: NOW, lastAttemptAt: 0 }).auto, true, reason);
  }
});

test("opening the app reads right away, but not twice within a minute", () => {
  assert.equal(decide("open", { connected: true, now: NOW, lastAttemptAt: 0 }).run, true);
  assert.equal(decide("open", { connected: true, now: NOW, lastAttemptAt: NOW - (MIN_GAP - 1) }).run, false);
  assert.equal(decide("open", { connected: true, now: NOW, lastAttemptAt: NOW - MIN_GAP }).run, true);
});

test("gaining focus refreshes only after 5 minutes", () => {
  assert.equal(FOCUS_GAP, 5 * MIN);
  assert.equal(decide("focus", { connected: true, now: NOW, lastAttemptAt: NOW - (FOCUS_GAP - 1) }).run, false);
  assert.equal(decide("focus", { connected: true, now: NOW, lastAttemptAt: NOW - FOCUS_GAP }).run, true);
  assert.equal(decide("focus", { connected: true, now: NOW, lastAttemptAt: 0 }).run, true);
});

test("opening the tray card is held back for a minute only", () => {
  assert.equal(decide("popup", { connected: true, now: NOW, lastAttemptAt: NOW - 30 * 1000 }).run, false);
  assert.equal(decide("popup", { connected: true, now: NOW, lastAttemptAt: NOW - MIN_GAP }).run, true);
});

test("an unknown reason never runs", () => {
  assert.deepEqual(decide("whatever", { connected: true, now: NOW, lastAttemptAt: 0 }), { run: false, auto: false });
  assert.deepEqual(decide(undefined, { connected: true, now: NOW, lastAttemptAt: 0 }), { run: false, auto: false });
});

test("the policy remembers attempts, and a blocked request is not an attempt", () => {
  let clock = NOW;
  const policy = createRefreshPolicy({ now: () => clock });
  assert.equal(policy.request("open", true).run, true);
  clock += 2 * MIN;
  assert.equal(policy.request("focus", true).run, false, "2 minutes after opening");
  clock += 3 * MIN;
  assert.equal(policy.request("focus", true).run, true, "5 minutes after opening: the blocked one did not move the clock");
});

test("a manual refresh also counts, and so does one started from the window", () => {
  let clock = NOW;
  const policy = createRefreshPolicy({ now: () => clock });
  policy.request("shortcut", true);
  clock += 4 * MIN;
  assert.equal(policy.request("focus", true).run, false);
  policy.markAttempt(); // the button in the window goes straight to the sync, not through request()
  clock += 4 * MIN;
  assert.equal(policy.request("focus", true).run, false);
  clock += MIN;
  assert.equal(policy.request("focus", true).run, true);
});

test("a shortcut becomes a canonical accelerator", () => {
  const ok = {
    "Ctrl+Alt+R": "Ctrl+Alt+R",
    "ctrl+alt+r": "Ctrl+Alt+R",
    "Control+Option+r": "Ctrl+Alt+R",
    "Shift+Ctrl+R": "Ctrl+Shift+R",
    "Alt+F5": "Alt+F5",
    "alt+f24": "Alt+F24",
    "Ctrl+Space": "Ctrl+Space",
    "Ctrl+Alt+pageup": "Ctrl+Alt+PageUp",
    "Ctrl+Alt+1": "Ctrl+Alt+1",
    " Ctrl + Alt + R ": "Ctrl+Alt+R",
  };
  for (const [input, expected] of Object.entries(ok)) assert.equal(normalizeAccelerator(input), expected, input);
});

test("anything that would hijack typing or is not a combination is refused", () => {
  const bad = ["", "R", "Shift+R", "Ctrl", "Ctrl+Alt", "Ctrl+A+B", "Win+R", "Super+R", "Ctrl+F25", "Ctrl+F0", "Ctrl+Esc", "Ctrl+??", "Ctrl+", "+", null, undefined, 42];
  for (const input of bad) assert.equal(normalizeAccelerator(input), null, String(input));
});

test("the timer reason is automatic: needs a connection and the one minute gap", () => {
  assert.deepEqual(decide("timer", { connected: false, now: NOW, lastAttemptAt: 0 }), { run: false, auto: true });
  assert.deepEqual(decide("timer", { connected: true, now: NOW, lastAttemptAt: NOW - 10 * 1000 }), { run: false, auto: true });
  assert.deepEqual(decide("timer", { connected: true, now: NOW, lastAttemptAt: NOW - TIMER_EVERY }), { run: true, auto: true });
});

test("the timer stops on a login or challenge page, and after 3 failures in a row", () => {
  assert.deepEqual(timerVerdict(null, 2), { stop: false, fails: 0 });
  assert.equal(timerVerdict("challenge", 0).stop, true);
  assert.equal(timerVerdict("need-login", 0).stop, true);
  assert.deepEqual(timerVerdict("offline", 2), { stop: false, fails: 2 });
  assert.deepEqual(timerVerdict("format", 0), { stop: false, fails: 1 });
  assert.equal(timerVerdict("fail", TIMER_MAX_FAILS - 1).stop, true);
});

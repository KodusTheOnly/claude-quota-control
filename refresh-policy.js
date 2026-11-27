// When the app may read Claude's usage page. Pure on purpose (no Electron, no timers),
// so the rules can be unit-tested. main.js asks decide() and does the rest.

const MIN_GAP = 60 * 1000; // never read more than once a minute, whatever asks
const FOCUS_GAP = 5 * 60 * 1000; // gaining focus refreshes only if the last attempt is older than this

// Something the user did on purpose: always runs, and its result is always shown
const MANUAL_REASONS = new Set(["button", "menu", "keyboard", "shortcut", "strip", "popup-button", "notification"]);
// Happens by itself: needs a connected account and stays silent when it fails
const AUTO_REASONS = new Set(["open", "focus", "popup", "timer"]);

// The optional timer (off by default, Settings > Data > Danger zone). How often it reads, in minutes, or "smart".
// 0 is off. A settings file from before the choice had only autoRead: true, which was every 5 minutes.
const AUTO_READ_CHOICES = [0, 1, 3, 5, 10, 15, 30, 60, "smart"];
const TIMER_EVERY = 5 * 60 * 1000; // the old fixed timer, and what autoRead: true still means
function autoReadEvery(s) {
  if (!s) return 0;
  if (AUTO_READ_CHOICES.includes(s.autoReadEvery)) return s.autoReadEvery;
  return s.autoRead === true ? TIMER_EVERY / 60000 : 0;
}
// Smart: every 5 minutes while a session runs or the week is Tight or Pause ("hot"), every 15 otherwise, and every
// 60 outside the active hours
const SMART_MIN = { hot: 5, calm: 15, outside: 60 };
// How long until the next reading, in ms, or null when the timer is off
function autoReadDelay({ every, hot = false, inActive = true }) {
  if (!every) return null;
  const min = every === "smart" ? (!inActive ? SMART_MIN.outside : hot ? SMART_MIN.hot : SMART_MIN.calm) : every;
  return min * 60 * 1000;
}
// Why a reading that is due is skipped: "hours" (outside the active hours, when the user asked for only those) or
// "idle" (the PC is idle or locked, when the user asked to pause then). null: it runs.
function autoReadSkip({ inActive = true, activeOnly = true, idleState = "active", idlePause = true }) {
  if (activeOnly && !inActive) return "hours";
  if (idlePause && (idleState === "idle" || idleState === "locked")) return "idle";
  return null;
}
// While the 5-hour session is at its limit nothing can change but by hand, so the timer waits for the session's reset
// and reads LOCK_RESUME_AFTER after it. Returns when to read again (ms), or null when the session is not locked.
// fiveHour: { used, resetsAt } from the last reading. With extra usage that can still be spent the limit does not stop
// you (extraCoversLimit in renderer/js/core.js, mirrored here; a test checks they agree).
const LOCK_RESUME_AFTER = 60 * 1000;
function extraCoversLimit(extra) {
  if (!extra) return false;
  if (extra.balance > 0) return true;
  return extra.limit > 0 && Number.isFinite(extra.spent) && extra.spent < extra.limit;
}
function sessionLockedUntil({ fiveHour, extra } = {}, now = Date.now()) {
  if (!fiveHour || !Number.isFinite(fiveHour.used) || !Number.isFinite(fiveHour.resetsAt)) return null;
  if (Math.round(fiveHour.used) < 100 || fiveHour.resetsAt <= now || extraCoversLimit(extra)) return null;
  return fiveHour.resetsAt + LOCK_RESUME_AFTER;
}

// Inside the active hours { start, end } (whole hours, the window may cross midnight), or always when there are none.
// Same rule as activeSpans() in renderer/js/core.js.
function inActiveHours(date, a) {
  if (!a) return true;
  const h = date.getHours();
  return a.start < a.end ? h >= a.start && h < a.end : h >= a.start || h < a.end;
}
// It switches itself off after this many failed readings in a row
const TIMER_MAX_FAILS = 3;
// Errors that say nothing about the connection (the user is offline, or a reading is already running)
const TIMER_NEUTRAL_ERRORS = new Set(["offline", "too-soon", "closed", "already-open"]);
// Errors that mean Claude wants a person here: the timer stops at once
const TIMER_STOP_ERRORS = new Set(["challenge", "need-login"]);

// After each reading made while the timer is on: keep going, or stop? fails = failures in a row before this one.
function timerVerdict(error, fails) {
  if (!error) return { stop: false, fails: 0 };
  if (TIMER_STOP_ERRORS.has(error)) return { stop: true, fails: fails + 1 };
  if (TIMER_NEUTRAL_ERRORS.has(error)) return { stop: false, fails };
  const next = fails + 1;
  return { stop: next >= TIMER_MAX_FAILS, fails: next };
}

// reason: why a refresh was asked for. ctx: { connected, now, lastAttemptAt }.
// Returns { run, auto }: whether to read, and whether to do it silently.
function decide(reason, { connected, now, lastAttemptAt }) {
  if (MANUAL_REASONS.has(reason)) return { run: true, auto: false };
  if (!AUTO_REASONS.has(reason)) return { run: false, auto: false };
  if (!connected) return { run: false, auto: true };
  const gap = reason === "focus" ? FOCUS_GAP : MIN_GAP;
  return { run: now - lastAttemptAt >= gap, auto: true };
}

// Remembers when the last reading was attempted. Only a request that runs counts as an attempt.
function createRefreshPolicy({ now = Date.now } = {}) {
  let lastAttemptAt = 0;
  return {
    request(reason, connected) {
      const decision = decide(reason, { connected, now: now(), lastAttemptAt });
      if (decision.run) lastAttemptAt = now();
      return decision;
    },
    markAttempt() {
      lastAttemptAt = now();
    },
  };
}

// Global shortcut

const MODIFIERS = { ctrl: "Ctrl", control: "Ctrl", alt: "Alt", option: "Alt", shift: "Shift" };
const NAMED_KEYS = ["Space", "Tab", "Backspace", "Delete", "Insert", "Home", "End", "PageUp", "PageDown", "Up", "Down", "Left", "Right", "Enter", "Plus"];

// Turns what the user typed into a canonical Electron accelerator ("Ctrl+Alt+R"), or null when it
// is not a safe global shortcut. It needs Ctrl or Alt (Shift alone would hijack normal typing)
// and exactly one key: a letter, a digit, F1 to F24 or one of NAMED_KEYS.
function normalizeAccelerator(input) {
  if (typeof input !== "string") return null;
  const parts = input.split("+").map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  const mods = new Set();
  let key = null;
  for (const part of parts) {
    const mod = MODIFIERS[part.toLowerCase()];
    if (mod) {
      mods.add(mod);
      continue;
    }
    if (key !== null) return null; // two keys
    if (/^[a-z0-9]$/i.test(part)) key = part.toUpperCase();
    else if (/^f([1-9]|1\d|2[0-4])$/i.test(part)) key = part.toUpperCase();
    else key = NAMED_KEYS.find((k) => k.toLowerCase() === part.toLowerCase()) || null;
    if (key === null) return null;
  }
  if (key === null || !(mods.has("Ctrl") || mods.has("Alt"))) return null;
  return ["Ctrl", "Alt", "Shift"].filter((m) => mods.has(m)).concat(key).join("+");
}

module.exports = { MIN_GAP, FOCUS_GAP, TIMER_EVERY, TIMER_MAX_FAILS, timerVerdict, AUTO_READ_CHOICES, SMART_MIN, autoReadEvery, autoReadDelay, autoReadSkip, inActiveHours, LOCK_RESUME_AFTER, extraCoversLimit, sessionLockedUntil, MANUAL_REASONS, AUTO_REASONS, decide, createRefreshPolicy, normalizeAccelerator };

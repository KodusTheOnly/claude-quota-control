// When the app may read Claude's usage page. Pure on purpose (no Electron, no timers),
// so the rules can be unit-tested. main.js asks decide() and does the rest.

const MIN_GAP = 60 * 1000; // never read more than once a minute, whatever asks
const FOCUS_GAP = 5 * 60 * 1000; // gaining focus refreshes only if the last attempt is older than this

// Something the user did on purpose: always runs, and its result is always shown
const MANUAL_REASONS = new Set(["button", "menu", "keyboard", "shortcut", "strip", "popup-button", "notification"]);
// Happens by itself: needs a connected account and stays silent when it fails
const AUTO_REASONS = new Set(["open", "focus", "popup", "timer"]);

// The optional timer (off by default, Settings > Advanced) reads this often
const TIMER_EVERY = 5 * 60 * 1000;
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

module.exports = { MIN_GAP, FOCUS_GAP, TIMER_EVERY, TIMER_MAX_FAILS, timerVerdict, MANUAL_REASONS, AUTO_REASONS, decide, createRefreshPolicy, normalizeAccelerator };

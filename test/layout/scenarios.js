// Fake usage data for the layout tests. Time is frozen at Wednesday 2026-10-28 18:00 (the tests run in
// the America/Sao_Paulo time zone) and the weekly limit resets on Monday 2026-11-02 at 15:00.
// Nothing here is real usage data.

const HOUR = 3600000;
const DAY = 86400000;
const NOW = new Date(2026, 9, 28, 18, 0, 0).getTime();
const RESETS_AT = new Date(2026, 10, 2, 15, 0, 0).getTime();
const key = (ms) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const TODAY = new Date(2026, 9, 28).getTime();

// The week started Monday 15:00, so 2.125 plan days have passed and 4.875 are left. The level counts the hours the
// pace so far would leave without Claude before the reset (it reaches 100% at T, hours = reset - T): 0 h Free, up to
// 5 h Moderate, up to 24 h Tight, above that Pause. The base week is at 31%: T is about 3 h before the reset (Moderate).
// LEVEL_OF says which level each level scenario must read; the layout run checks it on the page.
function base() {
  return {
    language: "en",
    claudeConnected: true,
    notifyAll: false,
    showExtra: true,
    weights: [1, 1, 1, 1, 1, 1, 1],
    manual: {
      anchor: RESETS_AT,
      updatedAt: NOW - 2 * 60000,
      via: "sync",
      weekly: { used: 31, resetsAt: RESETS_AT },
      fiveHour: { used: 58, resetsAt: NOW + 2 * HOUR + 10 * 60000, at: NOW - 2 * 60000 },
      dayStart: { day: key(NOW), at: NOW - 9 * HOUR, used: 19 },
      days: {
        [key(TODAY - 2 * DAY)]: { spent: 8, budget: 14.3, endUsed: 8 },
        [key(TODAY - 1 * DAY)]: { spent: 11, budget: 13.9, endUsed: 19 },
        [key(TODAY)]: { spent: 12, budget: 14, endUsed: 31 },
      },
    },
    readings: [],
    sessions: [],
    extra: { limit: 20, spent: 4.2, balance: 15.8, currency: "USD", autoReload: false, at: NOW - 3600000 },
  };
}

const SCENARIOS = {
  // 31% used: the pace reaches 100% about 3 h before the reset
  moderate: (s) => s,
  // 14% used: the pace never reaches 100% before the reset
  free: (s) => {
    s.manual.weekly.used = 14;
    s.manual.dayStart.used = 9;
    s.manual.days[key(TODAY)] = { spent: 5, budget: 14, endUsed: 14 };
    s.manual.days[key(TODAY - DAY)] = { spent: 5, budget: 14, endUsed: 9 };
    s.manual.days[key(TODAY - 2 * DAY)] = { spent: 4, budget: 14, endUsed: 4 };
    s.manual.fiveHour.used = 22;
    return s;
  },
  // 33% used, and Tuesday went past its budget: the pace reaches 100% about 13 h before the reset
  tight: (s) => {
    s.manual.weekly.used = 33;
    s.manual.dayStart.used = 25;
    s.manual.days[key(TODAY - DAY)] = { spent: 19, budget: 13.9, endUsed: 25 };
    s.manual.days[key(TODAY - 2 * DAY)] = { spent: 6, budget: 14.3, endUsed: 6 };
    s.manual.days[key(TODAY)] = { spent: 8, budget: 12.9, endUsed: 33 };
    s.manual.fiveHour.used = 81;
    return s;
  },
  // The week is almost used up: 96% reads Pause on its own (95% or more)
  pause: (s) => {
    s.manual.weekly.used = 96;
    s.manual.dayStart.used = 70;
    s.manual.days[key(TODAY - DAY)] = { spent: 40, budget: 13.9, endUsed: 70 };
    s.manual.days[key(TODAY - 2 * DAY)] = { spent: 30, budget: 14.3, endUsed: 30 };
    s.manual.days[key(TODAY)] = { spent: 26, budget: 6, endUsed: 96 };
    s.manual.fiveHour.used = 93;
    return s;
  },
  // The last day: the reset is 20 h away and the pace ends far under the goal, so the week turns to the accent
  lastday: (s) => {
    const resetsAt = NOW + 20 * HOUR;
    s.manual.anchor = resetsAt;
    s.manual.weekly = { used: 70, resetsAt };
    s.manual.dayStart.used = 62;
    s.manual.days = {};
    [10, 22, 34, 41, 50, 58, 62].forEach((end, i, all) => {
      s.manual.days[key(TODAY - (7 - i) * DAY)] = { spent: end - (all[i - 1] || 0), budget: 14, endUsed: end };
    });
    s.manual.days[key(TODAY)] = { spent: 8, budget: 30, endUsed: 70 };
    return s;
  },
  // No session reading: the session cannot be rated
  notrated: (s) => {
    s.manual.fiveHour = null;
    return s;
  },
  // The reading is over an hour old
  stale: (s) => {
    s.manual.updatedAt = NOW - (1 * HOUR + 12 * 60000);
    return s;
  },
  // No internet connection (the page is told it is offline)
  offline: (s) => {
    s.manual.updatedAt = NOW - 18 * 60000;
    return s;
  },
  // Today is a day off in the plan: nothing to rate or spend
  dayoff: (s) => {
    s.weights = [1, 1, 1, 0, 1, 1, 1]; // Wednesday
    s.manual.weekly.used = 19;
    s.manual.days[key(TODAY)] = { spent: 0, budget: 0, endUsed: 19 };
    return s;
  },
  // Three months of readings with gaps, and sessions that mostly start in the morning: every part of History is filled
  history: (s) => {
    for (let i = 3; i < 100; i++) {
      if (i % 7 === 3 || i % 11 === 5) continue; // days without a reading
      const spent = [6, 9, 12, 8, 14, 10, 7, 13, 5, 11][i % 10];
      s.manual.days[key(TODAY - i * DAY)] = { spent, budget: 14, endUsed: 20 + ((i * 7) % 70) };
    }
    const starts = [8, 8, 9, 9, 10, 14, 15, 8, 9, 19];
    s.sessions = Array.from({ length: 30 }, (_, i) => ({ sr: TODAY - (i + 1) * DAY + (starts[i % 10] + 5) * HOUR, peak: 20 + i }));
    return s;
  },
  // No readings in the last 90 days and no sessions: the empty states of History
  histempty: (s) => {
    s.manual.days = {};
    return s;
  },
  // A refresh is running
  updating: (s) => s,
  // Extra usage turned off in Settings
  noextra: (s) => {
    s.showExtra = false;
    return s;
  },
  // Extra usage is on in Settings but the account has none: the block shows its empty state
  extraempty: (s) => {
    delete s.extra;
    return s;
  },
  // Not signed in to Claude: the header offers to connect
  noaccount: (s) => {
    s.claudeConnected = false;
    s.manual.via = "manual";
    return s;
  },
  // Nothing read yet (first run): the Overview asks for a first reading
  nodata: (s) => {
    s.claudeConnected = false;
    delete s.manual;
    return s;
  },
};

function settingsFor(name, language = "en") {
  const s = SCENARIOS[name](base());
  s.language = language;
  return s;
}

// The level the verdict must read in each level scenario (the week's level, from the hours locked out).
// Free with room to spend lights the Room mark of the ruler instead of Free.
const LEVEL_OF = { free: "room", moderate: "moderate", tight: "tight", pause: "pause" };

module.exports = { NOW, SCENARIOS: Object.keys(SCENARIOS), LEVEL_OF, settingsFor };

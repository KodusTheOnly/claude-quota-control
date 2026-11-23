#!/usr/bin/env node
// Claude Quota Control collector.
// Claude Code sends a JSON on stdin every time the status line updates. This script saves
// the limits (5-hour and weekly) and a daily history to ~/.claude/claude-quota-control.json.
// It never calls Claude and uses none of your quota.
//
// If you already had a status line, the app keeps its command in
// ~/.claude/claude-quota-control-config.json and this script forwards the JSON to it.
// The same file holds the language (lang) used in the status line text.

const fs = require("fs");
const path = require("path");
const os = require("os");
const { execSync } = require("child_process");

const CLAUDE_DIR = path.join(os.homedir(), ".claude");
const DATA_FILE = path.join(CLAUDE_DIR, "claude-quota-control.json");
const CONFIG_FILE = path.join(CLAUDE_DIR, "claude-quota-control-config.json");

// Status line text (same language choice as the app)
const TEXT = {
  en: { noData: "quota: no data yet", week: "week", today: "today", off: "off" },
  "pt-BR": { noData: "quota: sem dados ainda", week: "semana", today: "hoje", off: "folga" },
};
const DAY_MS = 24 * 60 * 60 * 1000;
const KEEP_DAYS = 120;
const RECENT_KEEP_MS = 8 * DAY_MS; // readings kept for the hourly strip
const RECENT_MAX = 600;

function toMs(value) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "number") return value < 1e12 ? value * 1000 : value;
  const n = Number(value);
  if (!Number.isNaN(n)) return n < 1e12 ? n * 1000 : n;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function readWindow(win) {
  if (!win || typeof win.used_percentage !== "number") return null;
  return { used: win.used_percentage, resetsAt: toMs(win.resets_at) };
}

function dayKey(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function fmtDuration(ms) {
  if (ms <= 0) return "now";
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (h >= 24) return `${Math.floor(h / 24)}d${h % 24}h`;
  return h > 0 ? `${h}h${String(m).padStart(2, "0")}m` : `${m}m`;
}

// Same week if the reset time matches (within 1 h, since it can drift)
function sameWeek(a, b) {
  return a && b && a.resetsAt && b.resetsAt && Math.abs(a.resetsAt - b.resetsAt) < 3600000;
}

// Weekday weights (0 = Sunday) and active hours, set in the app. Same as weightPieces / weightedDays in
// renderer/js/core.js: a day weighs its weight, spread over its active hours (the whole day when there are none);
// a window that crosses midnight counts its two parts for the calendar day that holds them.
function activeSpans(ms, a) {
  const d = new Date(ms);
  const h = (x) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), x).getTime();
  if (a.start < a.end) return [[h(a.start), h(a.end)]];
  return [[h(0), h(a.end)], [h(a.start), h(24)]].filter(([x, y]) => y > x);
}
function weightedDays(from, to, w, a = null) {
  let total = 0;
  let cur = from;
  while (cur < to) {
    const d = new Date(cur);
    const next = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
    const end = Math.min(next, to);
    // A whole day is its weight, also when the clock changes and it has 23 or 25 hours
    if (!a) total += ((end - cur) / (next - new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime())) * w[d.getDay()];
    else {
      const spans = activeSpans(cur, a);
      const len = spans.reduce((s, [x, y]) => s + y - x, 0);
      for (const [x, y] of spans) {
        const p0 = Math.max(x, cur);
        const p1 = Math.min(y, end);
        if (p1 > p0) total += ((p1 - p0) / len) * w[d.getDay()];
      }
    }
    cur = end;
  }
  return total;
}

// Same as dayShare / dayBudget in renderer/js/core.js: today's weight counts only the part of
// today inside the week (from the reset time on the reset day, up to the next reset on the last day)
function dayBudget(remaining, resetsAt, now, w, a = null) {
  if (!resetsAt) return remaining / 7;
  const d = new Date(now);
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const next = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
  const from = Math.max(start, resetsAt - 7 * DAY_MS);
  const share = weightedDays(from, Math.min(next, resetsAt), w, a);
  const left = weightedDays(from, resetsAt, w, a);
  // The week's last hours fall outside the active hours: today (not an Off day) gets everything left
  if (share <= 0) return left <= 0 && w[d.getDay()] !== 0 ? Math.max(remaining, 0) : 0;
  return (Math.max(remaining, 0) * share) / Math.max(left, share);
}

// The emergency reserve (Settings > Plan in the app), same as goalSettings / reserveHeld / reserveLeft /
// reserveReleased / planBudget in renderer/js/core.js: the plan is 100% minus the reserve, and what is left of the
// reserve joins the plan over its last `release` hours before the reset (0 = never).
const GOAL = 100;
function goalOf(config) {
  const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const reserve = Math.max(Math.min(Math.round(num(config && config.reserve) ?? 0), 20), 0);
  const rel = num(config && config.reserveRelease);
  return { goal: GOAL, reserve, release: [24, 48, 72, 0].includes(rel) ? rel : 48 };
}
// Same as reserveWindow in renderer/js/core.js: the release follows the plan, and when its hours hold no plan time it
// moves to the last planned stretch before them (the last day with weight, or its part inside the active hours)
function reserveWindow(resetsAt, g, w, a = null) {
  if (!g.reserve || !g.release) return null;
  const weekStart = resetsAt - 7 * DAY_MS;
  let from = Math.max(resetsAt - g.release * 3600000, weekStart);
  let span = weightedDays(from, resetsAt, w, a);
  if (span <= 0) {
    let found = null;
    for (let cur = weekStart; cur < from; ) {
      const d = new Date(cur);
      const next = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
      const end = Math.min(next, from);
      if (w[d.getDay()] > 0) {
        const spans = a ? activeSpans(cur, a) : [[cur, end]];
        for (const [x, y] of spans) if (Math.min(y, end) > Math.max(x, cur)) found = Math.max(x, cur);
      }
      cur = end;
    }
    if (found === null) return null;
    from = found;
    span = weightedDays(from, resetsAt, w, a);
  }
  return { from, span };
}
function reserveHeld(ms, resetsAt, g, w, a = null) {
  if (!g.reserve) return 0;
  const win = reserveWindow(resetsAt, g, w, a);
  if (!win || ms <= win.from) return g.reserve;
  if (ms >= resetsAt) return 0;
  return g.reserve * Math.min(weightedDays(ms, resetsAt, w, a) / win.span, 1);
}
function planBudget(usedStart, resetsAt, now, g, w, a = null) {
  const plan = dayBudget(g.goal - g.reserve - usedStart, resetsAt, now, w, a);
  if (!resetsAt || !g.reserve) return plan;
  const d = new Date(now);
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const next = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
  const from = Math.max(start, resetsAt - 7 * DAY_MS);
  const to = Math.min(next, resetsAt);
  // No plan time left before the reset: the whole reserve left joins today too
  if (weightedDays(from, to, w, a) <= 0) return weightedDays(from, resetsAt, w, a) <= 0 && w[d.getDay()] !== 0 ? Math.max(g.goal - usedStart, 0) : plan;
  const left = Math.min(Math.max(g.goal - Math.max(usedStart, g.goal - g.reserve), 0), g.reserve);
  const held = reserveHeld(from, resetsAt, g, w, a);
  if (!(left > 0) || held <= 0) return plan;
  return plan + (left * Math.max(held - reserveHeld(to, resetsAt, g, w, a), 0)) / held;
}

// Short log of the readings (time, weekly %, session %, session reset), so the app can rebuild
// the hours it missed while it was closed. A reading that repeats the last one only moves its
// "to" time, and that still proves nothing was used in between. Stored values are never
// rounded: they are exactly what Claude Code sent.
function updateRecent(prevList, now, weekly, fiveHour) {
  const list = Array.isArray(prevList) ? prevList.filter((r) => r && typeof r.at === "number" && now - r.at < RECENT_KEEP_MS) : [];
  const entry = { at: now, w: weekly.used, s: fiveHour ? fiveHour.used : null, sr: fiveHour ? fiveHour.resetsAt : null };
  const last = list[list.length - 1];
  const same = last && last.w === entry.w && last.s === entry.s && last.sr === entry.sr;
  if (same) last.to = now;
  else list.push(entry);
  while (list.length > RECENT_MAX) list.shift();
  return list;
}

function record(input) {
  const limits = input.rate_limits || {};
  const fiveHour = readWindow(limits.five_hour);
  const weekly = readWindow(limits.seven_day);
  if (!weekly) return null;

  const now = Date.now();
  const today = dayKey(now);
  const prev = readJson(DATA_FILE) || {};
  const continuing = sameWeek(prev.weekly, weekly);

  // How much it rose since the last reading. New week: everything shown belongs to this cycle.
  let delta = 0;
  if (prev.weekly) delta = continuing ? Math.max(weekly.used - prev.weekly.used, 0) : weekly.used;

  // Start of day: whatever rose since the last reading counts for today,
  // so the budget starts from the previous number
  let dayStart = prev.dayStart;
  if (!prev.weekly) {
    dayStart = { day: today, at: now, used: weekly.used };
  } else if (!continuing) {
    const lastReset = weekly.resetsAt ? weekly.resetsAt - 7 * DAY_MS : now;
    dayStart = { day: today, at: Math.max(lastReset, new Date(now).setHours(0, 0, 0, 0)), used: 0 };
  } else if (!dayStart || dayStart.day !== today) {
    dayStart = { day: today, at: now, used: prev.weekly.used };
  }

  const days = prev.days || {};
  // New week mid-day: today's spend restarts along with the limit
  const entry = (continuing && days[today]) || {};
  const config = readJson(CONFIG_FILE) || {};
  const w = weightsOf(config);
  const spent = Math.round(((entry.spent || 0) + delta) * 100) / 100;
  // The week went down without a reset (Claude gave part of it back): the day's start moves down by as much
  // (mirrors saveManual in renderer/js/compute.js)
  if (continuing && dayStart.used > weekly.used - spent + 0.5) dayStart = { ...dayStart, used: Math.max(Math.round((weekly.used - spent) * 100) / 100, 0) };
  days[today] = {
    spent,
    budget: Math.round(planBudget(dayStart.used, weekly.resetsAt, now, goalOf(config), w, activeOf(config)) * 100) / 100,
    endUsed: weekly.used,
  };

  // Keep only the latest days
  const cutoff = dayKey(now - KEEP_DAYS * DAY_MS);
  for (const k of Object.keys(days)) if (k < cutoff) delete days[k];

  const recent = updateRecent(prev.recent, now, weekly, fiveHour);
  const data = { version: 2, updatedAt: now, fiveHour, weekly, dayStart, days, recent };
  try {
    fs.mkdirSync(CLAUDE_DIR, { recursive: true });
    const tmp = `${DATA_FILE}.${process.pid}.tmp`; // several Claude Code sessions can write at the same moment
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, DATA_FILE);
  } catch {
    // A failed write must never break the status line
  }
  return data;
}

function ownLine(input, data, lang) {
  const text = TEXT[lang] || TEXT.en;
  const model = input.model && (input.model.display_name || input.model.id);
  const parts = [];
  if (model) parts.push(model);
  if (!data) {
    parts.push(text.noData);
    return parts.join(" | ");
  }
  const now = Date.now();
  if (data.fiveHour) {
    const left = data.fiveHour.resetsAt ? ` (${fmtDuration(data.fiveHour.resetsAt - now)})` : "";
    parts.push(`5h ${Math.round(data.fiveHour.used)}%${left}`);
  }
  const today = data.days[dayKey(now)];
  parts.push(`${text.week} ${Math.round(data.weekly.used)}%`);
  if (today) parts.push(todayText(text, today, now, weightsOf(readJson(CONFIG_FILE))));
  return parts.join(" | ");
}

// On an Off day (plan weight 0) there is no budget to print, so show the use as a share of the week
function todayText(text, today, now, w) {
  const used = Math.round(today.spent);
  // A day that is not Off but has no budget at all (the hours after a reset past the active hours): only the use
  if (w[new Date(now).getDay()] !== 0) return today.budget > 0 ? `${text.today} ${used}/${Math.round(today.budget)}%` : `${text.today} ${used}%`;
  return used > 0 ? `${text.today} ${used}% (${text.off})` : `${text.today} ${text.off}`;
}

// Same check as activeHours() in renderer/js/core.js
function activeOf(config) {
  const a = config && config.activeHours;
  const isHour = (h) => Number.isInteger(h) && h >= 0 && h <= 23;
  if (!a || !isHour(a.start) || !isHour(a.end) || a.start === a.end) return null;
  return { start: a.start, end: a.end };
}

function weightsOf(config) {
  return config && Array.isArray(config.weights) && config.weights.length === 7 ? config.weights.map(Number) : [1, 1, 1, 1, 1, 1, 1];
}

function main(raw) {
  let input = {};
  try {
    input = JSON.parse(raw || "{}");
  } catch {
    // Invalid JSON: carry on without data
  }

  const data = record(input);

  // Forward to the old status line, if there is one
  const config = readJson(CONFIG_FILE);
  if (config && config.chainCommand) {
    try {
      const out = execSync(config.chainCommand, { input: raw, timeout: 4000, encoding: "utf8" });
      process.stdout.write(out.replace(/\s+$/, ""));
      return;
    } catch {
      // If the old one fails, show ours
    }
  }
  process.stdout.write(ownLine(input, data, config && config.lang));
}

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => (buffer += chunk));
process.stdin.on("end", () => main(buffer));

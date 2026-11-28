// Renderer for Claude Quota Control. Text comes from i18n.js (English and Brazilian Portuguese).
// Usage arrives from two sources: a reading of Claude's usage page (button or typed in) and,
// if installed, the Claude Code collector. The latest reading always wins.
// The scripts in js/ load in order and share one global scope.

const DAY = 86400000;
const WEEK = 7 * DAY;
const HOUR = 3600000;
const SPIKE_FACTOR = 2; // notify when a session passes twice the typical peak
const SPIKE_MIN_SESSIONS = 6; // and only after 6 sessions with use
const MAP_MIN_SESSIONS = 5;
const MIN = 60000;
const $ = (id) => document.getElementById(id);
const api = window.quota;
const t = I18N.t;
const SVG = "http://www.w3.org/2000/svg";

const state = {
  data: null, // Claude Code collector reading
  settings: null, // settings + manual data + readings log
  view: "panel",
  range: 14,
  syncMsg: null,
};

// Formatting

const pct = (n) => `${Math.round(n) || 0}%`;
const pad = (n) => String(n).padStart(2, "0");
const round2 = (n) => Math.round(n * 100) / 100;
// Numbers are written the way the app's language writes them: 1.5 in English, 1,5 in Portuguese
const numLocale = () => (I18N.getLang() === "pt-BR" ? "pt-BR" : "en-US");
const fmtNum = (n, min = 0, max = 2) => n.toLocaleString(numLocale(), { minimumFractionDigits: min, maximumFractionDigits: max });

function dayKey(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function startOfDay(ms) {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}
// Where the week chart's axis starts (the hours and the day columns too): at the reset, so the hours before it take no
// room. The first day's column keeps at least 16 hours, so its card stays readable: with a reset later than 08:00 the
// axis starts at 08:00 that day, and the hours from there to the reset are shaded as "not this week".
const CHART_FIRST_DAY_MIN = 16 * HOUR;
function chartAxisStart(weekStart) {
  return Math.min(weekStart, startOfDay(weekStart) + DAY - CHART_FIRST_DAY_MIN);
}
function fmtDur(ms) {
  if (ms <= 0) return t("dur.now");
  const d = Math.floor(ms / DAY);
  const h = Math.floor((ms % DAY) / HOUR);
  const m = Math.floor((ms % HOUR) / MIN);
  if (d > 0) return `${d}d ${h}h`;
  return h > 0 ? `${h}h ${pad(m)}m` : t("dur.min", { n: Math.max(m, 1) });
}
function fmtTime(ms) {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
// "23:10" today, "tomorrow 08:00", "Thu 15:00" within the week, "Oct 30, 08:00" later (or the Portuguese equivalent)
function shortWeekday(d) {
  return d.toLocaleDateString(I18N.locale(), { weekday: "short" }).replace(/\.$/, "");
}
function fmtWhen(ms, now = Date.now()) {
  const d = new Date(ms);
  const days = Math.round((startOfDay(ms) - startOfDay(now)) / DAY);
  if (days === 0) return fmtTime(ms);
  if (days === 1) return t("when.tomorrow", { time: fmtTime(ms) });
  if (days > 1 && days < 7) return `${shortWeekday(d)} ${fmtTime(ms)}`;
  return `${d.toLocaleDateString(I18N.locale(), { month: "short", day: "numeric" })}, ${fmtTime(ms)}`;
}
function ago(ms) {
  const d = Date.now() - ms;
  return d < MIN ? t("ago.justNow") : t("ago.ago", { dur: fmtDur(d) });
}
// Money from the usage page, in the user's language but the page's currency
// `short` drops the cents of a whole amount: "$20" instead of "$20.00"
function fmtMoney(amount, currency, symbol, short = false) {
  if (amount === null || amount === undefined) return "–";
  const locale = numLocale();
  const digits = short && Number.isInteger(amount) ? 0 : 2;
  if (!currency) return `${symbol || ""}${amount.toLocaleString(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
  return new Intl.NumberFormat(locale, { style: "currency", currency, minimumFractionDigits: digits, maximumFractionDigits: digits }).format(amount);
}
function toLocalInput(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
function el(tag, attrs = {}, parent) {
  const node = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (parent) parent.appendChild(node);
  return node;
}
function readNumber(input) {
  const raw = String(input.value).trim().replace(",", ".");
  if (raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : NaN;
}

// A moment a reset can really be at: a number inside the range of dates. Anything else (a damaged file, a value
// edited by hand) is no reset at all, or the week's math would walk day by day toward it.
const isMoment = (ms) => typeof ms === "number" && Number.isFinite(ms) && ms > 0 && ms < 8.64e15;

// The weekly reset is fixed: from a known reset, find the next one after now (whole weeks forward, or back when the
// known one is more than a week ahead). Worked out in one step, however far the known reset is.
function nextReset(anchor, now = Date.now()) {
  if (!isMoment(anchor)) return null;
  const r = anchor + Math.ceil((now - anchor) / WEEK) * WEEK;
  return r <= now ? r + WEEK : r;
}

// Weekday weights

// Each day (0 = Sunday) has a weight: 0 off, 0.5 light, 1 normal, 2 heavy.
// What is left of the week is split in proportion to the weights of the remaining days.
const WEIGHT_STEPS = [1, 2, 0, 0.5]; // click order: normal, heavy, off, light
const WEIGHT_NAME = { 0: "off", 0.5: "light", 1: "normal", 2: "heavy" };

function weights() {
  const w = state.settings && state.settings.weights;
  if (!Array.isArray(w) || w.length !== 7) return [1, 1, 1, 1, 1, 1, 1];
  return w.map((x) => (Number.isFinite(Number(x)) ? Number(x) : 1));
}
function evenWeights() {
  return weights().every((x) => x === 1);
}
// Active hours (Settings): the part of each day the plan counts, as whole hours { start, end } (0-23).
// A window can cross midnight (9 to 1): then a calendar day holds two parts, 00:00-01:00 and 09:00-24:00,
// and both count for that calendar day. A whole day still weighs its weight, spread only over the window,
// so the time outside it counts as nothing. null (or start = end) is the whole day.
const ACTIVE_DEFAULT = { start: 9, end: 1 }; // what Settings offers when the window is turned on
const isHour = (h) => Number.isInteger(h) && h >= 0 && h <= 23;
function activeHours(s = state.settings) {
  const a = s && s.activeHours;
  if (!a || !isHour(a.start) || !isHour(a.end) || a.start === a.end) return null;
  return { start: a.start, end: a.end };
}
// The window's parts inside the calendar day that holds `ms`, as [from, to] times
function activeSpans(ms, a) {
  const d = new Date(ms);
  const h = (x) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), x).getTime();
  if (a.start < a.end) return [[h(a.start), h(a.end)]];
  return [[h(0), h(a.end)], [h(a.start), h(24)]].filter(([x, y]) => y > x);
}
// The pieces of time between from and to over which the plan's weight runs at a steady rate:
// [{ from, to, wt, len }], where a piece is worth ((to - from) / len) * wt weighted days. Without active hours
// each calendar day is one piece (len = that day's own length: 23 or 25 hours when the clock changes, so the day
// still weighs its whole weight); with them, each part of the window is one (len = the window's length that day)
// and the time outside the window is left out.
// w is the plan's weights by weekday. The projection passes a function instead (ms -> the weight of that calendar
// day), since what it learned is by day of the week's seven, not by weekday (learn.js).
function weightPieces(from, to, w = weights(), a = activeHours()) {
  const out = [];
  let cur = from;
  while (cur < to) {
    const d = new Date(cur);
    const next = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
    const end = Math.min(next, to);
    const wt = typeof w === "function" ? w(cur) : w[d.getDay()];
    if (!a) out.push({ from: cur, to: end, wt, len: next - new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() });
    else {
      const spans = activeSpans(cur, a);
      const len = spans.reduce((s, [x, y]) => s + y - x, 0);
      for (const [x, y] of spans) {
        const p0 = Math.max(x, cur);
        const p1 = Math.min(y, end);
        if (p1 > p0) out.push({ from: p0, to: p1, wt, len });
      }
    }
    cur = end;
  }
  return out;
}
const pieceDays = (p) => ((p.to - p.from) / p.len) * p.wt;
// Sum of the weights between two instants, counting the fraction of each day (of its active hours, when set)
function weightedDays(from, to, w = weights(), a = activeHours()) {
  let total = 0;
  for (const p of weightPieces(from, to, w, a)) total += pieceDays(p);
  return total;
}
// The weighted share of the day that holds `ms` that falls inside the week ending at resetsAt.
// A whole day is its weight; the reset day counts only from the reset time, and the last day
// before the next reset only up to it.
function dayShare(ms, resetsAt, w = weights()) {
  const d = new Date(ms);
  const next = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
  return weightedDays(Math.max(startOfDay(ms), resetsAt - WEEK), Math.min(next, resetsAt), w);
}
// A day whose plan weight is Off. Its budget is 0 by design, so it has no ratio and no day level.
const isDayOff = (ms, w = weights()) => w[new Date(ms).getDay()] === 0;
// What an Off today shows as its number: the use as a share of the week, or a dash when nothing was used
const offDayNumber = (spent) => (Math.round(spent) > 0 ? `${Math.round(spent)}%` : "–");
// The week's last hours fall outside the active hours: from the start of today (not an Off day) to the reset
// there is no plan time left. Today then gets everything left, since it is lost at the reset.
function weekEndsUnplanned(now, resetsAt, w = weights()) {
  return !isDayOff(now, w) && weightedDays(Math.max(startOfDay(now), resetsAt - WEEK), resetsAt, w) <= 0;
}
// Today (not an Off day) has no plan time inside this week, and the week does not end today: the hours after a reset
// that falls past the end of the active hours. The budget is 0 there by design, so the day is not rated, like an Off day.
function dayIdle(now, resetsAt, w = weights()) {
  return !isDayOff(now, w) && dayShare(now, resetsAt, w) <= 0 && !weekEndsUnplanned(now, resetsAt, w);
}
// Today's budget: today's share of what is left, counting the week from the start of the day
function dayBudget(remaining, resetsAt, now, w = weights()) {
  const share = dayShare(now, resetsAt, w);
  if (share <= 0) return weekEndsUnplanned(now, resetsAt, w) ? Math.max(remaining, 0) : 0;
  const from = Math.max(startOfDay(now), resetsAt - WEEK);
  return (Math.max(remaining, 0) * share) / Math.max(weightedDays(from, resetsAt, w), share);
}
// The week's plan and the emergency reserve (Settings, Reserve).
// goal: where the plan ends at the reset. It is always 100%: a goal under 100% only left quota unused.
// reserve: kept out of the daily plan, for when something comes up. release: the hours before the
// reset over which what is left of the reserve joins the plan, so it does not go to waste (0 = never).
const GOAL = 100;
const RESERVE_MAX = 20; // the largest choice in Settings
const RELEASE_CHOICES = [24, 48, 72, 0];
const RELEASE_DEFAULT = 48;
// How far under the plan's ceiling the pace has to end (in points of the week) for the verdict to say there is room to spend
const ROOM_GAP = 8;
// The plan with no reserve: the whole limit
const FULL_WEEK = { goal: GOAL, reserve: 0, release: 0 };

// The reserve and its release from the settings, each one checked and kept in range.
// A goal saved by an older version is ignored.
function goalSettings(s = state.settings) {
  const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const reserve = Math.max(Math.min(Math.round(num(s && s.reserve) ?? 0), RESERVE_MAX), 0);
  const rel = num(s && s.reserveRelease);
  return { goal: GOAL, reserve, release: RELEASE_CHOICES.includes(rel) ? rel : RELEASE_DEFAULT };
}
// Where the release runs: { from, span }. It starts `release` hours before the reset and follows the plan, like the
// rest of the week: a heavy day gets more of it, an Off day and the hours outside the active hours none. When those
// hours hold no plan time at all (a reset after a weekend Off, say), the reserve joins the last planned stretch before
// them instead, so it is never lost. span is the plan time it spreads over. null: no release, or no plan time at all.
function reserveWindow(resetsAt, g, w = weights(), a = activeHours()) {
  if (!g.reserve || !g.release) return null;
  let from = Math.max(resetsAt - g.release * HOUR, resetsAt - WEEK);
  let span = weightedDays(from, resetsAt, w, a);
  if (span <= 0) {
    const planned = weightPieces(resetsAt - WEEK, from, w, a).filter((p) => p.wt > 0);
    if (!planned.length) return null;
    from = planned[planned.length - 1].from;
    span = weightedDays(from, resetsAt, w, a);
  }
  return { from, span };
}
// How much of the reserve is still held back at `ms`: all of it until the release starts, then less and less, as the
// plan time of the release goes by, until the reset, when none is held. Without a release it is held to the end.
function reserveHeld(ms, resetsAt, g, w = weights(), a = activeHours()) {
  if (!g.reserve) return 0;
  const win = reserveWindow(resetsAt, g, w, a);
  if (!win || ms <= win.from) return g.reserve;
  if (ms >= resetsAt) return 0;
  return g.reserve * Math.min(weightedDays(ms, resetsAt, w, a) / win.span, 1);
}
// The plan's ceiling at `ms`: the goal minus the reserve still held. Use above it comes from the reserve.
const planCeiling = (ms, resetsAt, g, w = weights()) => g.goal - reserveHeld(ms, resetsAt, g, w);
// What is left of the reserve after `used`% of the week: use above goal - reserve was taken from it
const reserveLeft = (used, g) => Math.min(Math.max(g.goal - Math.max(used, g.goal - g.reserve), 0), g.reserve);
// The part of the reserve left (`left`) that the release hands to the plan between a and b, counted from
// `from` (the start of today): it spreads over the release still to come, as the release does (reserveHeld).
function reserveReleased(left, a, b, from, resetsAt, g, w = weights()) {
  const held = reserveHeld(from, resetsAt, g, w);
  if (!(left > 0) || held <= 0) return 0;
  return (left * Math.max(reserveHeld(a, resetsAt, g, w) - reserveHeld(b, resetsAt, g, w), 0)) / held;
}
// Today's budget with the goal and the reserve: today's share of the plan (goal - reserve) left at the
// start of the day, plus the part of the reserve that today's release hands over. An Off day stays at 0.
// With FULL_WEEK it is dayBudget(100 - usedStart).
function planBudget(usedStart, resetsAt, now, g, w = weights()) {
  const plan = dayBudget(g.goal - g.reserve - usedStart, resetsAt, now, w);
  // No plan time left before the reset: the whole reserve left joins today too
  if (dayShare(now, resetsAt, w) <= 0) return weekEndsUnplanned(now, resetsAt, w) ? Math.max(g.goal - usedStart, 0) : plan;
  const from = Math.max(startOfDay(now), resetsAt - WEEK);
  const d = new Date(now);
  const to = Math.min(new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime(), resetsAt);
  return plan + reserveReleased(reserveLeft(usedStart, g), from, to, from, resetsAt, g, w);
}
// How much fits in a normal day from now until the reset
function perNormalDay(remaining, resetsAt, now, w = weights()) {
  return Math.max(remaining, 0) / Math.max(weightedDays(now, resetsAt, w), 1);
}

// Where the week ends at the pace so far. The pace is per weighted day (a day with weight 1),
// so a week with days off is not read as slow, and a heavy day does not look like a spike.
const MIN_WEIGHTED_DAYS = 1.5; // about a day and a half of normal days before projecting
function projectWeek(used, resetsAt, now, w = weights()) {
  const elapsed = weightedDays(resetsAt - WEEK, now, w);
  if (elapsed < MIN_WEIGHTED_DAYS || used < 1) return null;
  const rate = used / elapsed; // % per weighted day
  const left = weightedDays(now, resetsAt, w);
  const projected = used + rate * left;
  const eta = projected > 100 ? paceReaches(100, used, rate, now, resetsAt, w) : null;
  return { rate, projected, eta };
}

// When the pace so far reaches `target`% of the week: walk forward piece by piece (weightPieces), since the slope
// changes at every midnight and at the edges of the active hours. The same walk draws the dashed projection on the chart. null when it does not get
// there before the reset; now when it is already there.
function paceReaches(target, used, rate, now, resetsAt, w = weights()) {
  if (used >= target) return now;
  if (!(rate > 0)) return null;
  let need = (target - used) / rate; // weighted days
  for (const p of weightPieces(now, resetsAt, w)) {
    const avail = pieceDays(p);
    if (p.wt > 0 && avail >= need) return p.from + (need / p.wt) * p.len;
    need -= avail;
  }
  return null;
}

// Levels

// 0 Free, 1 Moderate, 2 Tight, 3 Pause. null means "not rated yet".
// Today and the days come from a ratio (used / budget): up to 0.7, 1.0 and 1.4.
// The projection has its own scale (hours locked out, LOCK_CUTS below), and the week follows it (weekLevel).
// The 5-hour session is rated like the week, on its pace (sessionLevel below); its first minutes on % used: up to 50, 75 and 90.
// Every level rates the number the screen shows next to it, so the two never disagree: percents
// are shown whole, so a percent is rated rounded to a whole number and a ratio to two decimals.
const RATIO_CUTS = [0.7, 1.0, 1.4];
const SESSION_CUTS = [50, 75, 90];
const WEEK_PAUSE_AT = 95; // a week this far gone reads Pause, whatever the pace...
const WEEK_PAUSE_HOURS = 5; // ...while the reset is more than one session away (closer, a lockout is under 5 h: Moderate at most)
const asShownPct = (x) => (Number.isFinite(x) ? Math.round(x) : x);
const asShownRatio = (r) => (Number.isFinite(r) ? Math.round(r * 100) / 100 : r);
// "Over budget" follows the same number: a day shown at 100% is never called over
const isOverBudget = (ratio) => asShownRatio(ratio) > 1;
function levelByCuts(x, cuts) {
  if (x === null || x === undefined || !Number.isFinite(x)) return null;
  let i = 0;
  while (i < cuts.length && x > cuts[i]) i++;
  return i;
}
const levelFromRatio = (r) => levelByCuts(asShownRatio(r), RATIO_CUTS);
const levelFromSession = (used) => levelByCuts(asShownPct(used), SESSION_CUTS);

// The session's level, like the week's: the minutes it would leave without Claude before it resets if the pace so
// far holds. The pace is the % used over the time gone since the session started (the Used and Time bars).
// Free at 0 min, Moderate up to 30, Tight up to 90, Pause above. In its first SESSION_PACE_AFTER minutes the pace
// says too little, so the level uses % used (SESSION_CUTS), as it does with no reset time. A session
// above SESSION_PAUSE_AT % reads Pause, whatever the pace, while the reset is more than SESSION_PAUSE_MIN away.
const SESSION_LEN = 5 * HOUR;
const SESSION_LOCK_CUTS = [0, 30, 90];
const SESSION_PACE_AFTER = 30;
const SESSION_PAUSE_AT = 90; // above this, Pause (the last of SESSION_CUTS)
const SESSION_PAUSE_MIN = 30;
// When the pace reaches 100% (at, or null when not before the reset) and the whole minutes from then to the reset.
// null while there is no pace yet (no reset time, or the session is too young).
function sessionLockout(used, now, resetsAt) {
  if (!Number.isFinite(used) || !resetsAt || !(resetsAt > now)) return null;
  const gone = now - (resetsAt - SESSION_LEN);
  if (gone < SESSION_PACE_AFTER * MIN) return null;
  const rate = used / gone; // % per ms
  const at = used >= 100 ? now : rate > 0 ? now + (100 - used) / rate : null;
  if (at === null || at >= resetsAt) return { at: null, minutes: 0 };
  return { at, minutes: Math.round((resetsAt - at) / MIN) };
}
function sessionLevel(used, now, resetsAt) {
  if (!Number.isFinite(used)) return null;
  const minutesLeft = resetsAt ? (resetsAt - now) / MIN : Infinity;
  if (asShownPct(used) > SESSION_PAUSE_AT && minutesLeft > SESSION_PAUSE_MIN) return 3;
  const lock = sessionLockout(used, now, resetsAt);
  return lock ? levelByCuts(lock.minutes, SESSION_LOCK_CUTS) : levelFromSession(used);
}

// The projection's level measures how many hours you would be left without Claude before the reset if the
// pace so far holds. The projection counts up to LOCK_AT (the whole limit), at the time T it
// gets there; the hours locked out are the reset minus T. Free at 0 h (or no T at all), Moderate up to 5 h
// (one session), Tight up to 24 h, Pause above. A value exactly on a cutoff stays in the lower level.
const LOCK_AT = GOAL; // the level counts to the end of the limit, where Claude stops
const LOCK_CUTS = [0, 5, 24];
const LOCK_HOURS_SHOWN = 48; // up to 48 h the time is shown in whole hours, above that in whole days

// The hours locked out as the screen shows them: { n, unit: "h" | "d", hours } (hours is what n stands for).
function lockShown(hours) {
  if (!Number.isFinite(hours) || hours <= 0) return { n: 0, unit: "h", hours: 0 };
  const h = Math.round(hours);
  if (h <= LOCK_HOURS_SHOWN) return { n: h, unit: "h", hours: h };
  const d = Math.round(hours / 24);
  return { n: d, unit: "d", hours: d * 24 };
}
// Rated as shown: 4.6 h is shown as 5 h, so it is Moderate. null while there is no projection.
function levelFromLockout(hours) {
  if (hours === null || hours === undefined || !Number.isFinite(hours)) return null;
  return levelByCuts(lockShown(hours).hours, LOCK_CUTS);
}
// When the pace reaches LOCK_AT (at, or null) and the hours from then to the reset (0 without a T)
// The hours locked out are the active hours between the limit and the reset: a night outside them is not time
// without Claude, since it would not be used anyway. Without active hours every hour counts.
function weekLockout(used, rate, now, resetsAt, w = weights(), target = LOCK_AT, a = activeHours()) {
  const at = paceReaches(target, used, rate, now, resetsAt, w);
  return { at, hours: at === null ? 0 : activeHoursBetween(at, resetsAt, a) };
}
// Hours between two times that fall inside the active hours (all of them without active hours)
function activeHoursBetween(from, to, a = activeHours()) {
  if (!(to > from)) return 0;
  if (!a) return (to - from) / HOUR;
  return weightPieces(from, to, [1, 1, 1, 1, 1, 1, 1], a).reduce((s, p) => s + p.to - p.from, 0) / HOUR;
}
// How much the pace of the days left has to drop for the projection to end at LOCK_AT at the reset, as a
// whole percent rounded up: 1 - (LOCK_AT - used) / (projected - used). null when the pace adds nothing.
function slowDownPct(used, projected, target = LOCK_AT) {
  const ahead = projected - used;
  if (!Number.isFinite(ahead) || ahead <= 0) return null;
  const n = (1 - (target - used) / ahead) * 100;
  return Math.min(Math.max(Math.ceil(n - 1e-9), 0), 100);
}

// A week this far gone reads Pause, whatever the pace, unless the reset is WEEK_PAUSE_HOURS or less away: then
// the projection decides. The verdict and the week level both ask here. hoursLeft: hours to the reset (unknown: far).
// Rated as shown: 94.6% is shown as 95%, so it is Pause.
const weekAtPause = (used, hoursLeft = Infinity) => asShownPct(used) >= WEEK_PAUSE_AT && !(hoursLeft <= WEEK_PAUSE_HOURS);

// The week's level: the hours locked out once there is a projection, and before that (the first
// MIN_WEIGHTED_DAYS) used / expected on the ratio scale. A week at WEEK_PAUSE_AT or more is Pause either way (see weekAtPause).
// lockHours: the hours locked out (0 when the pace never reaches LOCK_AT), or null while there is no projection.
// weekRatio: used / expected, or null. hoursLeft: hours to the reset.
function weekLevel(used, lockHours, weekRatio, hoursLeft) {
  if (weekAtPause(used, hoursLeft)) return 3;
  if (lockHours !== null && lockHours !== undefined) return levelFromLockout(lockHours);
  return levelFromRatio(weekRatio);
}

// How much of the week's limit the plan expects to be used by now: the share of the plan's
// weighted days that already went by, counting the part of today that has passed.
// The plan ends at the goal (100%): the plan part (goal - reserve) follows the weights,
// and the reserve joins as it is released. g defaults to FULL_WEEK (no reserve).
function expectedUsed(resetsAt, now, w = weights(), g = FULL_WEEK) {
  const total = weightedDays(resetsAt - WEEK, resetsAt, w);
  if (total <= 0) return 0;
  const at = Math.min(now, resetsAt);
  return ((g.goal - g.reserve) * weightedDays(resetsAt - WEEK, at, w)) / total + (g.reserve - reserveHeld(at, resetsAt, g, w));
}

// The plan's own share of the day at `ms` (the rise of the expected line over that day, inside the week), with no
// carry-over: today's budget minus this is what earlier days left behind and the rolling budget moved into today.
function planDayShare(ms, resetsAt, w = weights(), g = FULL_WEEK) {
  const d = new Date(ms);
  const from = Math.max(startOfDay(ms), resetsAt - WEEK);
  const to = Math.min(new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime(), resetsAt);
  return Math.max(expectedUsed(resetsAt, to, w, g) - expectedUsed(resetsAt, from, w, g), 0);
}

// Data sources

// A reading counts when its week has a % used and a reset time that can be real
const weekIsSound = (w) => Boolean(w) && typeof w.used === "number" && Number.isFinite(w.used) && isMoment(w.resetsAt);
function manualSource() {
  const m = state.settings && state.settings.manual;
  return m && weekIsSound(m.weekly) ? { kind: "manual", data: m } : null;
}
function autoSource() {
  const a = state.data;
  return a && weekIsSound(a.weekly) ? { kind: "auto", data: a } : null;
}
// Settings > Sources: the reset form is for manual use. With the account connected, each reading brings the reset
// time, so the form only shows when the account has not given one (a reading without a reset time sends you there).
function needsAnchorForm(s) {
  if (!s || !s.claudeConnected) return true;
  return !(s.manual && s.manual.anchor && s.manual.anchorVia === "sync");
}
// The latest reading wins
function pickSource() {
  const m = manualSource();
  const a = autoSource();
  if (m && a) return a.data.updatedAt > m.data.updatedAt ? a : m;
  return a || m;
}
function lastUpdate() {
  const m = manualSource();
  const a = autoSource();
  return Math.max(m ? m.data.updatedAt : 0, a ? a.data.updatedAt : 0);
}
function sourceLabel(src) {
  if (src.kind === "auto") return t("src.claudeCode");
  return src.data.via === "sync" ? t("src.sync") : t("src.typed");
}
// History from both sources; on the same day the larger recorded spend wins
function mergedDays() {
  const out = {};
  for (const src of [autoSource(), manualSource()]) {
    if (!src || !src.data.days) continue;
    for (const [k, v] of Object.entries(src.data.days)) {
      if (!out[k] || v.spent > out[k].spent) out[k] = v;
    }
  }
  return out;
}

// Readings log (session pace and the hourly strip)
// A reading that repeats the last one exactly (same weekly %, same session %, same window) is not a
// new entry: the last one gets a "to" time instead. That keeps the log small even when something
// reads every few minutes, and it still proves that nothing was used between "at" and "to".

const READINGS_CAP = 1500;

// Each write sends the whole log, built from what the window last saw. Two writes at once (a
// Claude Code reading arriving during a Refresh) would each miss the other's entry, so they run
// one after the other, each starting from the result of the one before.
let readingsQueue = Promise.resolve();
function logReading(reading) {
  const run = readingsQueue.then(() => writeReading(reading));
  readingsQueue = run.catch(() => {});
  return run;
}

async function writeReading({ at, weekly, session, sessionResetsAt }) {
  const list = [...((state.settings && state.settings.readings) || [])];
  const last = list[list.length - 1];
  // Same reading, or one older than the last one saved (the collector's file read again at start): nothing new
  if (last && at <= (last.to || last.at)) return;
  const s = session ?? null;
  const sr = sessionResetsAt ?? null;
  const sameWindow = last && (last.sr === sr || (last.sr != null && sr != null && Math.abs(last.sr - sr) < 10 * MIN));
  if (last && at > last.at && last.w === weekly && last.s === s && sameWindow) {
    if ((last.to || last.at) >= at) return;
    list[list.length - 1] = { ...last, to: at };
  } else {
    list.push({ at, w: weekly, s, sr });
  }
  while (list.length > READINGS_CAP) list.shift();
  const sessions = upsertSession([...((state.settings && state.settings.sessions) || [])], sessionResetsAt, session);
  state.settings = await api.setSettings({ readings: list, sessions });
}

// Whether a reading from Claude shows the same whole numbers as the last one saved: the week, and the
// session when the reading has one. `manual` is the saved record (its session is manual.fiveHour).
function sameReading(manual, res) {
  if (!manual || !manual.weekly || Math.round(manual.weekly.used) !== Math.round(res.weekly.used)) return false;
  if (!res.session) return true;
  return Boolean(manual.fiveHour) && Math.round(manual.fiveHour.used) === Math.round(res.session.used);
}

// One entry per 5-hour window: its reset time (sr) and the highest usage seen in it.
// The window starts at sr - 5 h, which is the time of its first message.
function upsertSession(list, sr, used) {
  if (!sr || used === null || used === undefined) return list;
  const hit = list.find((x) => Math.abs(x.sr - sr) < 10 * MIN);
  if (hit) hit.peak = Math.max(hit.peak, used);
  else list.push({ sr, peak: used });
  list.sort((x, y) => x.sr - y.sr);
  while (list.length > 400) list.shift();
  return list;
}

// When the 5-hour sessions started inside from..to (ms), oldest first: sr - 5 h of every window in the readings.
// Windows are grouped the same way as the saved list above (resets less than 10 min apart are one window).
function sessionStartsFrom(readings, from, to) {
  let list = [];
  for (const r of readings || []) if (r && Number.isFinite(r.sr)) list = upsertSession(list, r.sr, 0);
  return list.map((x) => x.sr - 5 * HOUR).filter((ms) => ms >= from && ms <= to);
}

// When the 5-hour limit was hit inside from..to (ms): one entry per window that reached 100% (as shown), oldest first.
//   at     the first reading of the window at 100%
//   from   the last moment it was seen under 100% (the reading before, or the window's start when there is none):
//          the limit was hit somewhere between from and at
//   until  the window's reset, when Claude is back
//   exact  from and at are close enough (LOCK_EXACT_SPAN) for at to be the time it happened
// Windows are grouped as in upsertSession (resets less than 10 min apart are one window).
const LOCK_EXACT_SPAN = 20 * MIN; // the same span hourly.js calls exact
function sessionLocks(readings, from, to) {
  const windows = [];
  const pts = (readings || []).filter((r) => r && Number.isFinite(r.at) && Number.isFinite(r.sr)).sort((a, b) => a.at - b.at);
  for (const r of pts) {
    let w = windows.find((x) => Math.abs(x.sr - r.sr) < 10 * MIN);
    if (!w) windows.push((w = { sr: r.sr, list: [] }));
    w.list.push(r);
  }
  const out = [];
  for (const w of windows) {
    const i = w.list.findIndex((r) => Number.isFinite(r.s) && asShownPct(r.s) >= 100);
    if (i < 0) continue;
    const hit = w.list[i];
    const before = w.list.slice(0, i).reverse().find((r) => Number.isFinite(r.s));
    const start = w.sr - 5 * HOUR;
    const seen = before ? Math.max(before.to || before.at, start) : start;
    const lock = { at: hit.at, from: Math.min(seen, hit.at), until: w.sr };
    lock.exact = lock.at - lock.from <= LOCK_EXACT_SPAN;
    if (lock.until > from && lock.at <= to) out.push(lock);
  }
  return out.sort((a, b) => a.at - b.at);
}

// Extra usage carries on past the session's limit when there is money to spend: credits left, or a monthly limit not
// reached yet. Then 100% of the session does not stop you.
function extraCoversLimit(extra) {
  if (!extra) return false;
  if (extra.balance > 0) return true;
  return extra.limit > 0 && Number.isFinite(extra.spent) && extra.spent < extra.limit;
}

// Once: rebuild the windows from the readings that already exist
async function backfillSessions() {
  const s = state.settings;
  if (s.sessionsV1) return;
  let sessions = [...(s.sessions || [])];
  for (const r of s.readings || []) sessions = upsertSession(sessions, r.sr, r.s);
  state.settings = await api.setSettings({ sessions, sessionsV1: true });
}

// How fast the week rose lately, in % of the week per ms, from the readings of the last 3 hours.
// null when there are not enough of them or nothing rose. Used to say how long the reserve lasts.
function weekPaceRecent(now, readings = (state.settings && state.settings.readings) || []) {
  const pts = readings
    .flatMap((r) => (r.to ? [r, { ...r, at: r.to }] : [r]))
    .filter((r) => Number.isFinite(r.w) && r.at <= now && now - r.at < 3 * HOUR)
    .sort((a, b) => a.at - b.at);
  if (pts.length < 2) return null;
  const first = pts[0];
  const last = pts[pts.length - 1];
  if (last.at - first.at < 10 * MIN) return null;
  const rate = (last.w - first.w) / (last.at - first.at);
  return rate > 0 ? rate : null;
}

// What the last reading added to the week and to the session, against the reading before it, as the whole numbers
// shown. Each is { a, b, d, since }: the raw values before and now, the shown rise, and when the reading before was.
// null when it did not rise by a shown point, across a reset (the week's start, another 5-hour window), and once a
// later reading saw no change (it only moved the last entry's "to"): the stretch stays until the next reading.
function lastStep(readings, weekStart) {
  const list = readings || [];
  const b = list[list.length - 1];
  const a = list[list.length - 2];
  if (!a || !b || b.to) return { week: null, session: null };
  const since = a.to || a.at;
  const rise = (x, y) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    const d = Math.round(y) - Math.round(x);
    return d >= 1 ? { a: x, b: y, d, since } : null;
  };
  const sameWindow = Number.isFinite(a.sr) && Number.isFinite(b.sr) && Math.abs(a.sr - b.sr) < 10 * MIN;
  return {
    week: Number.isFinite(weekStart) && a.at >= weekStart ? rise(a.w, b.w) : null,
    session: sameWindow ? rise(a.s, b.s) : null,
  };
}

// Session pace: compares readings from the same 5-hour window, over its last 90 minutes.
// In its first SESSION_PACE_AFTER minutes it says nothing, like the session's level. The window opens at 0% (its first
// message starts it), so its start is a point too: while it is inside those 90 minutes, the pace counts from there and a
// busy start or a missed first reading cannot make a short burst look like the whole session.
function sessionPace(five, now) {
  if (!five || !five.resetsAt) return null;
  const start = five.resetsAt - SESSION_LEN;
  if (now - start < SESSION_PACE_AFTER * MIN) return { known: false };
  // A repeated reading (with a "to" time) counts as two points: when it started and when it ended
  const pts = ((state.settings && state.settings.readings) || [])
    .flatMap((r) => (r.to ? [r, { ...r, at: r.to }] : [r]))
    .filter((r) => r.s !== null && r.sr && Math.abs(r.sr - five.resetsAt) < 10 * MIN && now - r.at < 2 * HOUR)
    .sort((a, b) => a.at - b.at);
  if (!pts.length || pts[0].at > start) pts.unshift({ at: start, s: 0 });
  if (pts.length < 2) return { known: false };
  const latest = pts[pts.length - 1];
  const first = pts.find((p) => latest.at - p.at <= 90 * MIN) || pts[0];
  const dt = latest.at - first.at;
  if (dt < 5 * MIN) return { known: false };
  const rate = Math.max(latest.s - first.s, 0) / dt; // % per ms
  if (rate <= 0) return { known: true, rate: 0, per30: 0, fullAt: null };
  const fullAt = latest.at + (100 - latest.s) / rate;
  return { known: true, rate, per30: rate * 30 * MIN, fullAt: fullAt < five.resetsAt ? fullAt : null };
}

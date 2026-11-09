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

// The weekly reset is fixed: from a known reset, find the next one after now
function nextReset(anchor, now = Date.now()) {
  if (!anchor) return null;
  let r = anchor;
  if (r <= now) r += Math.ceil((now - r) / WEEK) * WEEK;
  if (r <= now) r += WEEK;
  while (r - WEEK > now) r -= WEEK;
  return r;
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
// Sum of the weights between two instants, counting the fraction of each day
function weightedDays(from, to, w = weights()) {
  let total = 0;
  let cur = from;
  while (cur < to) {
    const d = new Date(cur);
    const next = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
    const end = Math.min(next, to);
    total += ((end - cur) / DAY) * w[d.getDay()];
    cur = end;
  }
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
// Today's budget: today's share of what is left, counting the week from the start of the day
function dayBudget(remaining, resetsAt, now, w = weights()) {
  const share = dayShare(now, resetsAt, w);
  if (share <= 0) return 0;
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
// How much of the reserve is still held back at `ms`: all of it until the release starts, then less and
// less (in a straight line) until the reset, when none is held. Without a release it is held to the end.
function reserveHeld(ms, resetsAt, g) {
  if (!g.reserve) return 0;
  if (!g.release) return g.reserve;
  return g.reserve * Math.min(Math.max((resetsAt - ms) / (g.release * HOUR), 0), 1);
}
// The plan's ceiling at `ms`: the goal minus the reserve still held. Use above it comes from the reserve.
const planCeiling = (ms, resetsAt, g) => g.goal - reserveHeld(ms, resetsAt, g);
// What is left of the reserve after `used`% of the week: use above goal - reserve was taken from it
const reserveLeft = (used, g) => Math.min(Math.max(g.goal - Math.max(used, g.goal - g.reserve), 0), g.reserve);
// The part of the reserve left (`left`) that the release hands to the plan between a and b, counted from
// `from` (the start of today): it spreads over the release still to come, in proportion to time.
function reserveReleased(left, a, b, from, resetsAt, g) {
  const held = reserveHeld(from, resetsAt, g);
  if (!(left > 0) || held <= 0) return 0;
  return (left * Math.max(reserveHeld(a, resetsAt, g) - reserveHeld(b, resetsAt, g), 0)) / held;
}
// Today's budget with the goal and the reserve: today's share of the plan (goal - reserve) left at the
// start of the day, plus the part of the reserve that today's release hands over. An Off day stays at 0.
// With FULL_WEEK it is dayBudget(100 - usedStart).
function planBudget(usedStart, resetsAt, now, g, w = weights()) {
  const plan = dayBudget(g.goal - g.reserve - usedStart, resetsAt, now, w);
  if (dayShare(now, resetsAt, w) <= 0) return plan;
  const from = Math.max(startOfDay(now), resetsAt - WEEK);
  const d = new Date(now);
  const to = Math.min(new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime(), resetsAt);
  return plan + reserveReleased(reserveLeft(usedStart, g), from, to, from, resetsAt, g);
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

// When the pace so far reaches `target`% of the week: walk forward day by day, since the weights change the
// slope at every midnight. The same walk draws the dashed projection on the chart. null when it does not get
// there before the reset; now when it is already there.
function paceReaches(target, used, rate, now, resetsAt, w = weights()) {
  if (used >= target) return now;
  if (!(rate > 0)) return null;
  let need = (target - used) / rate; // weighted days
  let cur = now;
  while (cur < resetsAt) {
    const d = new Date(cur);
    const next = Math.min(new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime(), resetsAt);
    const weight = w[d.getDay()];
    const avail = ((next - cur) / DAY) * weight;
    if (weight > 0 && avail >= need) return cur + (need / weight) * DAY;
    need -= avail;
    cur = next;
  }
  return null;
}

// Levels

// 0 Free, 1 Moderate, 2 Tight, 3 Pause. null means "not rated yet".
// Today and the days come from a ratio (used / budget): up to 0.7, 1.0 and 1.4.
// The projection has its own scale (hours locked out, LOCK_CUTS below), and the week follows it (weekLevel).
// The 5-hour session is rated on its own % used, not on pace: up to 50, 75 and 90.
// Every level rates the number the screen shows next to it, so the two never disagree: percents
// are shown whole, so a percent is rated rounded to a whole number and a ratio to two decimals.
const RATIO_CUTS = [0.7, 1.0, 1.4];
const SESSION_CUTS = [50, 75, 90];
const WEEK_PAUSE_AT = 95; // a week this far gone reads Pause, whatever the pace
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
function weekLockout(used, rate, now, resetsAt, w = weights(), target = LOCK_AT) {
  const at = paceReaches(target, used, rate, now, resetsAt, w);
  return { at, hours: at === null ? 0 : Math.max(resetsAt - at, 0) / HOUR };
}
// How much the pace of the days left has to drop for the projection to end at LOCK_AT at the reset, as a
// whole percent rounded up: 1 - (LOCK_AT - used) / (projected - used). null when the pace adds nothing.
function slowDownPct(used, projected, target = LOCK_AT) {
  const ahead = projected - used;
  if (!Number.isFinite(ahead) || ahead <= 0) return null;
  const n = (1 - (target - used) / ahead) * 100;
  return Math.min(Math.max(Math.ceil(n - 1e-9), 0), 100);
}

// A week this far gone reads Pause, whatever the pace. The verdict and the week level both ask here.
// Rated as shown: 94.6% is shown as 95%, so it is Pause.
const weekAtPause = (used) => asShownPct(used) >= WEEK_PAUSE_AT;

// The week's level: the hours locked out once there is a projection, and before that (the first
// MIN_WEIGHTED_DAYS) used / expected on the ratio scale. A week at WEEK_PAUSE_AT or more is Pause either way.
// lockHours: the hours locked out (0 when the pace never reaches LOCK_AT), or null while there is no projection.
// weekRatio: used / expected, or null.
function weekLevel(used, lockHours, weekRatio) {
  if (weekAtPause(used)) return 3;
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
  return ((g.goal - g.reserve) * weightedDays(resetsAt - WEEK, at, w)) / total + (g.reserve - reserveHeld(at, resetsAt, g));
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

function manualSource() {
  const m = state.settings && state.settings.manual;
  return m && m.weekly ? { kind: "manual", data: m } : null;
}
function autoSource() {
  const a = state.data;
  return a && a.weekly && a.weekly.resetsAt ? { kind: "auto", data: a } : null;
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
  if (last && last.at === at) return; // same reading
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

// Session pace: compares readings from the same 5-hour window
function sessionPace(five, now) {
  if (!five || !five.resetsAt) return null;
  // A repeated reading (with a "to" time) counts as two points: when it started and when it ended
  const pts = ((state.settings && state.settings.readings) || [])
    .flatMap((r) => (r.to ? [r, { ...r, at: r.to }] : [r]))
    .filter((r) => r.s !== null && r.sr && Math.abs(r.sr - five.resetsAt) < 10 * MIN && now - r.at < 2 * HOUR)
    .sort((a, b) => a.at - b.at);
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

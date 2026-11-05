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
// Today's budget: today's share of what is left, counting the week from the start of the day
function dayBudget(remaining, resetsAt, now, w = weights()) {
  const share = dayShare(now, resetsAt, w);
  if (share <= 0) return 0;
  const from = Math.max(startOfDay(now), resetsAt - WEEK);
  return (Math.max(remaining, 0) * share) / Math.max(weightedDays(from, resetsAt, w), share);
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
  let eta = null;
  if (projected > 100) {
    // Walk forward until the weighted days used up the remaining percent
    let need = (100 - used) / rate;
    let cur = now;
    while (cur < resetsAt && need > 0) {
      const d = new Date(cur);
      const next = Math.min(new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime(), resetsAt);
      const weight = w[d.getDay()];
      const avail = ((next - cur) / DAY) * weight;
      if (weight > 0 && avail >= need) {
        eta = cur + (need / weight) * DAY;
        break;
      }
      need -= avail;
      cur = next;
    }
  }
  return { rate, projected, eta };
}

// Levels

// 0 Free, 1 Moderate, 2 Tight, 3 Pause. null means "not rated yet".
// Today and the days come from a ratio (used / budget): up to 0.7, 1.0 and 1.4.
// The projection has its own scale (PROJECTION_CUTS, below), and the week follows it (weekLevel).
// The 5-hour session is rated on its own % used, not on pace: up to 50, 75 and 90.
// Every level rates the number the screen shows next to it, so the two never disagree: percents
// are shown whole, so a percent is rated rounded to a whole number and a ratio to two decimals
// (79.6% projected is shown as 80% and rated as 80%).
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

// The projection (where the week ends at the pace so far, as a share of the limit: projected / 100)
// has a scale of its own. The other scales only measure the risk of running out; this one also counts
// what would go unused. More than 20% left at the reset is quota that goes to waste, so it reads Free;
// 20% or less left means ease up (Moderate). From there: Tight above 1.00, Pause above 1.40.
// The first cutoff breaks the usual rule of levelByCuts on purpose: exactly 0.80 (20% left) is
// already Moderate, not Free. Why: Free is the band where quota would go to waste, and the decision
// was that 20% or less left at the reset already asks to ease up, so the edge belongs to Moderate.
// The other two cutoffs keep the usual rule (1.00 is Moderate, 1.40 is Tight).
const PROJECTION_CUTS = [0.8, 1.0, 1.4];
// r is rated as shown: the projection is shown as a whole percent, so r to two decimals.
function levelFromProjection(r) {
  if (r === null || r === undefined || !Number.isFinite(r)) return null;
  r = asShownRatio(r);
  if (r < PROJECTION_CUTS[0]) return 0;
  return Math.max(1, levelByCuts(r, PROJECTION_CUTS));
}

// A week this far gone reads Pause, whatever the pace. The verdict and the week level both ask here.
// Rated as shown: 94.6% is shown as 95%, so it is Pause.
const weekAtPause = (used) => asShownPct(used) >= WEEK_PAUSE_AT;

// The week's level: the projection's level once there is a projection, and before that (the first
// MIN_WEIGHTED_DAYS) used / expected on the ratio scale. A week at WEEK_PAUSE_AT or more is Pause either way.
// projRatio: projected / 100, or null while there is no projection. weekRatio: used / expected, or null.
function weekLevel(used, projRatio, weekRatio) {
  if (weekAtPause(used)) return 3;
  if (projRatio !== null && projRatio !== undefined) return levelFromProjection(projRatio);
  return levelFromRatio(weekRatio);
}

// How much of the week's limit the plan expects to be used by now: the share of the plan's
// weighted days that already went by, counting the part of today that has passed.
function expectedUsed(resetsAt, now, w = weights()) {
  const total = weightedDays(resetsAt - WEEK, resetsAt, w);
  if (total <= 0) return 0;
  return (100 * weightedDays(resetsAt - WEEK, Math.min(now, resetsAt), w)) / total;
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

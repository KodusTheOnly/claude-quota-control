// Learning from the past weeks: how this person usually spends a week, used for the projection only.
// The plan (the day weights, today's budget) stays what the person chose; the collector mirrors that part, not this one.
// With no past week on record everything here falls back to the plain pace of this week, as before.
//
//   learnWeeks       the past weeks worth learning from, with how much each weekday used
//   forecastWeights  how heavy each day of the week really is (the plan's weights, pulled toward what the weeks showed)
//   learnedProjection where the week ends: the pace of this week mixed with the usual pace, and a likely range
//   suggestWeights   the plan the past weeks point to (Off, Light, Normal, Heavy per weekday), for the plan menu

const LEARN_WEEKS = 8; // how far back the app looks
const LEARN_MIN_DAYS = 3; // a past week counts when at least this many of its days have a reading
const SUGGEST_MIN_WEEKS = 3; // weeks on record before a plan is suggested
const PRIOR_FULL_WEEKS = 4; // past weeks stop adding to how well the pace is known after this many
const BAND_Z = 1.28; // the range holds about 8 weeks in 10
const BAND_CV = 0.5; // how much a day's use strays from the pace, before the app knows the person
const BAND_PRIOR_WEEKS = 3; // the range trusts that guess as if it were this many weeks
const BAND_Q_MIN = 0.4; // regular weeks narrow the range down to this share of the guess...
const BAND_Q_MAX = 2; // ...and irregular ones widen it up to this
const OFF_SEEN = 0.25; // a weekday used in at most a quarter of the weeks...
const OFF_SHARE = 0.25; // ...and under a quarter of a normal day is suggested as Off
const LIGHT_UNDER = 0.7; // under this share of a normal day: Light
const HEAVY_OVER = 1.4; // over it: Heavy

// The past weeks (pastWeeks in compute.js) with enough readings, newest first:
// [{ start, end, full, pts, byDow }], byDow being the points of the week each weekday used.
// A day with no reading has no point: what it used shows up on the next day that has one, as in the history.
// A week where Claude gave part of it back is learned from what it really used (its gross line), not from where
// its % ended: end and pts are that line, and full says the week reached 100% at some point.
function learnWeeks(days, resetsAt) {
  const out = [];
  for (const wk of pastWeeks(days, resetsAt, LEARN_WEEKS)) {
    if (wk.pts.length - 1 < LEARN_MIN_DAYS) continue;
    const d0 = new Date(startOfDay(wk.start));
    const byDow = [0, 0, 0, 0, 0, 0, 0];
    let prev = 0;
    for (const p of wk.gpts.slice(1)) {
      const dow = new Date(d0.getFullYear(), d0.getMonth(), d0.getDate() + Math.round(p.x) - 1).getDay();
      byDow[dow] += p.y - prev;
      prev = p.y;
    }
    out.push({ start: wk.start, end: wk.gross, full: wk.fullDay !== null, pts: wk.gpts, byDow });
  }
  return out;
}

// What the weeks have in common: { n, weeks, avg (points per weekday), seen (share of the weeks with use on that
// weekday), total (sum of avg), meanEnd (where a week usually ends) }, or null with no week to learn from
function learnProfile(days, resetsAt) {
  const weeks = learnWeeks(days, resetsAt);
  const n = weeks.length;
  if (!n) return null;
  const avg = [0, 0, 0, 0, 0, 0, 0].map((_, d) => weeks.reduce((s, w) => s + w.byDow[d], 0) / n);
  const seen = [0, 0, 0, 0, 0, 0, 0].map((_, d) => weeks.filter((w) => w.byDow[d] >= 0.5).length / n);
  return { n, weeks, avg, seen, total: avg.reduce((s, x) => s + x, 0), meanEnd: weeks.reduce((s, w) => s + w.end, 0) / n };
}

// How heavy each day of this week is for the projection: the plan's weights with no past week (returned as they
// are), otherwise a function (ms -> weight of that calendar day) for weightPieces. The week touches eight calendar
// days: the reset day's hours after the reset, six whole days, and the hours before the next reset. Each gets a
// share of a week of 7: what the past weeks used on it (nothing was ever recorded for the eighth, whose weekday is
// the first day's), with the plan counted as one more week so the first weeks do not swing it. A day the plan
// turns Off stays at 0: that is a decision about this week, and the past cannot know it.
// The function carries its eight weights as .slots (each already divided by the part of the day inside the week).
function forecastWeights(w, L, resetsAt, a = activeHours()) {
  if (!L || !(L.total > 0)) return w;
  const first = startOfDay(resetsAt - WEEK);
  const d0 = new Date(first);
  const dayAt = (i) => new Date(d0.getFullYear(), d0.getMonth(), d0.getDate() + i).getTime();
  const sum = w.reduce((s, x) => s + x, 0);
  const slots = [];
  for (let i = 0; i <= 7; i++) {
    const from = Math.max(dayAt(i), resetsAt - WEEK);
    const to = Math.min(dayAt(i + 1), resetsAt);
    const dow = new Date(dayAt(i)).getDay();
    // The part of this calendar day that is inside the week (of its active hours, when set)
    const part = to > from ? weightedDays(from, to, [1, 1, 1, 1, 1, 1, 1], a) : 0;
    const learned = i < 7 ? (L.avg[dow] * 7) / L.total : 0;
    const share = w[dow] === 0 || !(sum > 0) ? 0 : (L.n * learned + ((w[dow] * 7) / sum) * part) / (L.n + 1);
    slots.push(part > 0 ? share / part : 0);
  }
  const f = (ms) => slots[Math.round((startOfDay(ms) - first) / DAY)] ?? 0;
  f.slots = slots;
  return f;
}

// How many days of this week the usual pace is worth: MIN_WEIGHTED_DAYS (the days a week with no past needs before
// it projects at all), or none with no past week. So after a day and a half the two paces weigh the same.
const priorDays = (n) => (n ? MIN_WEIGHTED_DAYS : 0);

// The pace (% per day) from `used` after `elapsed` days, with the usual pace counted as k0 more days
const mixedRate = (used, elapsed, usual, k0) => (used + k0 * (usual || 0)) / (elapsed + k0);

// How far the week's end can stray from the projection (one standard deviation, in points of the week): the days
// left each vary around the pace, and the pace itself is only known as well as the days it was measured over
// (this week's, plus the past weeks).
function forecastSpread(rate, elapsed, left, n) {
  const evidence = elapsed + 2 + 3 * Math.min(n, PRIOR_FULL_WEEKS);
  return rate * BAND_CV * Math.sqrt(left + (left * left) / evidence);
}

// How wide the range should be for this person, against the guess above: each past week is projected from this same
// point of the week (using only the other weeks as its past) and compared with how it really ended. 1 is the guess;
// under 1 the weeks were more regular than that. A week that hit 100% under a projection above it says nothing.
function forecastCalibration(L, x, elapsed, left) {
  if (!L) return 1;
  let sum = BAND_PRIOR_WEEKS;
  let count = BAND_PRIOR_WEEKS;
  for (const wk of L.weeks) {
    const others = L.n - 1;
    const k0 = priorDays(others);
    if (elapsed + k0 < 0.5) continue;
    const usual = others ? (L.meanEnd * L.n - wk.end) / others / 7 : 0;
    const at = Math.min(pastWeekAt(wk, x), wk.end);
    const rate = mixedRate(at, elapsed, usual, k0);
    const pred = at + rate * left;
    if (wk.full && pred >= 100) continue;
    const sd = Math.max(forecastSpread(rate, elapsed, left, others), 0.5);
    sum += ((wk.end - pred) / sd) ** 2;
    count += 1;
  }
  return Math.min(Math.max(Math.sqrt(sum / count), BAND_Q_MIN), BAND_Q_MAX);
}

// Where the week ends. With no past week it is the pace of this week carried on (and nothing in the first
// MIN_WEIGHTED_DAYS, as before). With past weeks it answers from the first minute: the usual pace stands in for the
// days this week has not shown yet, and gives way as the week goes on.
//   rate      % per day of forecast weight (w), the pace the projection walks at
//   own       this week's pace alone (null in its first hour or so), usual: the past weeks' (null without them)
//   projected the most likely end; low and high: the range around it (low never under what is already used)
//   weeks     how many past weeks it learned from
// given: what Claude gave back this week (weekDrops in compute.js). It was used, so the pace counts it, but it is
// no longer on the week: the end walks on from what is used now.
function learnedProjection(used, resetsAt, now, planW = weights(), L = null, given = 0) {
  const w = forecastWeights(planW, L, resetsAt);
  const n = L ? L.n : 0;
  const elapsed = weightedDays(resetsAt - WEEK, now, w);
  if (!n && elapsed < MIN_WEIGHTED_DAYS) return null;
  const left = weightedDays(now, resetsAt, w);
  const usual = n ? L.meanEnd / 7 : null;
  const gross = used + Math.max(given || 0, 0);
  const rate = mixedRate(gross, elapsed, usual, priorDays(n));
  const projected = used + rate * left;
  const first = startOfDay(resetsAt - WEEK);
  const x = Math.round((startOfDay(now) - first) / DAY) + (now - startOfDay(now)) / DAY;
  const spread = BAND_Z * forecastCalibration(L, x, elapsed, left) * forecastSpread(rate, elapsed, left, n);
  return {
    elapsed, left, rate, projected, w, weeks: n, usual,
    own: elapsed > 0.05 ? gross / elapsed : null,
    low: Math.max(projected - spread, used),
    high: projected + spread,
  };
}

// The range as the screen writes it: whole percents, never above 100. One number when both ends round to the same.
function rangeShown(p) {
  const low = Math.min(asShownPct(p.low), 100);
  const high = Math.min(asShownPct(p.high), 100);
  return { low, high, text: low === high ? `${low}%` : `${low}–${high}%` };
}

// The plan the past weeks point to, one weight per weekday (0 = Sunday), or null before SUGGEST_MIN_WEEKS weeks.
// Each weekday is compared with a normal one (the middle weekday among those the person uses).
function suggestWeights(L) {
  if (!L || L.n < SUGGEST_MIN_WEEKS || !(L.total > 0)) return null;
  const inUse = L.avg.filter((_, d) => L.seen[d] > OFF_SEEN).sort((a, b) => a - b);
  if (!inUse.length) return null;
  const mid = Math.floor(inUse.length / 2);
  const normal = inUse.length % 2 ? inUse[mid] : (inUse[mid - 1] + inUse[mid]) / 2;
  if (!(normal > 0)) return null;
  return L.avg.map((x, d) => {
    const r = x / normal;
    if (L.seen[d] <= OFF_SEEN && r < OFF_SHARE) return 0;
    return r < LIGHT_UNDER ? 0.5 : r > HEAVY_OVER ? 2 : 1;
  });
}

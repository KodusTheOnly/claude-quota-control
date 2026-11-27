// Hourly strip: which hours of the week the usage happened in.
// Claude only says how much was used at the moment it is read, so every increase between two
// readings has to be placed in time. Pure function (no DOM), tested in test/hourly.test.js.
//
// Where an increase goes, in order of how much is known:
//   1) the readings were close together (EXACT_SPAN): it happened right there
//   2) Claude Code wrote answers in those hours: split in proportion to that activity
//   3) the 5-hour sessions the two readings saw: full weight on the part of them inside the gap. When the gap between
//      those sessions is long enough to hold a whole other session nobody saw (5 hours or more), the active hours in
//      it get half weight too: use may have happened there
//   4) nothing narrows it down and the gap is long: left out, it is not drawn at all
// Anything from 2 to 3 is an estimate and is drawn as one. A gap with no increase is still useful:
// it proves nothing was used there, so those hours count as covered. The hours of a gap with an increase that got
// none of it are blind: something was used in the gap and nothing says it was not there.

const HOURLY_EXACT_SPAN = 20 * 60 * 1000;
const HOURLY_MAX_BLIND_SPAN = 6 * 3600000;
const HOURLY_SESSION_MS = 5 * 3600000;
const HOURLY_UNSEEN_WEIGHT = 0.5; // an active hour where a session nobody saw may have run, next to one that was seen

function hourlyHourStart(ms) {
  const d = new Date(ms);
  d.setMinutes(0, 0, 0);
  return d.getTime();
}

// readings: the log from core.js ({ at, w, s, sr, to }). activity: Map or [[hourStart, weight]].
// weekStart: when the current week began. now: the current time.
// active(from, to): how many ms of from..to fall inside the active hours (all of them when left out).
// Returns { cells: Map(hourStart -> { v, exact, covered, blind }), maxV, left }.
//   v: % of the weekly limit placed in that hour. exact: every part of it came from close readings.
//   covered: some reading brackets the hour. blind: in a gap with an increase, and none of it placed here.
//   left: % that could not be placed.
function hourlyUsage({ readings, activity, weekStart, now, active = (from, to) => to - from }) {
  const act = activity instanceof Map ? activity : new Map(activity || []);
  const pts = [{ at: weekStart, w: 0, sr: null }];
  for (const r of readings || []) {
    if (!r || !Number.isFinite(r.at) || !Number.isFinite(r.w) || r.at < weekStart || r.at > now) continue;
    pts.push({ at: r.at, w: r.w, sr: r.sr ?? null });
    if (Number.isFinite(r.to) && r.to > r.at && r.to <= now) pts.push({ at: r.to, w: r.w, sr: r.sr ?? null });
  }
  pts.sort((a, b) => a.at - b.at);

  const cells = new Map();
  let left = 0;
  const cell = (h) => {
    let c = cells.get(h);
    if (!c) cells.set(h, (c = { v: 0, exact: true, covered: false, blind: false }));
    return c;
  };

  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const span = b.at - a.at;
    if (span <= 0) continue;
    const delta = Math.max(b.w - a.w, 0);

    const segs = [];
    for (let h = hourlyHourStart(a.at); h < b.at; h += 3600000) {
      const from = Math.max(a.at, h);
      const to = Math.min(b.at, h + 3600000);
      if (to > from) segs.push({ h, from, to });
    }
    // Hours a reading brackets are covered, even when nothing was used in them
    if (i > 1 || a.at !== weekStart) for (const s of segs) cell(s.h).covered = true;
    if (delta <= 0) continue;

    const exact = span <= HOURLY_EXACT_SPAN;
    let weights = segs.map((s) => (act.get(s.h) || 0) * ((s.to - s.from) / 3600000));
    let total = weights.reduce((x, y) => x + y, 0);
    let estimated = !exact;
    if (total <= 0) {
      const windows = [a.sr, b.sr].filter((x) => Number.isFinite(x)).map((sr) => [sr - HOURLY_SESSION_MS, sr]);
      const overlap = (s, w0, w1) => Math.max(Math.min(s.to, w1) - Math.max(s.from, w0), 0);
      // Between the end of what the first reading saw and the start of what the second saw. Only a span of a whole
      // session or more can hold one nobody saw (a session runs 5 hours from its first message).
      const seenTo = Number.isFinite(a.sr) ? Math.max(a.sr, a.at) : a.at;
      const seenFrom = Number.isFinite(b.sr) ? Math.min(b.sr - HOURLY_SESSION_MS, b.at) : b.at;
      const unseen = seenFrom - seenTo >= HOURLY_SESSION_MS ? [seenTo, seenFrom] : null;
      weights = segs.map((s) => {
        const seen = windows.reduce((sum, [w0, w1]) => sum + overlap(s, w0, w1), 0);
        if (!unseen) return seen;
        const u0 = Math.max(s.from, unseen[0]);
        const u1 = Math.min(s.to, unseen[1]);
        return seen + (u1 > u0 ? HOURLY_UNSEEN_WEIGHT * active(u0, u1) : 0);
      });
      total = weights.reduce((x, y) => x + y, 0);
      if (total <= 0) {
        if (span > HOURLY_MAX_BLIND_SPAN) {
          left += delta;
          for (const s of segs) cell(s.h).blind = true;
          continue;
        }
        weights = segs.map((s) => s.to - s.from);
        total = weights.reduce((x, y) => x + y, 0);
      }
    }
    segs.forEach((s, k) => {
      const c = cell(s.h);
      if (weights[k] <= 0) {
        if (!exact) c.blind = true;
        return;
      }
      c.v += (delta * weights[k]) / total;
      c.covered = true;
      if (estimated) c.exact = false;
    });
  }

  let maxV = 0;
  for (const c of cells.values()) maxV = Math.max(maxV, c.v);
  return { cells, maxV, left };
}

// The stretches with no reading in which the week went up: between two readings (the first one's last time, "to") at
// least minSpan apart, with a rise of half a point or more. Only real readings: the week's start is not one.
// Returns [{ from, to, w0, w1 }], oldest first.
const HOURLY_GAP_MIN = 3600000;
function readingGaps({ readings, weekStart, now, minSpan = HOURLY_GAP_MIN }) {
  const pts = (readings || [])
    .filter((r) => r && Number.isFinite(r.at) && Number.isFinite(r.w) && r.at >= weekStart && r.at <= now)
    .sort((a, b) => a.at - b.at);
  const out = [];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const from = Number.isFinite(a.to) && a.to > a.at && a.to <= b.at ? a.to : a.at;
    if (b.at - from >= minSpan && b.w - a.w >= 0.5) out.push({ from, to: b.at, w0: a.w, w1: b.w });
  }
  return out;
}

// ---- The used line in steps ----

// One stretch of the chart's "used" line (a day, or the part of today that is gone), drawn by the hours.
// The rise from y0 to y1 is spread over the hours of from..to in proportion to the cells' v (cells: the Map from
// hourlyUsage). An hour with v = 0 stays flat. The line starts at y0 and ends exactly at y1.
// Returns [{ ms, y, est }] (est: the piece that ends at this point comes from a cell that is not exact), or null when
// the hours cannot say where the rise happened (no rise, or no hour with use): the caller then draws a straight piece.
function hourlySteps({ cells, from, to, y0, y1 }) {
  const delta = y1 - y0;
  if (!cells || !(delta > 0) || !(to > from)) return null;
  const hours = [];
  let total = 0;
  for (let h = hourlyHourStart(from); h < to; h += 3600000) {
    const c = cells.get(h);
    if (c && c.v > 0) {
      hours.push({ a: Math.max(h, from), b: Math.min(h + 3600000, to), v: c.v, est: !c.exact });
      total += c.v;
    }
  }
  if (total <= 0) return null;
  const pts = [];
  const push = (ms, y, est) => {
    const last = pts[pts.length - 1];
    if (!last || last.ms !== ms || last.y !== y) pts.push({ ms, y, est });
  };
  push(from, y0, false);
  let y = y0;
  hours.forEach((hr, k) => {
    push(hr.a, y, false); // flat until this hour
    y = k === hours.length - 1 ? y1 : y + (delta * hr.v) / total;
    push(hr.b, y, hr.est);
  });
  push(to, y1, false);
  return pts;
}

// The part of a polyline [{ x, y }] (y never goes down) that is above a level, starting where it crosses it.
function lineAbove(pts, level) {
  const out = [];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    if (b.y <= level) continue;
    if (!out.length) out.push(a.y < level ? { x: a.x + ((level - a.y) / (b.y - a.y)) * (b.x - a.x), y: level } : { x: a.x, y: a.y });
    out.push({ x: b.x, y: b.y });
  }
  return out.length > 1 ? out : null;
}

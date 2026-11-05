// Hourly strip: which hours of the week the usage happened in.
// Claude only says how much was used at the moment it is read, so every increase between two
// readings has to be placed in time. Pure function (no DOM), tested in test/hourly.test.js.
//
// Where an increase goes, in order of how much is known:
//   1) the readings were close together (EXACT_SPAN): it happened right there
//   2) Claude Code wrote answers in those hours: split in proportion to that activity
//   3) a 5-hour session was running: split evenly over the part of the session inside the gap
//   4) nothing narrows it down and the gap is long: left out, it is not drawn at all
// Anything from 2 to 3 is an estimate and is drawn as one. A gap with no increase is still useful:
// it proves nothing was used there, so those hours count as covered.

const HOURLY_EXACT_SPAN = 20 * 60 * 1000;
const HOURLY_MAX_BLIND_SPAN = 6 * 3600000;
const HOURLY_SESSION_MS = 5 * 3600000;

function hourlyHourStart(ms) {
  const d = new Date(ms);
  d.setMinutes(0, 0, 0);
  return d.getTime();
}

// readings: the log from core.js ({ at, w, s, sr, to }). activity: Map or [[hourStart, weight]].
// weekStart: when the current week began. now: the current time.
// Returns { cells: Map(hourStart -> { v, exact, covered }), maxV, left }.
//   v: % of the weekly limit placed in that hour. exact: every part of it came from close readings.
//   covered: some reading brackets the hour. left: % that could not be placed.
function hourlyUsage({ readings, activity, weekStart, now }) {
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
    if (!c) cells.set(h, (c = { v: 0, exact: true, covered: false }));
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
      weights = segs.map((s) => windows.reduce((sum, [w0, w1]) => sum + Math.max(Math.min(s.to, w1) - Math.max(s.from, w0), 0), 0));
      total = weights.reduce((x, y) => x + y, 0);
      if (total <= 0) {
        if (span > HOURLY_MAX_BLIND_SPAN) {
          left += delta;
          continue;
        }
        weights = segs.map((s) => s.to - s.from);
        total = weights.reduce((x, y) => x + y, 0);
      }
    }
    segs.forEach((s, k) => {
      if (weights[k] <= 0) return;
      const c = cell(s.h);
      c.v += (delta * weights[k]) / total;
      c.covered = true;
      if (estimated) c.exact = false;
    });
  }

  let maxV = 0;
  for (const c of cells.values()) maxV = Math.max(maxV, c.v);
  return { cells, maxV, left };
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

// HRS strip above the days: when in the week the usage happened.
// One cell per hour (per 3 hours when the window is narrow). Solid = placed from close readings,
// dim = an estimate, empty = nothing used or not known. hourly.js does the placing; this file only draws.

let hoursCache = { activity: [], fetchedAt: 0, weekStart: 0 };
let hoursM = null;
let hoursMemo = null; // { m, activity, res } of the last hourlyUsage call
const NO_ACTIVITY = [];
const HOURS_REFRESH_MS = 60 * 1000;

function hourBlockStart(ms, step) {
  const d = new Date(ms);
  d.setMinutes(0, 0, 0);
  while (step > 1 && d.getHours() % step !== 0) d.setHours(d.getHours() - 1);
  return d.getTime();
}

// The placed usage of the week, computed once per render and shared by the strip and the chart's used line
function hoursUsageFor(m) {
  const activity = state.settings.codeLogs === false ? NO_ACTIVITY : hoursCache.activity;
  if (hoursMemo && hoursMemo.m === m && hoursMemo.activity === activity) return hoursMemo.res;
  const res = hourlyUsage({ readings: state.settings.readings || [], activity, weekStart: m.w.resetsAt - WEEK, now: m.now });
  hoursMemo = { m, activity, res };
  return res;
}

function renderHours(m) {
  hoursM = m;
  drawHours();
  const weekStart = m.w.resetsAt - WEEK;
  const stale = Date.now() - hoursCache.fetchedAt > HOURS_REFRESH_MS || hoursCache.weekStart !== weekStart;
  if (!stale || state.settings.codeLogs === false || !api.activityHours) return;
  hoursCache = { ...hoursCache, fetchedAt: Date.now(), weekStart }; // set first, so a slow read is not asked twice
  api.activityHours(weekStart).then((res) => {
    hoursCache = { activity: (res && res.hours) || [], fetchedAt: Date.now(), weekStart };
    drawHours();
    renderPaceChart(hoursM); // the chart's used line follows the same hours
  }).catch(() => {});
}

function drawHours() {
  const m = hoursM;
  const box = $("hcells");
  if (!m || !box.clientWidth) return;
  const weekStart = m.w.resetsAt - WEEK;
  const { cells, left } = hoursUsageFor(m);
  // Same axis as the chart and the day columns: the seven calendar days, from the midnight that starts the first day,
  // then the week's last hours up to the reset.
  const axisStart = startOfDay(weekStart);
  const axisEnd = Math.max(m.w.resetsAt, axisStart + 7 * DAY);
  const axisLen = axisEnd - axisStart;
  const step = box.clientWidth / (axisLen / HOUR) >= 4 ? 1 : 3;

  const blocks = [];
  for (let t0 = hourBlockStart(weekStart, step); t0 < axisEnd; ) {
    let v = 0;
    let exact = true;
    let covered = false;
    for (let k = 0; k < step; k++) {
      const c = cells.get(t0 + k * HOUR);
      if (!c) continue;
      v += c.v;
      covered = covered || c.covered;
      if (c.v > 0 && !c.exact) exact = false;
    }
    blocks.push({ t0, v, exact, covered });
    const d = new Date(t0);
    d.setHours(d.getHours() + step);
    t0 = d.getTime();
  }
  const max = Math.max(...blocks.map((b) => b.v), 0.0001);
  // Each hour takes the color of its day's level, as the day's card under it (Free when the day is not rated)
  const dayLevel = new Map((m.week || []).map((d) => [dayKey(d.ms), d.level]));
  const nowBlock = hourBlockStart(m.now, step);

  box.replaceChildren(
    ...blocks.map((b) => {
      const c = node("i", "hc");
      const from = Math.max(b.t0, weekStart);
      const to = Math.min(b.t0 + step * HOUR, axisEnd);
      c.style.left = `${(((from - axisStart) / axisLen) * 100).toFixed(3)}%`;
      c.style.width = `${(((to - from) / axisLen) * 100).toFixed(3)}%`;
      const hour = new Date(b.t0).getHours();
      if (hour % 6 === 0 && b.t0 > weekStart) c.classList.add(hour === 0 ? "t0" : "t6");
      if (b.t0 > m.now) c.classList.add("fut");
      if (b.t0 === nowBlock) c.classList.add("nowh");
      // The day is the column right under it, so the tip only gives the hour: "14:00 · 2%"
      const when = fmtTime(b.t0);
      const shown = b.v >= 0.05 ? Math.round(b.v * 10) / 10 : 0;
      if (shown > 0) {
        c.classList.add(b.exact ? "m" : "e", `lv-${lvKey(dayLevel.get(dayKey(b.t0)) ?? 0)}`);
        c.style.setProperty("--a", (0.18 + 0.82 * (b.v / max)).toFixed(2));
        c.title = t(b.exact ? "hrs.tipMeasured" : "hrs.tipEst", { when, pct: fmtNum(shown, 0, 1) });
      } else {
        c.title = t(b.covered ? "hrs.tipNone" : "hrs.tipUnknown", { when });
      }
      return c;
    })
  );
  // The whole strip says what it is; the note about what could not be placed follows when there is one
  $("hrs").title = [t("hrs.tip"), left > 0.05 ? t("hrs.left", { pct: Math.round(left * 10) / 10 }) : ""].filter(Boolean).join("\n");
}

new ResizeObserver(() => drawHours()).observe($("hcells"));

// Past weeks, and Today by hour.
// The past weeks are one setting (the "4 wk" key in the chart's footer, pastWeeks in the settings). They are drawn as faint
// dashed lines in the week chart, or, in a tall vertical window, in their own block under the chart, with where each week
// ended. Never in both places. Today by hour (today's 24 hours and its 5-hour sessions) only shows in that tall window.
// fitTall() decides: the blocks come in order, Today by hour first, while there is room under everything else and the
// chart already has its full height. The past weeks need PAST_SLACK px more to move out of the chart than to stay out,
// so a resize near the limit does not flip them back and forth.

const PAST_N = 4;
const PAST_SLACK = 40;
const CHART_FULL_REM = 17; // the chart's full height in the vertical window (overview.css)
const TALL_QUERY = matchMedia("(max-width: 719px)");
let pastData = []; // pastWeeks() of the last render
let pastApart = false; // in their own block (true) or in the chart

function pastOn() {
  return Boolean(state.settings && state.settings.pastWeeks) && pastData.length > 0;
}
function pastInChart() {
  return pastOn() && !pastApart;
}

// Where the past weeks stood at the same point of the week: "usually 38–52% by now"
function pastUsualText(x) {
  const v = pastData.map((w) => pastWeekAt(w, x));
  const from = Math.round(Math.min(...v));
  const to = Math.round(Math.max(...v));
  return v.length === 1 ? t("past.usualOne", { pct: from }) : t("past.usual", { from, to });
}

function renderPast(m) {
  pastData = pastWeeks(m.days, m.w.resetsAt, PAST_N);
  const key = $("pastKey");
  $("pastKeyText").textContent = t("past.key", { n: PAST_N });
  key.disabled = !pastData.length;
  key.setAttribute("aria-pressed", String(pastOn()));
  key.title = pastData.length ? t("past.keyTitle", { n: PAST_N }) : t("past.keyNone");
  $("pastTitle").textContent = t("past.title", { n: PAST_N });
}
$("pastKey").addEventListener("click", () => saveSetting({ pastWeeks: !(state.settings && state.settings.pastWeeks) }));

function fitTall() {
  watchFit();
  const m = lastM;
  const tb = $("todayHrs");
  const pb = $("pastBlk");
  const was = pastApart;
  tb.classList.add("hidden");
  pb.classList.add("hidden");
  pb.classList.remove("grow");
  pastApart = false;
  const osc = $("plot").parentElement;
  if (m && TALL_QUERY.matches && osc.clientHeight >= CHART_FULL_REM * remPx() - 1) {
    const box = $("blkWeek");
    const gap = parseFloat(getComputedStyle(box).rowGap) || 0;
    const shown = [...box.children].filter((c) => c.offsetParent !== null && getComputedStyle(c).position !== "absolute");
    let room = box.getBoundingClientRect().bottom - Math.max(...shown.map((c) => c.getBoundingClientRect().bottom));
    const tryShow = (blk, slack) => {
      blk.classList.remove("hidden");
      const need = blk.offsetHeight + gap;
      if (need + slack > room) {
        blk.classList.add("hidden");
        return false;
      }
      room -= need;
      return true;
    };
    tryShow(tb, 0);
    if (pastOn() && tryShow(pb, was ? 0 : PAST_SLACK)) {
      pastApart = true;
      pb.classList.add("grow");
    }
  }
  if (!tb.classList.contains("hidden")) drawTodayHours();
  if (pastApart) drawPastBlock();
  // The chart's dashed lines follow where the weeks are
  if (pastApart !== was && m) renderWeek(m);
}

let fitQueued = false;
function queueFit() {
  if (fitQueued) return;
  fitQueued = true;
  requestAnimationFrame(() => {
    fitQueued = false;
    fitTall();
  });
}
// Started by the first fit: the window can paint between two scripts, before overview.js (lastM) has loaded
let fitWatching = false;
function watchFit() {
  if (fitWatching) return;
  fitWatching = true;
  new ResizeObserver(queueFit).observe($("dash"));
  TALL_QUERY.addEventListener("change", queueFit);
}

const LEVEL_TOKENS = ["free", "moderate", "tight", "pause"];
function svgPalette() {
  return {
    white: cssVar("--st") || CHART_WHITE, muted: cssVar("--sm") || CHART_MUTED, red: cssVar("--pause") || CHART_RED,
    accent: cssVar("--crt-accent") || CHART_NOW, grid: cssVar("--crt-grid") || "#1E2A23", gridDay: cssVar("--crt-grid-day") || "#26332B",
    cell: cssVar("--crt-cell") || "rgba(255, 255, 255, .045)", line: cssVar("--sline") || "#2F4036",
  };
}

// Today by hour: the use of each hour of today (bars in today's level color, dimmer when estimated), with the 5-hour
// sessions as bands behind the hours they cover (the current one in the accent). Each band's % sits in the row above
// the bars, and only when it fits inside its band: a label never runs over another one or past its band.
// A past session with no use today (one from yesterday that ran past midnight) gets no band.
function drawTodayHours() {
  const m = lastM;
  const svg = $("todayHrsSvg");
  const box = svg.parentElement;
  const W = box.clientWidth;
  const H = box.clientHeight;
  if (!m || !W || !H) return;
  const rem = remPx();
  const PAL = svgPalette();
  svg.textContent = "";
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("aria-label", t("todayHrs.aria"));
  const add = (tag, attrs) => el(tag, attrs, svg);
  const d0 = new Date(m.now);
  const hourMs = (h) => new Date(d0.getFullYear(), d0.getMonth(), d0.getDate(), h).getTime();
  const day0 = hourMs(0);
  const day1 = hourMs(24);
  const X = (ms) => 1 + ((Math.min(Math.max(ms, day0), day1) - day0) / (day1 - day0)) * (W - 2);
  const labelY = 0.95 * rem; // the band labels' baseline, in the row above the bars
  const barTop = 1.35 * rem;
  const barBot = H - 1.3 * rem; // the hour labels go under
  const weekStart = m.w.resetsAt - WEEK;
  const today = (m.week || []).find((d) => d.isToday);
  const color = cssVar(`--${LEVEL_TOKENS[(today && today.level) ?? 0]}`) || PAL.white;

  const { cells } = hoursUsageFor(m);
  const hours = [];
  for (let h = 0; h < 24; h++) {
    const t0 = hourMs(h);
    const c = cells.get(t0);
    hours.push({ t0, t1: hourMs(h + 1), v: c ? c.v : 0, exact: c ? c.exact : true });
  }
  const used = (from, to) => hours.some((x) => x.v >= 0.05 && x.t1 > from && x.t0 < to);

  // The sessions: the saved ones (reset time and peak), plus the current one from the last reading
  const f = m.five;
  const cur = f && f.resetsAt && f.resetsAt > m.now ? { sr: f.resetsAt, pct: f.used, cur: true } : null;
  const list = ((state.settings && state.settings.sessions) || []).map((x) => ({ sr: x.sr, pct: x.peak }));
  const wins = [...list.filter((x) => !cur || Math.abs(x.sr - cur.sr) > 10 * MIN), ...(cur ? [cur] : [])]
    .filter((x) => x.sr > day0 && x.sr - 5 * HOUR < day1 && (x.cur || used(x.sr - 5 * HOUR, x.sr)));
  for (const x of wins) {
    const a = X(x.sr - 5 * HOUR);
    const b = X(x.sr);
    add("rect", { x: a + 0.5, y: 0.5, width: Math.max(b - a - 1, 1), height: barBot - 0.5, fill: x.cur ? PAL.accent : PAL.muted, "fill-opacity": x.cur ? ".14" : ".07", stroke: x.cur ? PAL.accent : PAL.line });
    const n = add("text", { x: a + 5, y: labelY, fill: x.cur ? PAL.white : PAL.muted, "font-weight": "600" });
    n.textContent = `${r0(x.pct)}%`;
    if (a + 5 + n.getComputedTextLength() > b - 4) n.remove();
  }

  const max = Math.max(...hours.map((x) => x.v), 0.0001);
  for (const x of hours) {
    if (x.t1 <= weekStart) continue; // before this week
    const x0 = X(x.t0) + 0.5;
    const w = Math.max(X(x.t1) - X(x.t0) - 1.5, 1);
    add("rect", { x: x0, y: barTop, width: w, height: barBot - barTop, fill: PAL.cell, opacity: x.t0 > m.now ? ".5" : "1" });
    if (x.v >= 0.05) {
      const bh = Math.max((barBot - barTop) * (x.v / max), 2);
      add("rect", { x: x0, y: barBot - bh, width: w, height: bh, fill: color, opacity: x.exact ? "1" : ".5" });
    }
  }
  if (m.now > day0 && m.now < day1) add("line", { x1: X(m.now), x2: X(m.now), y1: barTop, y2: barBot, stroke: PAL.accent, "stroke-width": 1.5 });
  for (const h of [0, 6, 12, 18, 24]) {
    const n = add("text", { x: X(hourMs(h)), y: H - 0.2 * rem, fill: PAL.muted, "text-anchor": h === 0 ? "start" : h === 24 ? "end" : "middle" });
    n.textContent = pad(h);
  }
  $("todayHrsReset").textContent = cur ? t("todayHrs.resets", { time: fmtTime(cur.sr) }) : "";
}

// The past weeks in their own block: the same axis as the week chart, the past weeks in gray (red for one that reached
// 100%), this week's used line over them, and where each week ended under it
function drawPastBlock() {
  const m = lastM;
  const s = chartInput && chartInput.series;
  const svg = $("pastSvg");
  const box = svg.parentElement;
  const W = box.clientWidth;
  const H = box.clientHeight;
  if (!m || !s || !W || !H) return;
  const rem = remPx();
  const PAL = svgPalette();
  svg.textContent = "";
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("aria-label", t("past.aria", { n: pastData.length, pct: r0(s.usedNow) }));
  const add = (tag, attrs) => el(tag, attrs, svg);
  const L = 2.4 * rem;
  const T = 0.5 * rem;
  const B = 0.3 * rem;
  const A0 = s.a0;
  const AX = Math.max(s.span, A0 + 1);
  const X = (x) => L + ((Math.min(Math.max(x, A0), AX) - A0) / (AX - A0)) * (W - L);
  const Y = (v) => T + (1 - Math.min(Math.max(v, 0), 100) / 100) * (H - T - B);
  const fmt = (pts) => pts.map((p) => `${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join(" ");
  for (const v of [0, 50, 100]) {
    add("line", { x1: L, x2: W, y1: Y(v), y2: Y(v), stroke: PAL.grid });
    const n = add("text", { x: L - 6, y: v === 0 ? Y(v) - 3 : Y(v) + 4, fill: PAL.muted, "text-anchor": "end" });
    n.textContent = `${v}%`;
  }
  for (let i = 1; i <= DAYS_SHOWN; i++) if (i > A0 + 0.02) add("line", { x1: X(i), x2: X(i), y1: T, y2: H - B, stroke: PAL.gridDay });
  for (const w of pastData) add("polyline", { points: fmt(w.pts), fill: "none", stroke: w.fullDay ? PAL.red : PAL.muted, opacity: w.fullDay ? ".7" : ".55", "stroke-width": 1.4 });
  const nx = X(s.nowX);
  add("line", { x1: nx, x2: nx, y1: T, y2: H - B, stroke: PAL.accent, "stroke-width": 1 });
  const color = m.endRoom ? PAL.accent : cssVar(`--${LEVEL_TOKENS[m.lv.week ?? 0]}`) || PAL.white;
  const used = s.used.filter((p) => p.x <= s.nowX + 1e-6);
  if (used.length > 1) add("polyline", { points: fmt(used), fill: "none", stroke: color, "stroke-width": 2 });
  add("circle", { cx: nx, cy: Y(s.usedNow), r: 3, fill: color });

  $("pastBlkUsual").textContent = pastUsualText(s.nowX);
  const locale = I18N.locale();
  $("pastEnds").replaceChildren(
    ...[...pastData].reverse().map((w) => {
      const item = node("span");
      const date = new Date(w.start).toLocaleDateString(locale, { month: "short", day: "numeric" });
      item.append(`${date} `, node("b", w.fullDay ? "out" : "", w.fullDay ? t("past.full", { day: shortWeekday(new Date(w.fullDay)) }) : `${r0(w.end)}%`));
      return item;
    }),
    (() => {
      const item = node("span", "pnow");
      item.style.setProperty("--c", color);
      item.append(`${t("past.now")} `, node("b", "", `${r0(s.usedNow)}%`));
      return item;
    })()
  );
}

// The week's pace chart, drawn as SVG on a CRT: the plan's pace (white), what was used (level color),
// the parts that went over a day's budget (red), and where the pace so far leads (dashed).
// It draws in pixels, so the text stays at its real size, and draws again whenever its box changes size.

const CHART_WHITE = "#E4EFE6";
const CHART_MUTED = "#9DB0A2";
const CHART_RED = "#F2575A";
const CHART_NOW = "#86A2FF"; // fallback for --crt-accent
const DAYS_SHOWN = 7;

let chartInput = null; // { m, series } of the last render

function remPx() {
  return parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
}

function drawPaceChart() {
  const svg = $("paceSvg");
  const box = $("plot");
  if (!chartInput || !box.clientWidth || !box.clientHeight) return;
  const { m, series: s } = chartInput;
  const rem = remPx();
  const W = box.clientWidth;
  const H = box.clientHeight;
  // The % scale lives in a gutter on the left (as wide as the HRS label's column); the hours and the day columns
  // start where the gutter ends, so the chart lines up with them. No margin on the right.
  const L = Math.max($("hcells").getBoundingClientRect().left - box.getBoundingClientRect().left, 0);
  const R = 0;
  const T = 0.75 * rem;
  const B = 0.25 * rem;
  // x is in days from the midnight that starts the first day: seven equal columns, Tuesday to Monday. The chart stops at the
  // seventh midnight (the week's last hours are not drawn, but still count); the part before the reset is shaded as "not this week".
  const X = (x) => L + (Math.min(x, DAYS_SHOWN + 1) / DAYS_SHOWN) * (W - L - R);
  const Y = (v) => T + (1 - Math.min(Math.max(v, 0), 100) / 100) * (H - T - B);
  const color = cssVar(`--${["free", "moderate", "tight", "pause"][m.lv.week ?? 0]}`);
  const fmt = (pts) => pts.map((p) => `${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join(" ");

  svg.textContent = "";
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("aria-label", t("chart.aria", { used: r0(s.usedNow), expected: r0(m.lv.expected) }));
  const add = (tag, attrs) => el(tag, attrs, svg);
  const text = (x, y, str, attrs = {}) => {
    const n = add("text", { x, y, fill: CHART_MUTED, ...attrs });
    n.textContent = str;
    return n;
  };

  // Grid and scale: 0, 50 and 100%, plus quarters when there is room
  const inner = H - T - B;
  for (const v of inner > 6 * rem ? [0, 25, 50, 75, 100] : inner > 3.4 * rem ? [0, 50, 100] : [0, 100]) {
    add("line", { x1: L, x2: W - R, y1: Y(v), y2: Y(v), stroke: "#1E2A23" });
    // The scale sits in the gutter, level with its line (0% just above the line so it clears the HRS label)
    text(L - 6, v === 0 ? Y(v) - 3 : Y(v) + 4, `${v}%`, { "text-anchor": "end" });
  }

  if (s.s0 > 0.01) add("rect", { x: X(0), y: T, width: X(s.s0) - X(0), height: H - T - B, fill: "#000", opacity: ".35" });
  // Where the week starts (the reset): a dashed line and its time. The label is placed with the others, below.
  const startX = s.s0 > 0.01 ? X(s.s0) : null;
  if (startX !== null) add("line", { x1: startX, x2: startX, y1: T, y2: H - B, stroke: CHART_MUTED, "stroke-dasharray": "3 3", opacity: ".7" });
  // Day columns: shaded every other day, with a line at each midnight (the names are in the footer)
  for (let i = 0; i < DAYS_SHOWN; i++) {
    const x0 = Math.max(i, s.s0);
    const x1 = i + 1;
    if (x1 - x0 < 0.02) continue;
    if (i % 2 === 0) add("rect", { x: X(x0), y: T, width: X(x1) - X(x0), height: H - T - B, fill: "#fff", opacity: ".03" });
    if (i > 0 && i >= s.s0) add("line", { x1: X(i), x2: X(i), y1: T, y2: H - B, stroke: "#26332B" });
  }

  // The plan's pace, then what was used (with a faint area under it)
  const px = (pts) => pts.map((p) => ({ x: X(p.x), y: Y(p.y) }));
  const projPx = s.proj && s.proj.length > 1 ? px(s.proj) : null;
  // A projection only a few pixels long is just a stub next to the marker: it adds nothing, so it is not drawn
  const showProj = projPx !== null && pathLength(projPx) > 1.5 * rem;
  add("polyline", { points: fmt(s.expected), fill: "none", stroke: CHART_WHITE, "stroke-width": 2 });
  const area = `${fmt(s.used)} ${X(s.used[s.used.length - 1].x).toFixed(1)},${Y(0)} ${X(s.used[0].x).toFixed(1)},${Y(0)}`;
  add("polygon", { points: area, fill: color, opacity: ".22" });
  // Runs of the line: solid where the hours placed the use from close readings (or the piece is straight), short dashes where it is an estimate
  const runs = [];
  for (let i = 1; i < s.used.length; i++) {
    const est = Boolean(s.used[i].est);
    if (!runs.length || runs[runs.length - 1].est !== est) runs.push({ est, pts: [s.used[i - 1]] });
    runs[runs.length - 1].pts.push(s.used[i]);
  }
  for (const run of runs) add("polyline", { points: fmt(run.pts), fill: "none", stroke: color, "stroke-width": 3, "stroke-linejoin": "round", ...(run.est ? { "stroke-dasharray": "3 3" } : {}) });
  for (const seg of s.over) add("polyline", { points: fmt(seg), fill: "none", stroke: CHART_RED, "stroke-width": 4 });
  // Where 5-hour sessions started: a short tick on the base, with the time on hover
  const TICK = 16;
  for (const st of s.starts) {
    const tick = add("line", { x1: X(st.x), x2: X(st.x), y1: H - B - TICK, y2: H - B, stroke: CHART_MUTED, "stroke-width": 2 });
    el("title", {}, tick).textContent = t("chart.sessionStart", { time: fmtTime(st.ms) });
  }
  if (showProj) add("polyline", { points: fmt(s.proj), fill: "none", stroke: color, "stroke-width": 2, "stroke-dasharray": "6 5" });

  // Now
  const nowColor = cssVar("--crt-accent") || CHART_NOW;
  const nx = X(s.nowX);
  const ny = Y(s.usedNow);
  add("line", { x1: nx, x2: nx, y1: T, y2: H - B, stroke: nowColor, "stroke-width": 1.5 });
  add("circle", { cx: nx, cy: ny, r: 5, fill: color });

  // The two labels ("now 62%" and where the pace leads). Each one tries a handful of spots and the
  // pair that touches the fewest lines, and each other, wins.
  const upper = (str) => str.toLocaleUpperCase(I18N.locale());
  const items = [];
  const nowText = text(0, 0, t("chart.now"), { fill: nowColor, "font-weight": "600", class: "lbl" });
  const nowRows = [T + 0.85 * rem, T + (H - T - B) * 0.32 + 0.3 * rem, T + (H - T - B) * 0.6, Y(0) - 0.45 * rem];
  const nowCands = [];
  nowRows.forEach((y, i) => {
    nowCands.push({ x: nx + 6, y, anchor: "start", pen: i * 2 }, { x: nx - 6, y, anchor: "end", pen: i * 2 + 0.5 });
  });
  items.push({ node: nowText, cands: nowCands });

  if (startX !== null) {
    const startText = text(0, 0, fmtTime(m.w.resetsAt - WEEK), { class: "lbl" });
    items.push({ node: startText, cands: [{ x: startX + 4, y: T + 0.85 * rem, anchor: "start", pen: 0 }] });
  }

  if (s.end && s.end.kind === "out") {
    const outText = text(0, 0, upper(t("forecast.out")), { fill: CHART_RED, "font-weight": "600", class: "lbl" });
    items.push({ node: outText, cands: [{ x: W - R - 6, y: Y(100) + 1.25 * rem, anchor: "end", pen: 0 }] });
  }

  const obstacles = [
    { pts: px(s.expected), w: 14 },
    { pts: px(s.used), w: 14 },
    ...s.over.map((seg) => ({ pts: px(seg), w: 14 })),
    ...(showProj ? [{ pts: projPx, w: 14 }] : []),
    { pts: [{ x: nx, y: T }, { x: nx, y: H - B }], w: 4 },
    ...s.starts.map((st) => ({ pts: [{ x: X(st.x), y: H - B - TICK }, { x: X(st.x), y: H - B }], w: 4 })),
    ...(startX !== null ? [{ pts: [{ x: startX, y: T }, { x: startX, y: H - B }], w: 4 }] : []),
    { pts: [{ x: nx - 6, y: ny }, { x: nx + 6, y: ny }], w: 14 },
  ];
  placeLabels(items, obstacles, { x0: L + 2, x1: W - 3, y0: 2, y1: H - B });
}

// ---- Label placement ----

function pathLength(pts) {
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  return len;
}

// Does the segment a-b cross the rectangle r? (Liang-Barsky clipping)
function segmentHitsRect(a, b, r) {
  let t0 = 0;
  let t1 = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  for (const [p, q] of [[-dx, a.x - r.x0], [dx, r.x1 - a.x], [-dy, a.y - r.y0], [dy, r.y1 - a.y]]) {
    if (p === 0) {
      if (q < 0) return false;
    } else {
      const k = q / p;
      if (p < 0) {
        if (k > t1) return false;
        t0 = Math.max(t0, k);
      } else {
        if (k < t0) return false;
        t1 = Math.min(t1, k);
      }
    }
  }
  return true;
}

// Picks one spot per label so that the labels stay inside the plot, off the lines and off each other
// (a label that cannot avoid every line gets a halo).
// items: [{ node, cands: [{ x, y, anchor, pen }] }]; obstacles: [{ pts, w }]; bounds: { x0, x1, y0, y1 }
function placeLabels(items, obstacles, bounds) {
  const PAD = 2;
  for (const it of items) {
    const box = it.node.getBBox();
    const fs = box.height || 12;
    const w = box.width || it.node.textContent.length * 0.6 * fs;
    const asc = box.height ? -box.y : fs * 0.8;
    const desc = box.height ? box.height + box.y : fs * 0.25;
    for (const c of it.cands) {
      const x0 = c.anchor === "end" ? c.x - w : c.x;
      c.rect = { x0: x0 - PAD, x1: x0 + w + PAD, y0: c.y - asc - PAD, y1: c.y + desc + PAD };
      let cost = c.pen;
      const out = Math.max(bounds.x0 - c.rect.x0, c.rect.x1 - bounds.x1, bounds.y0 - c.rect.y0, c.rect.y1 - bounds.y1, 0);
      if (out > 0) cost += 1000 + out;
      for (const o of obstacles) {
        for (let i = 1; i < o.pts.length; i++) {
          if (segmentHitsRect(o.pts[i - 1], o.pts[i], c.rect)) {
            cost += o.w;
            break;
          }
        }
      }
      c.hits = cost - c.pen - (out > 0 ? 1000 + out : 0);
      c.cost = cost;
    }
  }
  const overlap = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
  let best = null;
  const walk = (i, picked, cost) => {
    if (best && cost >= best.cost) return;
    if (i === items.length) {
      best = { cost, picked: picked.slice() };
      return;
    }
    for (const c of items[i].cands) {
      const clash = picked.some((p) => overlap(p.rect, c.rect)) ? 1000 : 0;
      picked.push(c);
      walk(i + 1, picked, cost + c.cost + clash);
      picked.pop();
    }
  };
  walk(0, [], 0);
  items.forEach((it, i) => {
    const c = best.picked[i];
    it.node.setAttribute("x", c.x);
    it.node.setAttribute("y", c.y);
    it.node.setAttribute("text-anchor", c.anchor);
    // In a chart too small for a clear spot the label sits on a line: a halo in the screen color keeps it readable
    it.node.classList.toggle("halo", c.hits > 0);
  });
}

// Called with every render; the chart also redraws when its box is resized
function renderPaceChart(m) {
  const starts = sessionStartsFrom(state.settings.readings, m.w.resetsAt - WEEK, m.now);
  chartInput = { m, series: paceSeries(m, hoursUsageFor(m).cells, starts) };
  drawPaceChart();
}

new ResizeObserver(() => drawPaceChart()).observe($("plot"));

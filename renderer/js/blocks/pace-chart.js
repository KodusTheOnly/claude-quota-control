// The week's pace chart, drawn as SVG on a CRT: the plan's pace (white), what was used (each day in its level's color),
// the parts that went over a day's budget (red), where the pace so far leads (dashed), the goal line the level
// counts to (dotted, at 100%), the reserve, the time it would leave without Claude before the reset (red dots on that line),
// and what there is still to spend at the reset (an accent bracket at the reset, from where the projection ends to the
// plan's ceiling, with how much it holds). The future, after now, is dimmed a little.
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
  // The chart palette comes from the tokens; the constants above are the fallbacks.
  const PAL = {
    white: cssVar("--st") || CHART_WHITE, muted: cssVar("--sm") || CHART_MUTED, red: cssVar("--pause") || CHART_RED,
    grid: cssVar("--crt-grid") || "#1E2A23", gridDay: cssVar("--crt-grid-day") || "#26332B",
    reserve: cssVar("--crt-reserve") || "#1B2236",
    shade: cssVar("--crt-shade") || "rgba(0, 0, 0, .35)", band: cssVar("--crt-band") || "rgba(255, 255, 255, .03)",
  };
  const W = box.clientWidth;
  const H = box.clientHeight;
  // The % scale lives in a gutter on the left (as wide as the HRS label's column); the hours and the day columns
  // start where the gutter ends, so the chart lines up with them. No margin on the right.
  const L = Math.max($("hcells").getBoundingClientRect().left - box.getBoundingClientRect().left, 0);
  const R = 0;
  const T = 0.75 * rem;
  const B = 0.25 * rem;
  // x is in days from the midnight that starts the first day: seven equal columns, Tuesday to Monday, then the week's last
  // hours up to the reset (a narrower column). The part before the reset is shaded as "not this week".
  const AX = Math.max(s.span, DAYS_SHOWN);
  const X = (x) => L + (Math.min(x, AX) / AX) * (W - L - R);
  const Y = (v) => T + (1 - Math.min(Math.max(v, 0), 100) / 100) * (H - T - B);
  const accent = cssVar("--crt-accent") || CHART_NOW;
  // The week's color: its level, or the accent on the last day with room to spend (the risk then is leaving it unused)
  const color = m.endRoom ? accent : cssVar(`--${["free", "moderate", "tight", "pause"][m.lv.week ?? 0]}`);
  const fmt = (pts) => pts.map((p) => `${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join(" ");

  svg.textContent = "";
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("aria-label", t("chart.aria", { used: r0(s.usedNow), expected: r0(m.lv.expected) }));
  const add = (tag, attrs) => el(tag, attrs, svg);
  const text = (x, y, str, attrs = {}) => {
    const n = add("text", { x, y, fill: PAL.muted, ...attrs });
    n.textContent = str;
    return n;
  };

  // Grid and scale: 0, 50 and 100%, plus quarters when there is room
  const inner = H - T - B;
  for (const v of inner > 6 * rem ? [0, 25, 50, 75, 100] : inner > 3.4 * rem ? [0, 50, 100] : [0, 100]) {
    add("line", { x1: L, x2: W - R, y1: Y(v), y2: Y(v), stroke: PAL.grid });
    // The scale sits in the gutter, level with its line (0% just above the line so it clears the HRS label)
    text(L - 6, v === 0 ? Y(v) - 3 : Y(v) + 4, `${v}%`, { "text-anchor": "end" });
  }

  // The reserve still held (hatched accent, from the plan's ceiling to the goal; its lower edge rises while the
  // reserve is released). Drawn under every line.
  if (s.reserve) {
    const defs = add("defs", {});
    const pat = el("pattern", { id: "rzHatch", width: 6, height: 6, patternUnits: "userSpaceOnUse", patternTransform: "rotate(45)" }, defs);
    el("rect", { width: 6, height: 6, fill: PAL.reserve }, pat);
    el("rect", { width: 2, height: 6, fill: accent }, pat);
    const top = [{ x: s.span, y: s.goal }, { x: s.s0, y: s.goal }];
    add("polygon", { points: fmt([...s.reserve, ...top]), fill: "url(#rzHatch)", opacity: ".7" });
  }

  // What there is to spend: at the reset, from where the projection ends up to the plan's ceiling (none without a
  // projection, or when the pace reaches the goal). Drawn as a bracket after the lines.
  const spend = s.room && s.room.mid !== null && s.room.spend >= 1
    ? { x: X(s.room.x1), y0: Y(s.room.y1), y1: Y(s.room.mid) }
    : null;

  // The line the level counts to (the goal, 100%), in the week's color. Its width is not the NOW line's 1.5.
  const lockY = Y(s.goal);
  add("line", { x1: L, x2: W - R, y1: lockY, y2: lockY, stroke: color, opacity: ".55", "stroke-width": 1.25, "stroke-dasharray": "1 4", "stroke-linecap": "round" });

  if (s.s0 > 0.01) add("rect", { x: X(0), y: T, width: X(s.s0) - X(0), height: H - T - B, fill: PAL.shade });
  // Where the week starts (the last reset): a dashed line, no label. The footer already says when the next reset is.
  const startX = s.s0 > 0.01 ? X(s.s0) : null;
  if (startX !== null) add("line", { x1: startX, x2: startX, y1: T, y2: H - B, stroke: PAL.muted, "stroke-dasharray": "3 3", opacity: ".7" });
  // Day columns: shaded every other day, with a line at each midnight (the names are in the footer)
  for (let i = 0; i < DAYS_SHOWN; i++) {
    const x0 = Math.max(i, s.s0);
    const x1 = i + 1;
    if (x1 - x0 < 0.02) continue;
    if (i % 2 === 0) add("rect", { x: X(x0), y: T, width: X(x1) - X(x0), height: H - T - B, fill: PAL.band });
    if (i > 0 && i >= s.s0) add("line", { x1: X(i), x2: X(i), y1: T, y2: H - B, stroke: PAL.gridDay });
  }
  if (AX > DAYS_SHOWN + 0.02) add("line", { x1: X(DAYS_SHOWN), x2: X(DAYS_SHOWN), y1: T, y2: H - B, stroke: PAL.gridDay });
  // Outside the active hours (Settings > Plan) the plan stands still: those hours are shaded lightly
  for (const r of s.rest) add("rect", { x: X(r.x0), y: T, width: Math.max(X(r.x1) - X(r.x0), 0), height: H - T - B, fill: PAL.shade, opacity: ".5" });
  // The future is dimmed a little, so what already happened reads first
  const nx = X(s.nowX);
  if (nx < W - R) add("rect", { x: nx, y: T, width: W - R - nx, height: H - T - B, fill: PAL.shade, opacity: ".6" });

  // The plan's pace, then what was used (with a faint area under it)
  const px = (pts) => pts.map((p) => ({ x: X(p.x), y: Y(p.y) }));
  const projPx = s.proj && s.proj.length > 1 ? px(s.proj) : null;
  // A projection only a few pixels long is just a stub next to the marker: it adds nothing, so it is not drawn
  const showProj = projPx !== null && pathLength(projPx) > 1.5 * rem;
  // When the projection stays within 2 points of the plan up to the reset, the two lines would run on top of each other:
  // the plan stops at now and the projection alone carries on, named "projection ≈ expected"
  const onPlan = showProj && s.proj.every((p) => {
    const y = yAt(s.expected, p.x);
    return y === null || Math.abs(y - p.y) < 2;
  });
  const expShown = onPlan ? clipAt(s.expected, s.nowX) : s.expected;
  add("polyline", { points: fmt(expShown), fill: "none", stroke: PAL.white, "stroke-width": 2 });
  // Each day's piece of the used line, and the area under it, takes the color of that day's level, as its card and its
  // hours (Free when the day is not rated)
  const dayColor = (k) => cssVar(`--${["free", "moderate", "tight", "pause"][(m.week[k] && m.week[k].level) ?? 0]}`);
  const segColor = (i) => dayColor(Math.floor((s.used[i - 1].x + s.used[i].x) / 2));
  const areas = [];
  for (let i = 1; i < s.used.length; i++) {
    const c = segColor(i);
    if (!areas.length || areas[areas.length - 1].c !== c) areas.push({ c, pts: [s.used[i - 1]] });
    areas[areas.length - 1].pts.push(s.used[i]);
  }
  for (const a of areas) {
    const poly = `${fmt(a.pts)} ${X(a.pts[a.pts.length - 1].x).toFixed(1)},${Y(0)} ${X(a.pts[0].x).toFixed(1)},${Y(0)}`;
    add("polygon", { points: poly, fill: a.c, opacity: ".22" });
  }
  // Runs of the line: solid where the hours placed the use from close readings (or the piece is straight), short dashes where it is an estimate
  const runs = [];
  for (let i = 1; i < s.used.length; i++) {
    const est = Boolean(s.used[i].est);
    const c = segColor(i);
    const last = runs[runs.length - 1];
    if (!last || last.est !== est || last.c !== c) runs.push({ est, c, pts: [s.used[i - 1]] });
    runs[runs.length - 1].pts.push(s.used[i]);
  }
  for (const run of runs) add("polyline", { points: fmt(run.pts), fill: "none", stroke: run.c, "stroke-width": 3, "stroke-linejoin": "round", ...(run.est ? { "stroke-dasharray": "3 3" } : {}) });
  for (const seg of s.over) add("polyline", { points: fmt(seg), fill: "none", stroke: PAL.red, "stroke-width": 4 });
  // Where 5-hour sessions started: a short tick on the base, with the time on hover
  const TICK = 16;
  for (const st of s.starts) {
    const tick = add("line", { x1: X(st.x), x2: X(st.x), y1: H - B - TICK, y2: H - B, stroke: PAL.muted, "stroke-width": 2 });
    el("title", {}, tick).textContent = t("chart.sessionStart", { time: fmtTime(st.ms) });
  }
  if (showProj) add("polyline", { points: fmt(s.proj), fill: "none", stroke: color, "stroke-width": 2, "stroke-dasharray": "6 5" });
  // Where the projection ends at the reset: a dot (the number is up in the band, "at reset"), kept whole at the right edge
  if (showProj && s.end && s.end.kind === "reset") {
    const e = projPx[projPx.length - 1];
    add("circle", { cx: Math.min(e.x, W - R - 4), cy: e.y, r: 3, fill: color });
  }
  // From T to the reset: the time without Claude, thicker red dots over the 100% line
  const lockPx = s.lock ? px(s.lock) : null;
  if (lockPx) add("polyline", { points: fmt(s.lock), fill: "none", stroke: PAL.red, "stroke-width": 4, "stroke-dasharray": "1 6", "stroke-linecap": "round" });

  // What there is to spend: a bracket at the reset, opening to the left
  if (spend) {
    const bx = Math.min(spend.x, W - R - 1);
    add("path", { d: `M${bx - 6},${spend.y0} H${bx} V${spend.y1} H${bx - 6}`, fill: "none", stroke: accent, "stroke-width": 2 });
  }

  // Now
  const nowColor = cssVar("--crt-accent") || CHART_NOW;
  const ny = Y(s.usedNow);
  add("line", { x1: nx, x2: nx, y1: T, y2: H - B, stroke: nowColor, "stroke-width": 1.5 });
  add("circle", { cx: nx, cy: ny, r: 5, fill: color });
  // A ring that pings when the verdict's face glances at the chart (verdict.js puts .glance on the plot)
  add("circle", { cx: nx, cy: ny, r: 13, fill: "none", stroke: color, "stroke-width": 2, class: "nowping" });

  // The labels: "NOW", the room left, "out" when the limit is already reached, and the names of the lines.
  // Each one tries a handful of spots, and the set that touches the fewest lines, and each other, wins.
  const upper = (str) => str.toLocaleUpperCase(I18N.locale());
  const items = [];
  const nowText = text(0, 0, t("chart.now"), { fill: nowColor, "font-weight": "600", class: "lbl" });
  const nowRows = [T + 0.85 * rem, T + (H - T - B) * 0.32 + 0.3 * rem, T + (H - T - B) * 0.6, Y(0) - 0.45 * rem];
  const nowCands = [];
  nowRows.forEach((y, i) => {
    nowCands.push({ x: nx + 6, y, anchor: "start", pen: i * 2 }, { x: nx - 6, y, anchor: "end", pen: i * 2 + 0.5 });
  });
  items.push({ node: nowText, cands: nowCands });

  // What there is to spend (the band's "to spend"), to the left of its bracket: level with its top, its middle or its
  // bottom, or just above it
  if (spend) {
    // A narrow chart has room only for the number (measured: the words ran into "projection" at 420px in pt-BR)
    const words = W - L > 30 * rem;
    const roomText = text(0, 0, words ? t("band.toSpend", { pct: s.room.spend }) : `~${s.room.spend}%`, { fill: accent, "font-weight": "600", class: "lbl" });
    const bx = Math.min(spend.x, W - R - 1) - 10;
    const rows = [spend.y0 + 0.95 * rem, (spend.y0 + spend.y1) / 2 + 0.35 * rem, spend.y1 + 1.1 * rem, spend.y0 - 5];
    items.push({ node: roomText, optional: true, cands: rows.map((y, i) => ({ x: bx, y, anchor: "end", pen: i * 2 })) });
  }

  if (s.end && s.end.kind === "out") {
    const outText = text(0, 0, upper(t("forecast.out")), { fill: PAL.red, "font-weight": "600", class: "lbl" });
    items.push({ node: outText, cands: [{ x: W - R - 6, y: Y(100) + 1.25 * rem, anchor: "end", pen: 0 }] });
  }

  // The lines say their own names (no legend needed for them): "used" a little before now, "expected" and "projection"
  // ahead of it. Each name tries a few spots along its line, just above it on the left or just under it on the right.
  const lineCands = (pts, xs, pen0) => {
    const cands = [];
    xs.forEach((x, i) => {
      const y = yAt(pts, x);
      if (y === null) return;
      cands.push({ x: X(x) - 4, y: Y(y) - 7, anchor: "end", pen: pen0 + i * 2 }, { x: X(x) + 4, y: Y(y) + 1.1 * rem, anchor: "start", pen: pen0 + i * 2 + 0.5 });
    });
    return cands;
  };
  const inWeek = (xs) => xs.filter((x) => x > s.s0 + 0.15 && x < AX - 0.05);
  const lineLabel = (key, fill, pts, xs, pen0) => {
    const cands = lineCands(pts, inWeek(xs), pen0);
    if (cands.length) items.push({ node: text(0, 0, t(key), { fill, class: "lbl" }), optional: true, cands });
  };
  lineLabel("chart.legUsed", dayColor(s.todayIdx), s.used, [s.nowX - 0.4, s.nowX - 1.2, s.nowX - 2.2], 1);
  lineLabel("chart.legExpected", PAL.white, expShown, onPlan ? [s.nowX - 1.6, s.nowX - 0.8, s.nowX - 2.4] : [s.nowX + 1.2, s.nowX + 2.4, s.nowX - 1.6], 1);
  if (showProj) {
    const end = s.proj[s.proj.length - 1].x;
    lineLabel(onPlan ? "chart.legProjPlan" : "chart.legProj", color, s.proj, [s.nowX + (end - s.nowX) * 0.55, s.nowX + (end - s.nowX) * 0.8, s.nowX + (end - s.nowX) * 0.3], 2);
  }

  const obstacles = [
    { pts: px(expShown), w: 14 },
    { pts: px(s.used), w: 14 },
    ...s.over.map((seg) => ({ pts: px(seg), w: 14 })),
    ...(showProj ? [{ pts: projPx, w: 14 }] : []),
    ...(lockPx ? [{ pts: lockPx, w: 14 }] : []),
    ...(spend ? [{ pts: [{ x: spend.x, y: spend.y0 }, { x: spend.x, y: spend.y1 }], w: 14 }] : []),
    { pts: [{ x: L, y: lockY }, { x: W - R, y: lockY }], w: 4 },
    { pts: [{ x: nx, y: T }, { x: nx, y: H - B }], w: 4 },
    ...s.starts.map((st) => ({ pts: [{ x: X(st.x), y: H - B - TICK }, { x: X(st.x), y: H - B }], w: 4 })),
    ...(startX !== null ? [{ pts: [{ x: startX, y: T }, { x: startX, y: H - B }], w: 4 }] : []),
    { pts: [{ x: nx - 6, y: ny }, { x: nx + 6, y: ny }], w: 14 },
  ];
  placeLabels(items, obstacles, { x0: L + 2, x1: W - 3, y0: 2, y1: H - B });
}

// ---- Label placement ----

// The y of a line (points sorted by x) at x, or null outside it
function yAt(pts, x) {
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    if (x >= a.x && x <= b.x) return b.x === a.x ? b.y : a.y + ((x - a.x) / (b.x - a.x)) * (b.y - a.y);
  }
  return null;
}

// The part of a line (points sorted by x) up to x, ending exactly at x
function clipAt(pts, x) {
  const out = pts.filter((p) => p.x < x);
  const y = yAt(pts, x);
  if (y !== null) out.push({ x, y });
  return out.length ? out : pts;
}

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
// (a label that cannot avoid every line gets a halo). An optional label (the names of the lines, what there is to spend)
// is left out instead when it has no spot clear of the lines and the other labels: in a tight chart it would only crowd it.
// items: [{ node, optional, cands: [{ x, y, anchor, pen }] }]; obstacles: [{ pts, w }]; bounds: { x0, x1, y0, y1 }
const DROP_COST = 12; // under a line's 14: an optional label goes rather than sit on a line
function placeLabels(items, obstacles, bounds) {
  const PAD = 2;
  for (const it of items) {
    if (it.optional) it.cands.push({ drop: true, rect: null, pen: DROP_COST, hits: 0, cost: DROP_COST });
    const box = it.node.getBBox();
    const fs = box.height || 12;
    const w = box.width || it.node.textContent.length * 0.6 * fs;
    const asc = box.height ? -box.y : fs * 0.8;
    const desc = box.height ? box.height + box.y : fs * 0.25;
    for (const c of it.cands) {
      if (c.drop) continue;
      const x0 = c.anchor === "end" ? c.x - w : c.anchor === "middle" ? c.x - w / 2 : c.x;
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
  const overlap = (a, b) => Boolean(a && b) && a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
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
    if (c.drop) {
      it.node.remove();
      return;
    }
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

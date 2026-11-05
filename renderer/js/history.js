// History: three console blocks. Days (the stats and the column chart), Previous weeks, and When sessions start.
// A column is how much of the weekly limit a day used. The white tick on it is that day's budget, and the part above the tick is red.

function seriesFor(days, count) {
  const out = [];
  const now = new Date();
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    const key = dayKey(d.getTime());
    const e = days[key];
    out.push({ key, date: d, spent: e ? e.spent : null, budget: e && e.budget > 0 ? e.budget : null });
  }
  return out;
}

// Short date: "Oct 25" in English, "25/10" in Portuguese
function axisDate(d) {
  return I18N.getLang() === "pt-BR" ? `${pad(d.getDate())}/${pad(d.getMonth() + 1)}` : shortDate(d);
}

function shortDate(d) {
  return d.toLocaleDateString(I18N.locale(), { month: "short", day: "numeric" });
}

// The column chart. Each column is a stack of blocks (one block is 1% of the weekly limit, or 2, 5 or 10 when
// the busiest day is so high that single blocks would turn into hairlines). The blocks come from a mask of
// stripes, so one rectangle per day is enough. Sizes are in rem, so the chart grows with the rest of the app.
function drawDays(container, series, { onHover }) {
  container.textContent = "";
  const rem = remPx();
  const width = Math.max(container.clientWidth, 18 * rem);
  const height = Math.round((width < 30 * rem ? 12.5 : 15) * rem);
  const pl = 2.7 * rem, pr = 1.5 * rem, pt = 0.8 * rem, pb = 1.9 * rem;
  const ih = height - pt - pb, iw = width - pl - pr;
  const base = pt + ih;
  const maxSpent = Math.max(0, ...series.map((s) => Math.max(s.spent || 0, s.budget || 0))); // the tallest column or budget mark
  const maxVal = Math.max(10, Math.floor(maxSpent / 5) * 5 + 5);
  const unit = ih / maxVal;
  const block = [1, 2, 5, 10, 20].find((b) => unit * b >= 0.28 * rem) || 20; // blocks are at least 4.5px tall at 16px
  const gap = Math.max(1, rem * 0.1);
  const y = (v) => base - v * unit;
  const slot = iw / series.length;
  const bw = Math.max(Math.min(slot * 0.62, 2.1 * rem), 3);
  const svg = el("svg", { viewBox: `0 0 ${width} ${height}`, role: "img", "aria-label": t("history.chartAria", { n: series.length, total: pct(series.reduce((a, s) => a + (s.spent || 0), 0)) }) }, container);

  const mask = el("mask", { id: "histBlocks", maskUnits: "userSpaceOnUse", x: 0, y: 0, width, height }, el("defs", {}, svg));
  for (let k = 0; k * block < maxVal; k++) {
    el("rect", { x: 0, y: base - (k + 1) * unit * block + gap, width, height: unit * block - gap, fill: "#fff" }, mask);
  }

  const step = maxVal > 50 ? 20 : maxVal > 20 ? 10 : 5;
  for (let v = 0; v <= maxVal; v += step) {
    el("line", { x1: pl, x2: width - pr, y1: y(v), y2: y(v), class: `h-grid${v === 0 ? " is-base" : ""}` }, svg);
    el("text", { x: pl - 0.5 * rem, y: y(v) + 0.28 * rem, class: "axis", "text-anchor": "end" }, svg).textContent = `${v}%`;
  }

  const todayKey = dayKey(Date.now());
  // Labels keep a minimum gap; next to "today" the others are hidden so they never overlap
  const MIN_GAP = 3.4 * rem;
  const labelEvery = Math.max(1, Math.ceil(MIN_GAP / slot));
  const todayIdx = series.findIndex((s) => s.key === todayKey);
  const stack = el("g", { mask: "url(#histBlocks)" }, svg);
  series.forEach((s, i) => {
    const cx = pl + slot * i + slot / 2;
    const isToday = s.key === todayKey;
    let top = base;
    if (s.spent === null) {
      el("rect", { x: cx - bw / 2, y: base - 2, width: bw, height: 2, class: "h-none" }, svg);
    } else if (s.spent <= 0) {
      el("rect", { x: cx - bw / 2, y: base - 2, width: bw, height: 2, class: "h-zero" }, svg);
    } else {
      const blocks = Math.min(Math.max(1, Math.round(s.spent / block)) * block, maxVal);
      top = y(blocks);
      // Up to the budget the column keeps its own color; what goes past it is red
      const cut = s.budget !== null && y(Math.min(s.budget, maxVal)) > top ? y(Math.min(s.budget, maxVal)) : null;
      const low = cut === null ? top : cut;
      el("rect", { x: cx - bw / 2, y: low, width: bw, height: base - low, class: isToday ? "h-today" : "h-use" }, stack);
      if (cut !== null) el("rect", { x: cx - bw / 2, y: top, width: bw, height: cut - top, class: "h-over" }, stack);
    }
    if (s.budget !== null) {
      // The day's budget: a white tick across the column
      const by = y(Math.min(s.budget, maxVal));
      el("rect", { x: cx - bw / 2 - 0.3 * rem, y: by - 1, width: bw + 0.6 * rem, height: 2, class: "h-budget" }, svg);
    }
    const nearToday = todayIdx >= 0 && !isToday && Math.abs(todayIdx - i) * slot < MIN_GAP;
    const fromEnd = series.length - 1 - i; // counted from today, so "today" always lands on the label rhythm
    if (isToday || (fromEnd % labelEvery === 0 && !nearToday)) {
      const label = el("text", { x: cx, y: height - 0.45 * rem, class: `axis${isToday ? " td" : ""}`, "text-anchor": "middle" }, svg);
      label.textContent = isToday ? t("chart.today") : axisDate(s.date);
    }
    if (onHover) {
      const hit = el("rect", { x: pl + slot * i, y: pt, width: slot, height: ih, class: "hit" }, svg);
      hit.addEventListener("mouseenter", () => onHover(s, cx, top, width));
      hit.addEventListener("mouseleave", () => onHover(null));
    }
  });
  return block;
}

function showTip(tip, chart, s, x, topY, svgWidth) {
  if (!s) {
    tip.classList.add("hidden");
    return;
  }
  tip.textContent = "";
  const b = document.createElement("b");
  b.textContent = s.date.toLocaleDateString(I18N.locale(), { weekday: "long", month: "short", day: "numeric" });
  const line = (text) => {
    const row = document.createElement("span");
    row.textContent = text;
    return row;
  };
  tip.append(b, line(s.spent === null ? t("tip.none") : t("tip.spent", { spent: pct(s.spent) })));
  if (s.budget !== null) tip.append(line(t("tip.budget", { budget: pct(s.budget) })));
  tip.classList.remove("hidden");
  // Centered over the column, then kept inside the screen it sits on
  const box = $("chartBox");
  const k = chart.clientWidth / svgWidth;
  const half = tip.offsetWidth / 2;
  const left = Math.min(Math.max(chart.offsetLeft + x * k, half + 4), box.clientWidth - half - 4);
  tip.style.left = `${left}px`;
  tip.style.top = `${Math.max(chart.offsetTop + topY * k - tip.offsetHeight - 6, 4)}px`;
}

let histSeries = [];
function renderDays() {
  histSeries = seriesFor(mergedDays(), state.range);
  const withData = histSeries.filter((s) => s.spent !== null);
  const empty = !withData.length;
  $("statsBox").classList.toggle("hidden", empty);
  $("chartBox").classList.toggle("hidden", empty);
  $("daysEmpty").classList.toggle("hidden", !empty);
  $("daysEmptyText").textContent = t("history.empty", { n: state.range });
  document.querySelectorAll(".rk").forEach((b) => {
    const on = Number(b.dataset.range) === state.range;
    b.classList.toggle("on", on);
    b.setAttribute("aria-pressed", String(on));
  });
  if (empty) return;

  const total = withData.reduce((a, s) => a + s.spent, 0);
  const top = withData.reduce((best, s) => (!best || s.spent > best.spent ? s : best), null);
  const cells = [
    [pct(total), "", t("stat.total", { n: state.range })],
    [pct(total / withData.length), "", t("stat.avg")],
    [String(withData.length), t("stat.of", { n: state.range }), t("stat.activeDays")],
    [pct(top.spent), "", t("stat.busiestOn", { date: axisDate(top.date) })],
  ];
  const stats = $("stats");
  stats.textContent = "";
  for (const [value, small, label] of cells) {
    const cell = document.createElement("div");
    cell.className = "stat";
    const big = document.createElement("span");
    big.className = "big";
    big.textContent = value;
    if (small) {
      const sm = document.createElement("small");
      sm.textContent = small;
      big.appendChild(sm);
    }
    const lab = document.createElement("span");
    lab.className = "lab";
    lab.textContent = label;
    cell.append(big, lab);
    stats.appendChild(cell);
  }
  drawChart();
}

function drawChart() {
  if (!histSeries.some((s) => s.spent !== null)) return;
  const chart = $("chart");
  const tip = $("tooltip");
  tip.classList.add("hidden");
  const block = drawDays(chart, histSeries, { onHover: (s, x, topY, w) => showTip(tip, chart, s, x, topY, w) });
  $("legBlock").textContent = t("history.legBlock", { n: block });
}

function renderHistory() {
  renderDays();
  renderWeeks();
  renderSessionMap();
}

// The chart is drawn at the width it has, so it is drawn again when that changes (window resized, fonts loaded)
let chartWidth = 0;
new ResizeObserver(() => {
  const w = $("chart").clientWidth;
  if (w && Math.abs(w - chartWidth) > 1) {
    chartWidth = w;
    if (state.view === "history") drawChart();
  }
}).observe($("chart"));

// Previous weeks

function keyToMs(k) {
  const [y, mo, d] = k.split("-").map(Number);
  return new Date(y, mo - 1, d).getTime();
}

// Summary of the week that ended at endReset (whole days; the reset day belongs to the new week)
function weekSummary(endReset) {
  const from = startOfDay(endReset - WEEK);
  const to = startOfDay(endReset);
  let used = 0, top = null, active = 0;
  for (const [k, v] of Object.entries(mergedDays())) {
    const ms = keyToMs(k);
    if (ms < from || ms >= to) continue;
    active++;
    if (typeof v.endUsed === "number") used = Math.max(used, v.endUsed);
    if (!top || v.spent > top.spent) top = { ms, spent: v.spent };
  }
  return active ? { start: endReset - WEEK, end: endReset, used, top, active } : null;
}

function currentReset() {
  const src = pickSource();
  if (!src) return null;
  const r = src.data.weekly.resetsAt;
  return r > Date.now() ? r : nextReset(r);
}

// Hour of day when the 5-hour sessions start
function renderSessionMap() {
  const box = $("sessionMap");
  const note = $("mapNote");
  box.textContent = "";
  const used = ((state.settings && state.settings.sessions) || []).filter((x) => x.peak > 0);
  const ready = used.length >= MAP_MIN_SESSIONS;
  const counts = new Array(24).fill(0);
  if (ready) for (const x of used) counts[new Date(x.sr - 5 * HOUR).getHours()]++;
  const max = Math.max(...counts);
  const best = ready ? counts.indexOf(max) : -1;
  const hh = (h) => String(h).padStart(2, "0");

  if (ready) {
    const lab = document.createElement("span");
    lab.className = "mtop";
    lab.style.setProperty("--at", `${((best + 0.5) / 24) * 100}%`);
    lab.textContent = t("map.top", { hour: hh(best) });
    box.appendChild(lab);
  }
  const cols = document.createElement("div");
  cols.className = "mcols";
  counts.forEach((n, h) => {
    const col = document.createElement("div");
    col.className = "mc" + (h === best ? " is-top" : "") + (n ? "" : " is-zero");
    if (ready) col.title = t("map.tip", { hour: hh(h), n });
    const bar = document.createElement("span");
    bar.className = "mbar";
    const fill = document.createElement("i");
    if (n) fill.style.height = `${Math.max(8, (n / max) * 100)}%`;
    bar.appendChild(fill);
    const lab = document.createElement("span");
    lab.className = "mlab";
    lab.textContent = h % 3 === 0 ? hh(h) : "";
    col.append(bar, lab);
    cols.appendChild(col);
  });
  box.appendChild(cols);
  note.textContent = ready ? t("map.text", { hour: hh(best), n: used.length }) : t("map.need", { have: used.length, need: MAP_MIN_SESSIONS });
}

function renderWeeks() {
  const box = $("weeks");
  box.textContent = "";
  box.classList.remove("hempty");
  const R = currentReset();
  const list = [];
  if (R) for (let k = 1; k <= 4; k++) {
    const s = weekSummary(R - k * WEEK);
    if (s) list.push(s);
  }
  if (!list.length) {
    box.classList.add("hempty");
    const none = document.createElement("span");
    none.className = "lv lv-none";
    const shp = document.createElement("span");
    shp.className = "shp";
    const word = document.createElement("span");
    word.textContent = t("level.none.name");
    none.append(shp, word);
    const text = document.createElement("span");
    text.className = "mu";
    text.textContent = t("weeks.none");
    box.append(none, text);
    return;
  }
  for (const s of list) {
    const row = document.createElement("div");
    row.className = "wrow";
    const top = document.createElement("div");
    top.className = "wtop";
    const range = document.createElement("span");
    range.className = "plate";
    range.textContent = t("weeks.range", { start: axisDate(new Date(s.start)), end: axisDate(new Date(s.end)) });
    const used = document.createElement("span");
    used.className = "mid-num";
    used.textContent = pct(s.used);
    top.append(range, used);
    const bar = document.createElement("span");
    bar.className = "sbar";
    bar.setAttribute("aria-hidden", "true");
    bar.style.setProperty("--fill", `${Math.min(s.used, 100)}%`);
    const tr = document.createElement("span");
    tr.className = "tr";
    const fill = document.createElement("i");
    fill.className = "fill";
    tr.appendChild(fill);
    bar.appendChild(tr);
    row.append(top, bar);
    if (s.top) {
      const cap = document.createElement("span");
      cap.className = "cap";
      cap.textContent = t("weeks.busiest", { date: shortWeekday(new Date(s.top.ms)), pct: pct(s.top.spent) });
      row.appendChild(cap);
    }
    box.appendChild(row);
  }
}

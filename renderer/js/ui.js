// Small DOM helpers shared by the Overview blocks

const r0 = (n) => String(Math.round(n) || 0);
const clamp100 = (n) => Math.max(0, Math.min(100, n));
const LEVEL_CLASSES = ["lv-free", "lv-moderate", "lv-tight", "lv-pause", "lv-none", "lv-room", "lv-reserve"];

// "free", "moderate", "tight", "pause", or "none" for a block that cannot be rated yet
const lvKey = (level) => (level === null || level === undefined ? "none" : LEVEL_KEYS[level]);
const lvName = (level) => (level === null || level === undefined ? t("level.none.name") : levelName(level));

// Writes text only when it differs. For live regions (role="status"): rewriting the same words on
// every redraw (every 30 s) can make a screen reader announce them again.
function setText(elem, text) {
  if (elem.textContent !== text) elem.textContent = text;
}

// Writes a number. When a new reading changes it, it glows for a moment (.glow in crt.css; still with reduced motion).
// The first number written, over the "–" placeholder, does not glow.
// How much moves (Settings > Display > Motion): "full", "subtle" (only what explains a change) or "off". Windows asking
// for less motion (prefers-reduced-motion) makes it "off", whatever the setting.
const reducedMotionQuery = typeof window !== "undefined" && window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
function motionLevel() {
  if (reducedMotionQuery && reducedMotionQuery.matches) return "off";
  const m = typeof state !== "undefined" && state.settings && state.settings.motion;
  return m === "subtle" || m === "off" ? m : "full";
}

// A number that a new reading changed: it rolls to the new value (a whole number, with or without %), glows for a
// moment, and with data-delta the change floats up next to it ("+2%"). Off: it only changes.
const NUM_RE = /^(-?\d+)(%?)$/;
function setNum(elem, text) {
  const prev = elem.textContent;
  if (prev === text) return;
  if (elem._roll && typeof cancelAnimationFrame === "function") cancelAnimationFrame(elem._roll);
  const a = NUM_RE.exec(elem.dataset.num || prev);
  const b = NUM_RE.exec(text);
  elem.dataset.num = text;
  const roll = a && b && a[2] === b[2] && prev && prev !== "–" && motionLevel() !== "off" && typeof requestAnimationFrame === "function";
  if (roll) {
    const from = Number(a[1]);
    const to = Number(b[1]);
    const t0 = performance.now();
    const step = (now) => {
      const k = Math.min(1, (now - t0) / 650);
      elem.textContent = k < 1 ? `${Math.round(from + (to - from) * (1 - (1 - k) ** 3))}${b[2]}` : text;
      if (k < 1) elem._roll = requestAnimationFrame(step);
    };
    elem._roll = requestAnimationFrame(step);
  } else elem.textContent = text;
  if (!prev || prev === "–") return;
  elem.classList.remove("glow");
  void elem.offsetWidth; // restart the animation
  elem.classList.add("glow");
  if (elem.dataset.delta !== undefined && a && b && a[2] === b[2]) floatDelta(elem, Number(b[1]) - Number(a[1]), b[2]);
}
function floatDelta(elem, diff, suffix) {
  if (!diff || motionLevel() === "off" || !elem.parentElement) return;
  const f = node("span", "dfl", `${diff > 0 ? "+" : "-"}${Math.abs(diff)}${suffix}`);
  f.setAttribute("aria-hidden", "true");
  f.addEventListener("animationend", () => f.remove());
  elem.parentElement.append(f);
}

// lastStep for the numbers on screen: only when the last reading is what the bars show (a number typed in, or another
// source, is not in the log the same way)
function shownStep(m) {
  const list = (state.settings && state.settings.readings) || [];
  const step = lastStep(list, m.w && m.w.resetsAt ? m.w.resetsAt - WEEK : NaN);
  const same = (s, v) => (s && Number.isFinite(v) && Math.round(s.b) === Math.round(v) ? s : null);
  return { week: same(step.week, m.w && m.w.used), session: same(step.session, m.five && m.five.used) };
}

// What the last reading added, on a bar: that stretch lighter, with an edge, until the next reading (.ad inside the
// segments, the edge on .adh), and a
// small box over it with "+3%" for STEP_SHOW after a fresh reading. With the pointer on the stretch the box gives way to
// its tooltip, which also says when the reading before it was. The box lives on the body, so the well around the bar does
// not cut it.
const STEP_SHOW = 10000;
const STEP_MIN_W = 1.5; // % of the bar: a rise of a fraction of a point still shows
const steps = [];
function paintStep(bar, step, fresh) {
  const st = bar._step || (bar._step = makeStep(bar));
  st.step = step;
  bar.classList.toggle("has-ad", Boolean(step));
  if (!step) {
    setTip(st.hit, "plain");
    return stepHide(st);
  }
  const b = clamp100(step.b);
  const w = Math.min(b, Math.max(b - clamp100(step.a), STEP_MIN_W));
  bar.style.setProperty("--ad-l", `${b - w}%`);
  bar.style.setProperty("--ad-w", `${w}%`);
  setTip(st.hit, "step", `+${step.d}% · ${t("step.since", { time: fmtTime(step.since) })}`);
  if (fresh && !st.hover) stepShow(st);
  else if (st.pop.classList.contains("on")) stepShow(st);
}
function makeStep(bar) {
  const ad = node("i", "ad");
  ad.setAttribute("aria-hidden", "true");
  bar.querySelector(".tr").append(ad);
  // The pointer's target over the stretch: it carries the stretch's tooltip (paintStep)
  const hit = node("i", "adh");
  hit.dataset.tip = "plain";
  bar.append(hit);
  const pop = node("div", "dpop");
  pop.setAttribute("aria-hidden", "true");
  pop.append(node("b"), node("span"));
  document.body.append(pop);
  const st = { bar, hit, pop, step: null, timer: 0, hover: false };
  hit.addEventListener("pointerenter", () => { st.hover = true; stepHide(st); });
  hit.addEventListener("pointerleave", () => { st.hover = false; });
  steps.push(st);
  return st;
}
function stepShow(st) {
  clearTimeout(st.timer);
  if (!st.step || state.view !== "panel" || !st.hit.getClientRects().length) return stepHide(st);
  st.pop.firstChild.textContent = `+${st.step.d}%`;
  st.pop.lastChild.textContent = "";
  st.pop.classList.add("on");
  stepPlace(st);
  st.timer = setTimeout(() => stepHide(st), STEP_SHOW);
}
function stepHide(st) {
  clearTimeout(st.timer);
  st.timer = 0;
  st.pop.classList.remove("on");
}
// Centered over the stretch, or under it when there is no room above; kept inside the window, the arrow on the stretch
function stepPlace(st) {
  const r = st.hit.getBoundingClientRect();
  const w = st.pop.offsetWidth;
  const h = st.pop.offsetHeight;
  const cx = r.left + r.width / 2;
  const left = Math.min(Math.max(cx - w / 2, 4), innerWidth - w - 4);
  let top = r.top - h - 5;
  const above = top >= 4;
  if (!above) top = r.bottom + 5;
  st.pop.classList.toggle("below", !above);
  st.pop.style.left = `${left}px`;
  st.pop.style.top = `${top}px`;
  st.pop.style.setProperty("--ax", `${Math.min(Math.max(cx - left, 6), w - 6)}px`);
}
if (typeof addEventListener === "function") addEventListener("resize", () => steps.forEach((st) => st.pop.classList.contains("on") && stepPlace(st)));

function node(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

// Gives an element the color and shape of a level (circle, diamond, triangle, square, or dashed for "not rated")
function setLevelClass(elem, level) {
  elem.classList.remove(...LEVEL_CLASSES);
  elem.classList.add(`lv-${lvKey(level)}`);
}

// Fills a level mark: <span class="lv"><span class="shp"></span><span class="lvn"></span></span>
function paintLevel(elem, level, label) {
  setLevelClass(elem, level);
  elem.querySelector(".lvn").textContent = label === undefined ? lvName(level) : label;
}

// Segmented bar. Values are percentages of the bar: how far it is filled, how much of that fill is
// over the limit (drawn red at the end), and where the white tick sits. grow: false for a bar that moves with the
// clock, not with use (the session's time).
function setBar(bar, { fill, over = 0, tick = null, grow = true }) {
  const to = clamp100(fill);
  const from = parseFloat(bar.style.getPropertyValue("--fill"));
  if (grow && barGrow && Number.isFinite(from) && to - from >= 0.5) growBar(bar, from, to);
  bar.style.setProperty("--fill", `${to}%`);
  bar.style.setProperty("--ov", `${clamp100(over)}%`);
  const mark = bar.querySelector(".tick");
  if (mark) {
    mark.classList.toggle("hidden", tick === null);
    if (tick !== null) bar.style.setProperty("--tx", `${clamp100(tick)}%`);
  }
}

// A reading close to the last one (render.js sets barGrow while it draws): what was there stays still and only the
// part it added lights up, segment by segment, then takes the bar's color (.nw in crt.css)
let barGrow = false;
const BAR_SEG = 5; // a bar has 20 segments
function growBar(bar, from, to) {
  const tr = bar.querySelector(".tr");
  if (!tr || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const k = Math.max(1, Math.ceil(to / BAR_SEG) - Math.floor(from / BAR_SEG));
  const ms = Math.min(700, 140 * k);
  clearTimeout(bar._growT);
  tr.querySelectorAll(".nw").forEach((n) => n.remove());
  bar.style.setProperty("--g0", `${from}%`);
  bar.style.setProperty("--gw", `${to - from}%`);
  bar.style.setProperty("--gk", String(k));
  bar.style.setProperty("--gd", `${ms}ms`);
  bar.classList.add("grow");
  const nw = node("i", "nw");
  nw.setAttribute("aria-hidden", "true");
  tr.append(nw);
  bar._growT = setTimeout(() => {
    nw.remove();
    bar.classList.remove("grow");
  }, ms + 800);
}

// Bars that can pass their limit (today, the days of the week) use a 125% scale, with the limit at 80% of the bar
const OVER_SCALE = 1.25;
// Where a day's spend sits on its bar: how full it is, how much of that is over the budget, and where the budget mark goes
// The red part follows the ratio as shown, so a day shown at 100% has none
function budgetBarValues(ratio) {
  const used = Math.max(asShownRatio(ratio), 0);
  return { fill: (Math.min(used, OVER_SCALE) / OVER_SCALE) * 100, over: (Math.min(Math.max(used - 1, 0), OVER_SCALE - 1) / OVER_SCALE) * 100, tick: 100 / OVER_SCALE };
}

function budgetBar(bar, ratio) {
  setBar(bar, budgetBarValues(ratio));
}

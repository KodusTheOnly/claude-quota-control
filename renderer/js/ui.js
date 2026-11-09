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
// over the limit (drawn red at the end), and where the white tick sits.
function setBar(bar, { fill, over = 0, tick = null }) {
  bar.style.setProperty("--fill", `${clamp100(fill)}%`);
  bar.style.setProperty("--ov", `${clamp100(over)}%`);
  const mark = bar.querySelector(".tick");
  if (mark) {
    mark.classList.toggle("hidden", tick === null);
    if (tick !== null) bar.style.setProperty("--tx", `${clamp100(tick)}%`);
  }
  // The label under the mark keeps its arrow exactly under the mark; the words extend toward the roomier side
  const label = bar.querySelector(".bl");
  if (label) label.classList.toggle("rt", tick !== null && tick < 50);
}

// Writes a label under the white mark: an arrow that sits under the mark, then the words ("14%", or "4% budget limit")
function setBarLabel(label, text, word) {
  label.replaceChildren();
  if (!text) return;
  const words = node("span", "tx", text);
  if (word) words.append(node("i", "bwd", word));
  label.append(node("i", "ar", "▲"), words);
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

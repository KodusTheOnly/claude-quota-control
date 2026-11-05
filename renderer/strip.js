// Taskbar strip: draws the Today row of the summary the main window computes (see publishSummary in js/tray.js).
//   [refresh] | TODAY <shape> 25% [OVER] | ten-segment bar with the budget mark | [open the card]
const api = window.quota;
const $ = (id) => document.getElementById(id);
const t = I18N.t;

const LEVEL_CLASSES = ["lv-free", "lv-moderate", "lv-tight", "lv-pause", "lv-none"];
let errTimer = null;

function setKey(elem, key) {
  elem.classList.remove(...LEVEL_CLASSES);
  elem.classList.add(`lv-${key}`);
}

function render(s) {
  if (!s) return;
  if (s.lang && s.lang !== I18N.getLang()) {
    I18N.setLang(s.lang);
    I18N.applyStatic();
    document.documentElement.lang = s.lang;
  }

  // A failed refresh (offline, signed out...) shows on the key for a few seconds
  const failed = Boolean(s.msg && s.msg.kind === "error");
  $("refresh").classList.toggle("err", failed);
  $("refresh").classList.toggle("busy", Boolean(s.syncing));
  $("refresh").title = failed ? s.msg.text : t("strip.refresh");
  clearTimeout(errTimer);
  if (failed) {
    errTimer = setTimeout(() => {
      $("refresh").classList.remove("err");
      $("refresh").title = t("strip.refresh");
    }, 10000);
  }
  $("more").title = t("strip.more");

  const today = s.hasData ? s.rows.find((r) => r.kind === "today") : null;
  const reading = Boolean(s.syncing);
  const rated = Boolean(today && today.key !== "none" && !today.off);
  const key = today ? today.key : "none";
  setKey($("today"), key);
  setKey($("todayBar"), key);
  $("todayLabel").textContent = t("strip.today");
  $("todayShape").classList.toggle("hidden", reading);

  // What the strip says: reading, the day's room left, or "not rated" when there is nothing to rate
  let value;
  let flag = "";
  if (reading) value = t("strip.reading");
  else if (!today) {
    value = "–";
    flag = t("level.none.name");
  } else if (today.off) {
    value = "–";
    flag = t("day.off");
  } else {
    value = today.short;
    if (today.isOver) flag = t("strip.over");
  }
  $("todayValue").textContent = value;
  $("todayFlag").textContent = flag;
  $("todayFlag").classList.toggle("hidden", !flag);

  // The bar is today's budget: filled to what was spent, the white mark at the budget
  const showBar = rated && !reading;
  $("todayBar").classList.toggle("hidden", !showBar);
  if (showBar) {
    $("todayBar").style.setProperty("--fill", `${today.fill}%`);
    $("todayBar").style.setProperty("--ov", `${today.over}%`);
    $("todayBar").style.setProperty("--tx", `${today.tick}%`);
  }

  const tip = today ? `${s.head.name}\n${s.rows.map((r) => `${r.label}: ${r.text}`).join("\n")}` : t("pop.empty");
  $("pill").title = tip;
  $("pill").setAttribute("aria-label", tip.replace(/\n/g, ", "));

  // Measure at natural width, then let the pill fill the window again
  const pill = $("pill");
  pill.style.minWidth = "0";
  const natural = Math.ceil(pill.getBoundingClientRect().width);
  pill.style.minWidth = "";
  api.stripResize(natural);
}

api.getSummary().then(render);
api.onSummary(render);

// Drag to move; a press that barely moves counts as a click
let press = null;
let dragged = false;
$("pill").addEventListener("mousedown", (e) => {
  if (e.button !== 0 || e.target.closest("button")) return;
  press = { x: e.screenX, y: e.screenY };
  dragged = false;
  api.stripDrag("start", press.x, press.y);
});
window.addEventListener("mousemove", (e) => {
  if (!press) return;
  if (!dragged && Math.hypot(e.screenX - press.x, e.screenY - press.y) < 4) return;
  dragged = true;
  api.stripDrag("move", e.screenX, e.screenY);
});
window.addEventListener("mouseup", () => {
  if (!press) return;
  press = null;
  api.stripDrag("end");
});
$("refresh").addEventListener("click", () => api.stripAction("refresh"));
$("more").addEventListener("click", () => api.stripAction("toggle"));
// A plain click on the pill (not on a button, not the end of a drag) refreshes
$("pill").addEventListener("click", (e) => {
  if (!dragged && !e.target.closest("button")) api.stripAction("refresh");
});
$("pill").addEventListener("dblclick", (e) => {
  if (!dragged && !e.target.closest("button")) api.stripAction("open");
});
$("pill").addEventListener("contextmenu", (e) => {
  e.preventDefault();
  api.stripAction("menu");
});

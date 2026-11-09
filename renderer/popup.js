// Tray card: only draws the summary the main window computes (see publishSummary in js/tray.js).
const $ = (id) => document.getElementById(id);
const api = window.quota;
const t = I18N.t;
let lastHeight = 0;

const LEVEL_CLASSES = ["lv-free", "lv-moderate", "lv-tight", "lv-pause", "lv-none"];

// Writes text only when it differs, so the live regions (role="status") are not announced again on every summary
function setText(elem, text) {
  if (elem.textContent !== text) elem.textContent = text;
}

function node(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

// A level is a color, a shape and a word: the key picks the first two, the word is written next to them
function setKey(elem, key) {
  elem.classList.remove(...LEVEL_CLASSES);
  elem.classList.add(`lv-${key}`);
}

function levelMark(key, name) {
  const mark = node("span", `lv lv-${key}`);
  mark.append(node("span", "shp"), node("span", "lvn", name));
  return mark;
}

// Segmented bar, same parts as the Overview (see setBar in js/ui.js)
function barNode(row) {
  const bar = node("div", "sbar");
  bar.setAttribute("role", "img");
  bar.setAttribute("aria-label", `${row.label}: ${row.text}`);
  const track = node("div", "tr");
  track.append(node("i", "fill"), node("i", "ov"));
  bar.appendChild(track);
  bar.style.setProperty("--fill", `${row.fill}%`);
  bar.style.setProperty("--ov", `${row.over}%`);
  if (row.tick !== null && row.tick !== undefined) {
    bar.appendChild(node("b", "tick"));
    bar.style.setProperty("--tx", `${row.tick}%`);
  }
  return bar;
}

function rowNode(row) {
  const wrap = node("div", `prow lv-${row.key}`);
  const top = node("div", "prow-top");
  top.append(node("span", "plate", row.label), node("span", "mid-num", row.text));
  if (row.levelName) top.appendChild(levelMark(row.key, row.levelName));
  wrap.appendChild(top);
  if (!row.off) wrap.appendChild(barNode(row));
  if (row.caption) wrap.appendChild(node("div", "cap", row.caption));
  return wrap;
}

function render(s) {
  if (!s) return;
  if (s.lang && s.lang !== I18N.getLang()) {
    I18N.setLang(s.lang);
    I18N.applyStatic();
    document.documentElement.lang = s.lang;
  }
  document.documentElement.dataset.theme = s.dark ? "dark" : "light";
  document.documentElement.dataset.screens = s.paper ? "paper" : "crt";
  $("card").classList.toggle("is-stale", Boolean(s.notice));

  // The state of the data
  setKey($("lamp"), s.lamp.key);
  $("lamp").classList.toggle("is-updating", Boolean(s.syncing));
  setText($("lampText"), s.lamp.text);

  // Old or offline: say so above the numbers; a refresh result shows below it
  $("notice").classList.toggle("hidden", !s.notice);
  if (s.notice) setText($("notice"), s.notice.text);
  const msg = $("msg");
  msg.classList.toggle("hidden", !s.msg);
  if (s.msg) {
    setText(msg, s.msg.text);
    msg.classList.toggle("is-error", s.msg.kind === "error");
  }

  // The verdict and the three bars
  $("empty").classList.toggle("hidden", s.hasData);
  $("body").classList.toggle("hidden", !s.hasData);
  if (s.hasData) {
    setKey($("verdict"), s.head.key);
    $("vPct").textContent = s.head.pct;
    $("vWhen").textContent = s.head.when;
    $("vAns").textContent = s.head.answer;
    $("vFace").textContent = s.head.face;
    setKey($("vLevel"), s.head.key);
    $("vLevel").querySelector(".lvn").textContent = s.head.name;
    const rows = $("rows");
    rows.textContent = "";
    s.rows.forEach((row) => rows.appendChild(rowNode(row)));
  }

  // Keys: refresh when an account is connected, otherwise go and type the numbers in
  $("popSync").classList.toggle("hidden", !s.connected);
  $("popSync").disabled = Boolean(s.syncing);
  $("popSync").classList.toggle("is-busy", Boolean(s.syncing));
  $("popSyncText").textContent = s.syncing ? t("pop.refreshing") : t("pop.sync");
  $("typeKey").classList.toggle("hidden", s.connected);
  $("typeLink").classList.toggle("hidden", !s.connected);
  $("updated").textContent = s.hasData ? s.updated : "";
  $("meta").classList.toggle("hidden", !s.hasData && !s.connected);

  fitWindow();
}

// The window follows the height of the card: after every summary, and again when the fonts arrive or the text wraps differently
function fitWindow() {
  const h = Math.ceil($("card").getBoundingClientRect().height);
  if (h && h !== lastHeight && api.popupResize) {
    lastHeight = h;
    api.popupResize(h);
  }
}
new ResizeObserver(fitWindow).observe($("card"));

$("popSync").addEventListener("click", () => api.popupAction("sync"));
$("typeKey").addEventListener("click", () => api.popupAction("type"));
$("typeLink").addEventListener("click", () => api.popupAction("type"));
$("openBtn").addEventListener("click", () => api.popupAction("open"));
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") api.popupAction("close");
});

if (api) {
  api.onSummary(render);
  api.getSummary().then(render);
}

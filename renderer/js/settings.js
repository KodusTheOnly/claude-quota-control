// Forms

$("setupForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const weekly = readNumber($("sUsed"));
  const anchor = new Date($("sReset").value).getTime();
  // Say what is wrong instead of doing nothing (the date field is required, so the browser already flags an empty one)
  if (weekly === null || Number.isNaN(weekly)) {
    toast(t("q.invalid"), "error");
    $("sUsed").focus();
    return;
  }
  if (Number.isNaN(anchor)) return;
  await saveManual({ weekly, anchor });
  hideError(); // the numbers are in: an earlier "enter a number" no longer applies
});

$("anchorForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const anchor = new Date($("aReset").value).getTime();
  if (Number.isNaN(anchor)) return;
  const manual = state.settings.manual;
  if (manual && manual.weekly) {
    manual.anchor = anchor;
    manual.anchorVia = "manual";
    manual.weekly.resetsAt = nextReset(anchor);
    state.settings = await api.setSettings({ manual });
  } else {
    state.settings = await api.setSettings({ manual: { ...(manual || {}), anchor, anchorVia: "manual" } });
  }
  toast(t("anchor.saved", { when: fmtWhen(nextReset(anchor)) }));
  render();
});

$("manualClear").addEventListener("click", async () => {
  if (!confirm(t("data.confirm"))) return;
  state.settings = await api.clearData(); // the main process keeps a copy in backups/ first
  $("aReset").value = "";
  render();
});

// Export and import

async function runTransfer(action, kind) {
  const res = await action();
  if (!res || res.canceled) return;
  if (res.ok) {
    state.settings = await api.getSettings();
    // A backup can bring another language and theme: the main process already switched, the window follows
    applyLanguage();
    applyTheme();
    bindSettings();
    bindAccount();
    refreshCollector();
    render();
    toast(kind === "import" ? t("data.imported", { n: res.readings }) : t("data.exported"));
  } else {
    toast(t("data.failed"), "error");
  }
}
$("exportJson").addEventListener("click", () => runTransfer(() => api.exportData("json"), "export"));
$("exportCsv").addEventListener("click", () => runTransfer(() => api.exportData("csv"), "export"));
$("importData").addEventListener("click", () => runTransfer(() => api.importData(), "import"));

// A group of keys where exactly one is chosen (role="radiogroup"): Theme and Language.
// Arrow keys move and choose, like native radio buttons, and only the chosen key is in the tab order.
function setChoice(group, value) {
  group.querySelectorAll('[role="radio"]').forEach((key) => {
    const on = key.dataset.value === value;
    key.setAttribute("aria-checked", String(on));
    key.classList.toggle("on", on);
    key.tabIndex = on ? 0 : -1;
  });
}

function bindChoice(group, onPick) {
  const keys = () => [...group.querySelectorAll('[role="radio"]')];
  group.addEventListener("click", (e) => {
    const key = e.target.closest('[role="radio"]');
    if (key && key.getAttribute("aria-checked") !== "true") onPick(key.dataset.value);
  });
  group.addEventListener("keydown", (e) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (!step) return;
    e.preventDefault();
    const all = keys();
    const next = all[(all.indexOf(document.activeElement) + step + all.length) % all.length];
    next.focus();
    onPick(next.dataset.value);
  });
}

// Theme: light, dark, or the system's. The main process recolors the title bar buttons to match.

const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");
function applyTheme() {
  const choice = (state.settings && state.settings.theme) || "dark";
  const dark = choice === "dark" || (choice === "system" && darkQuery.matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  // The data screens: light paper (the default, light theme only: the dark theme shows CRT then), CRT, or a CRT with an
  // amber or green phosphor (either theme)
  const sc = state.settings && state.settings.screens;
  document.documentElement.dataset.screens = sc === "amber" || sc === "green" ? sc : !dark && sc !== "crt" ? "paper" : "crt";
  document.documentElement.dataset.motion = motionLevel();
}
// The chart is drawn with the screen colors, so a change of the system theme draws it again
darkQuery.addEventListener("change", () => {
  applyTheme();
  render();
});
bindChoice($("theme"), async (value) => {
  state.settings = await api.setSettings({ theme: value });
  setChoice($("theme"), value);
  applyTheme();
  render();
});
if (reducedMotionQuery) reducedMotionQuery.addEventListener("change", applyTheme); // Windows asks for less motion, or no longer
bindChoice($("motion"), async (value) => {
  state.settings = await api.setSettings({ motion: value });
  setChoice($("motion"), value);
  applyTheme();
  render();
});
bindChoice($("screens"), async (value) => {
  state.settings = await api.setSettings({ screens: value });
  setChoice($("screens"), value);
  applyTheme();
  render();
});

// Language

// Applies the saved language: static HTML text and the strings that depend on a count
function applyLanguage() {
  I18N.setLang(state.settings && state.settings.language);
  I18N.applyStatic();
  document.querySelectorAll("#remindEvery option[data-hours]").forEach((o) => {
    o.textContent = t("alerts.every", { n: o.dataset.hours });
  });
  document.querySelectorAll(".rk").forEach((b) => {
    b.textContent = t("history.days", { n: b.dataset.range });
  });
  if (state.view === "about") renderAbout();
  if (state.view === "help") {
    renderHelpCalc();
    renderHelpTiles();
  }
}

// About

let appInfo = null;
async function renderAbout() {
  if (!appInfo && api && api.appInfo) appInfo = await api.appInfo();
  const info = appInfo || {};
  const parts = [];
  if (info.version) parts.push(t("about.version", { v: info.version }));
  if (info.electron) parts.push(t("about.electron", { e: info.electron }));
  $("aboutVersion").textContent = parts.join(" · ");
  renderUpdate();
}

// Updates (updater.js), only on a click. The line on the nameplate screen says UPDATE, the result of the last click and
// when a check last worked. When a check finds a version the app can install, "Update to X" downloads and installs it
// (the app quits and opens again); otherwise the link opens the release on GitHub to download by hand.
// upd.phase: idle, checking, result (upd.res), downloading (upd.pct), installing, installFail
const upd = { phase: "idle", res: null, pct: 0 };

function updateLink(href, key) {
  const a = document.createElement("a");
  a.href = href;
  a.target = "_blank";
  a.rel = "noopener";
  a.textContent = t(key);
  return a;
}

function renderUpdate() {
  const out = $("updateResult");
  const res = upd.res;
  const busy = upd.phase === "checking" || upd.phase === "downloading" || upd.phase === "installing";
  out.textContent = "";
  if (upd.phase === "checking") out.textContent = t("about.checking");
  else if (upd.phase === "downloading") out.textContent = t("about.downloading", { v: res.version, pct: upd.pct });
  else if (upd.phase === "installing") out.textContent = t("about.installing", { v: res.version });
  else if (upd.phase === "installFail") out.append(`${t("about.installFail")} `, updateLink(res.url, "about.download"));
  else if (upd.phase === "result") {
    if (res.status === "newer") out.append(`${t("about.newer", { v: res.version })} `, updateLink(res.url, res.canInstall ? "about.notes" : "about.download"));
    else if (res.status === "latest") out.textContent = t("about.latest");
    else if (res.status === "none") out.textContent = t("about.noReleases");
    else out.textContent = t("about.updateFail");
  }
  const last = state.settings && state.settings.lastUpdateCheck;
  $("updateWhen").textContent = busy ? "" : last ? t("about.lastChecked", { ago: ago(last) }) : t("about.neverChecked");
  const install = $("updateInstallBtn");
  const canInstall = res && res.status === "newer" && res.canInstall && upd.phase !== "idle" && upd.phase !== "checking";
  install.classList.toggle("hidden", !canInstall);
  if (canInstall) install.textContent = t("about.install", { v: res.version });
  install.disabled = busy;
  $("updateBtn").disabled = busy;
}

$("updateBtn").addEventListener("click", async () => {
  upd.phase = "checking";
  renderUpdate();
  const res = await api.checkUpdate();
  if (res.checkedAt && state.settings) state.settings.lastUpdateCheck = res.checkedAt;
  upd.res = res;
  upd.phase = "result";
  renderUpdate();
});

$("updateInstallBtn").addEventListener("click", async () => {
  upd.phase = "downloading";
  upd.pct = 0;
  renderUpdate();
  const r = await api.installUpdate();
  if (r.status === "installing") upd.phase = "installing";
  else {
    upd.phase = "installFail";
    if (r.url) upd.res = { ...upd.res, url: r.url };
  }
  renderUpdate();
});

if (api && api.onUpdateProgress) {
  api.onUpdateProgress((pct) => {
    if (upd.phase !== "downloading") return;
    upd.pct = pct;
    renderUpdate();
  });
}

// Settings

async function refreshCollector() {
  if (!api) return;
  const st = await api.collectorStatus();
  const chip = $("collectorChip");
  const note = $("collectorNote");
  note.classList.add("hidden");
  if (st.installed) {
    setLevelClass(chip, 0);
    $("collectorText").textContent = t("coll.on");
    $("installBtn").textContent = t("coll.reinstall");
    $("uninstallBtn").classList.remove("hidden");
    if (st.chained) {
      note.textContent = t("coll.chained");
      note.classList.remove("hidden");
    }
  } else {
    setLevelClass(chip, null);
    $("collectorText").textContent = t("coll.off");
    $("installBtn").textContent = t("coll.install");
    $("uninstallBtn").classList.add("hidden");
    if (st.otherCommand) {
      note.textContent = t("coll.other");
      note.classList.remove("hidden");
    }
  }
  if (!st.node) {
    note.textContent = t("coll.noNode");
    note.classList.remove("hidden");
  }
}

$("installBtn").addEventListener("click", async () => {
  const btn = $("installBtn");
  btn.disabled = true;
  const res = await api.installCollector();
  btn.disabled = false;
  if (res.ok) toast(t("coll.installedOk"));
  else toast(res.error, "error");
  refreshCollector();
});

$("uninstallBtn").addEventListener("click", async () => {
  const res = await api.uninstallCollector();
  if (res.ok) toast(t("coll.removedOk"));
  else toast(res.error, "error");
  refreshCollector();
});

// With notifications off, the individual switches have nothing to control
function syncNotifyGroup() {
  const on = $("notifyAll").checked;
  // The two selects only matter for notifications too: with them off, nothing they set is ever shown
  for (const id of ["notifyLevel", "notifyResets", "notifySpikes", "notifyExtra", "notifyNoReading", "fiveHourThreshold", "remindEvery"]) {
    $(id).disabled = !on;
    $(id).closest(".set").classList.toggle("is-disabled", !on);
  }
}

// The weekly plan: a switch to follow the usual week (applyAutoWeights in plan-menu.js), and what it does now
function renderAutoWeightsSettings() {
  const on = Boolean(state.settings && state.settings.autoWeights);
  $("autoWeights").checked = on;
  const note = $("autoWeightsNow");
  const m = lastM;
  let text = "";
  if (on && m) {
    const sug = suggestWeights(m.learn);
    const n = m.learn ? m.learn.n : 0;
    text = sug ? t("plan.autoNow", { list: planText(sug, m.week), n }) : t("plan.autoWait", { n, need: SUGGEST_MIN_WEEKS });
  }
  note.textContent = text;
  note.classList.toggle("hidden", !text);
}
$("autoWeights").addEventListener("change", async (e) => {
  await saveSetting({ autoWeights: e.target.checked });
  renderAutoWeightsSettings();
});

// Active hours: a switch and two hour lists. Turned on, the window starts at ACTIVE_DEFAULT (see core.js).
// The two lists never show the same hour on both sides: a window needs some length.
function renderActiveSettings() {
  const a = activeHours();
  $("activeOn").checked = Boolean(a);
  $("activeFromSet").classList.toggle("hidden", !a);
  $("activeToSet").classList.toggle("hidden", !a);
  if (!a) return;
  for (const [id, value] of [["activeFrom", a.start], ["activeTo", a.end]]) {
    const sel = $(id);
    if (!sel.options.length) {
      for (let h = 0; h < 24; h++) sel.appendChild(new Option(`${pad(h)}:00`, String(h)));
    }
    sel.value = String(value);
  }
  for (const o of $("activeFrom").options) o.disabled = Number(o.value) === a.end;
  for (const o of $("activeTo").options) o.disabled = Number(o.value) === a.start;
}
async function saveActive(activeHoursValue) {
  await saveSetting({ activeHours: activeHoursValue });
  renderActiveSettings();
}
$("activeOn").addEventListener("change", (e) => saveActive(e.target.checked ? { ...ACTIVE_DEFAULT } : null));
$("activeFrom").addEventListener("change", (e) => saveActive({ ...activeHours(), start: Number(e.target.value) }));
$("activeTo").addEventListener("change", (e) => saveActive({ ...activeHours(), end: Number(e.target.value) }));

// Reserve: the reserve and its release are key groups. The plan always ends at 100%.
// The preview bar shows the plan and the reserve with the values as they will be used (see goalSettings).
function renderGoalSettings() {
  const g = goalSettings();
  setChoice($("reserve"), String(g.reserve));
  setChoice($("release"), String(g.release));
  $("releaseSet").classList.toggle("hidden", !g.reserve);
  const bar = $("goalPrev");
  bar.style.setProperty("--fill", `${g.goal - g.reserve}%`);
  bar.style.setProperty("--rz-l", `${g.goal - g.reserve}%`);
  bar.style.setProperty("--rz-w", `${g.reserve}%`);
  const text = t(g.reserve ? "goal.previewText" : "goal.previewNoReserve", { plan: g.goal - g.reserve, reserve: g.reserve });
  bar.setAttribute("aria-label", text);
  $("goalPrevText").textContent = text;
}
async function saveGoal(patch) {
  await saveSetting(patch);
  renderGoalSettings();
}
bindChoice($("reserve"), (value) => saveGoal({ reserve: Number(value) }));
bindChoice($("release"), (value) => saveGoal({ reserveRelease: Number(value) }));

async function saveSetting(patch) {
  state.settings = await api.setSettings(patch);
  render();
}

function bindSettings() {
  const s = state.settings;
  $("notifyAll").checked = s.notifyAll !== false;
  syncNotifyGroup();
  $("notifyLevel").checked = s.notifyLevel !== false;
  renderGoalSettings();
  renderAutoWeightsSettings();
  renderActiveSettings();
  $("fiveHourThreshold").value = String(warnAt());
  $("remindEvery").value = String(s.remindEvery ?? "smart");
  $("notifyResets").checked = s.notifyResets !== false;
  $("notifySpikes").checked = s.notifySpikes !== false;
  $("notifyExtra").checked = s.notifyExtra !== false;
  $("notifyNoReading").checked = s.notifyNoReading !== false;
  $("showExtra").checked = s.showExtra !== false;
  $("miniWindow").checked = Boolean(s.miniWindow);
  $("openAtLogin").checked = s.openAtLogin;
  $("codeLogs").checked = s.codeLogs !== false;
  renderAutoRead();
  $("shortcutOn").checked = Boolean(s.shortcutOn);
  paintShortcutKeys();
  renderShortcutNote();
  setChoice($("language"), I18N.getLang());
  setChoice($("theme"), s.theme || "dark");
  setChoice($("screens"), ["crt", "amber", "green"].includes(s.screens) ? s.screens : "paper");
  setChoice($("motion"), ["subtle", "off"].includes(s.motion) ? s.motion : "full");
  const anchor = (s.manual && s.manual.anchor) || (autoSource() && autoSource().data.weekly.resetsAt);
  if (anchor && document.activeElement !== $("aReset")) $("aReset").value = toLocalInput(nextReset(anchor));
  $("anchorForm").classList.toggle("hidden", !needsAnchorForm(s));
}

$("notifyAll").addEventListener("change", (e) => {
  syncNotifyGroup();
  saveSetting({ notifyAll: e.target.checked });
});
$("notifyLevel").addEventListener("change", (e) => saveSetting({ notifyLevel: e.target.checked }));
$("fiveHourThreshold").addEventListener("change", (e) => saveSetting({ fiveHourThreshold: Number(e.target.value) }));
$("remindEvery").addEventListener("change", (e) => saveSetting({ remindEvery: e.target.value === "smart" ? "smart" : Number(e.target.value) }));
$("notifyResets").addEventListener("change", (e) => saveSetting({ notifyResets: e.target.checked }));
$("showExtra").addEventListener("change", (e) => saveSetting({ showExtra: e.target.checked }));
$("miniWindow").addEventListener("change", (e) => saveSetting({ miniWindow: e.target.checked }));
$("notifySpikes").addEventListener("change", (e) => saveSetting({ notifySpikes: e.target.checked }));
$("notifyExtra").addEventListener("change", (e) => saveSetting({ notifyExtra: e.target.checked }));
$("notifyNoReading").addEventListener("change", (e) => saveSetting({ notifyNoReading: e.target.checked }));

$("openAtLogin").addEventListener("change", (e) => saveSetting({ openAtLogin: e.target.checked }));
$("codeLogs").addEventListener("change", (e) => saveSetting({ codeLogs: e.target.checked }));
// Reading by itself (Danger zone). Claude's Consumer Terms limit automated access outside the API, so turning it on from
// Off takes a choice and then holding a key for a moment, with the warning in view. Changing how often while it is
// on, or turning it off, takes effect at once.
const AUTO_HOLD_MS = 1500;
const autoUi = { pending: null, holdTimer: null };
const autoEvery = (s = state.settings) => {
  const v = s && s.autoReadEvery;
  if ([0, 1, 3, 5, 10, 15, 30, 60, "smart"].includes(v)) return v;
  return s && s.autoRead === true ? 5 : 0;
};
const autoValue = (str) => (str === "smart" ? "smart" : Number(str));

// About how many readings a day: within the active hours when they are set and the timer keeps to them.
// Smart gives a range: every 15 minutes when calm, every 5 when busy, and every 60 outside the active hours.
function autoReadsPerDay(every, s = state.settings) {
  const a = activeHours(s);
  const keep = a && s.autoReadActiveOnly !== false;
  const inside = a ? activeHoursBetween(0, DAY, a) : 24;
  const outside = keep || !a ? 0 : 24 - inside;
  if (every === "smart") return { lo: Math.round((inside * 60) / 15 + outside), hi: Math.round((inside * 60) / 5 + outside) };
  const n = Math.round(((keep ? inside : 24) * 60) / every);
  return { lo: n, hi: n };
}

function renderAutoRead() {
  const s = state.settings;
  const every = autoEvery(s);
  const on = every !== 0;
  const pending = on ? null : autoUi.pending;
  if (on) autoUi.pending = null;
  const shown = pending ?? every;
  setChoice($("autoReadEvery"), String(shown));
  $("autoReadEvery").querySelectorAll('[role="radio"]').forEach((k) => k.classList.toggle("pend", pending !== null && k.dataset.value === String(pending)));
  $("autoReadWarn").classList.toggle("hidden", pending === null);
  $("autoReadOpts").classList.toggle("hidden", shown === 0);
  $("autoReadSmartNote").classList.toggle("hidden", shown !== "smart");
  const fast = shown === 1 || shown === 3;
  $("autoReadFast").classList.toggle("hidden", !fast);
  if (fast) $("autoReadFast").textContent = t("auto.fast", { n: shown, reads: autoReadsPerDay(shown).lo, times: Math.round(10 / shown) });
  $("autoReadActiveOnly").checked = s.autoReadActiveOnly !== false;
  $("autoReadIdlePause").checked = s.autoReadIdlePause !== false;
  const a = activeHours(s);
  $("autoReadActiveNote").textContent = a ? t("auto.activeNote", { from: `${pad(a.start)}:00`, to: `${pad(a.end)}:00` }) : t("auto.activeNone");
  renderAutoStatus();
}

// The status next to the title and the line of facts under the options. autoLive (auto-read.js) is the main process's
// own state: the next turn, and whether the last one was skipped.
function renderAutoStatus() {
  const s = state.settings;
  const every = autoEvery(s);
  const live = typeof autoLive === "object" && autoLive ? autoLive : {};
  let key = "auto.status.off";
  let vars = {};
  let tone = "off";
  if (every) {
    tone = live.paused ? "paused" : "on";
    key = live.paused ? `auto.status.paused.${live.paused}` : every === "smart" ? "auto.status.smart" : "auto.status.on";
    vars = { n: every === "smart" ? live.minutes || 15 : every, time: live.nextAt ? fmtTime(live.nextAt) : "–" };
  } else if (autoUi.pending !== null) {
    key = "auto.status.pending";
    tone = "pending";
  }
  $("autoReadStatusText").textContent = t(key, vars);
  $("autoReadStatus").dataset.tone = tone;
  const shown = every || autoUi.pending;
  if (!shown) return;
  const per = autoReadsPerDay(shown, s);
  const reads = per.lo === per.hi ? String(per.lo) : t("auto.range", { lo: per.lo, hi: per.hi });
  const next = every && live.nextAt ? fmtTime(live.nextAt) : "–";
  $("autoReadFacts").textContent = t("auto.facts", { reads, next });
}

async function pickAutoRead(value) {
  stopHold();
  const v = autoValue(value);
  if (v === 0 || autoEvery() !== 0) {
    autoUi.pending = null;
    await saveSetting({ autoReadEvery: v });
    renderAutoRead();
    return;
  }
  autoUi.pending = v; // from Off: the warning and the hold key come first
  renderAutoRead();
}
bindChoice($("autoReadEvery"), pickAutoRead);
$("autoReadCancel").addEventListener("click", () => {
  stopHold();
  autoUi.pending = null;
  renderAutoRead();
});

function startHold() {
  if (autoUi.pending === null || autoUi.holdTimer) return;
  const key = $("autoReadHold");
  key.classList.add("is-holding");
  $("autoReadHoldText").textContent = t("auto.holding");
  autoUi.holdTimer = setTimeout(async () => {
    const v = autoUi.pending;
    stopHold();
    autoUi.pending = null;
    await saveSetting({ autoReadEvery: v });
    renderAutoRead();
    toast(t("auto.turnedOn"));
  }, AUTO_HOLD_MS);
}
function stopHold() {
  clearTimeout(autoUi.holdTimer);
  autoUi.holdTimer = null;
  $("autoReadHold").classList.remove("is-holding");
  $("autoReadHoldText").textContent = t("auto.hold");
}
$("autoReadHold").addEventListener("pointerdown", (e) => {
  if (e.button !== 0) return;
  $("autoReadHold").setPointerCapture(e.pointerId);
  startHold();
});
for (const ev of ["pointerup", "pointercancel", "lostpointercapture"]) $("autoReadHold").addEventListener(ev, stopHold);
$("autoReadHold").addEventListener("keydown", (e) => {
  if (e.key !== "Enter" && e.key !== " ") return;
  e.preventDefault();
  if (!e.repeat) startHold();
});
$("autoReadHold").addEventListener("keyup", (e) => (e.key === "Enter" || e.key === " ") && stopHold());
$("autoReadHold").addEventListener("blur", stopHold);
$("autoReadActiveOnly").addEventListener("change", (e) => saveSetting({ autoReadActiveOnly: e.target.checked }).then(renderAutoRead));
$("autoReadIdlePause").addEventListener("change", (e) => saveSetting({ autoReadIdlePause: e.target.checked }).then(renderAutoRead));
bindChoice($("language"), async (value) => {
  state.settings = await api.setSettings({ language: I18N.normalize(value) });
  setChoice($("language"), I18N.normalize(value));
  applyLanguage();
  bindAccount();
  refreshCollector();
  paintShortcutKeys();
  renderShortcutNote();
  render();
});

// Global shortcut: refreshes from any app, even with the window in the tray

const SHORTCUT_DEFAULT = "Ctrl+Alt+R";
const KEY_NAMES = { Space: "Space", Tab: "Tab", Backspace: "Backspace", Delete: "Delete", Insert: "Insert", Home: "Home", End: "End", PageUp: "PageUp", PageDown: "PageDown", ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left", ArrowRight: "Right", Enter: "Enter" };
let capturingShortcut = false;

// "Ctrl+Alt+R" from a key press, or null for a modifier on its own. The main process checks it again.
function acceleratorFromEvent(e) {
  let key = null;
  if (/^Key[A-Z]$/.test(e.code)) key = e.code.slice(3);
  else if (/^Digit\d$/.test(e.code)) key = e.code.slice(5);
  else if (/^F([1-9]|1\d|2[0-4])$/.test(e.code)) key = e.code;
  else key = KEY_NAMES[e.code] || null;
  if (!key) return null;
  return [e.ctrlKey && "Ctrl", e.altKey && "Alt", e.shiftKey && "Shift", key].filter(Boolean).join("+");
}

// The shortcut as keycaps, and a key that changes it (it reads "Press the keys…" while it listens)
function paintShortcutKeys() {
  const keys = (state.settings.shortcutKeys || SHORTCUT_DEFAULT).split("+");
  const caps = $("shortcutCaps");
  caps.textContent = "";
  for (const key of keys) caps.appendChild(node("kbd", "kb", key));
  caps.setAttribute("aria-label", keys.join(" + "));
  caps.classList.toggle("is-capturing", capturingShortcut);
  $("shortcutKeys").textContent = capturingShortcut ? t("set.shortcutPress") : t("set.shortcutChange");
}

async function renderShortcutNote() {
  if (!api || !api.shortcutStatus) return;
  const st = await api.shortcutStatus();
  const note = $("shortcutNote");
  note.textContent = t(`set.shortcut.${st.state}`, { keys: state.settings.shortcutKeys || SHORTCUT_DEFAULT });
  note.classList.toggle("is-error", st.state === "taken" || st.state === "invalid");
  $("shortcutKeys").disabled = !state.settings.shortcutOn;
  $("shortcutCaps").classList.toggle("is-off", !state.settings.shortcutOn);
}

$("shortcutOn").addEventListener("change", async (e) => {
  state.settings = await api.setSettings({ shortcutOn: e.target.checked });
  capturingShortcut = false;
  paintShortcutKeys();
  renderShortcutNote();
});
$("shortcutKeys").addEventListener("click", () => {
  capturingShortcut = true;
  paintShortcutKeys();
});
$("shortcutKeys").addEventListener("blur", () => {
  if (!capturingShortcut) return;
  capturingShortcut = false;
  paintShortcutKeys();
});
$("shortcutKeys").addEventListener("keydown", async (e) => {
  if (!capturingShortcut || e.repeat) return;
  if (e.key === "Tab" && !e.ctrlKey && !e.altKey) return; // let the focus move on; the blur ends the capture
  e.preventDefault();
  if (e.key === "Escape") {
    capturingShortcut = false;
    paintShortcutKeys();
    return;
  }
  const keys = acceleratorFromEvent(e);
  if (!keys) return; // a modifier on its own: keep waiting for the key
  capturingShortcut = false;
  state.settings = await api.setSettings({ shortcutKeys: keys });
  paintShortcutKeys();
  renderShortcutNote();
});

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
  // The data screens: in the light theme, light paper (the default) or dark CRT. The dark theme is always CRT.
  document.documentElement.dataset.screens = !dark && (state.settings && state.settings.screens) !== "crt" ? "paper" : "crt";
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
  for (const id of ["notifyLevel", "notifyResets", "notifySpikes", "notifyExtra"]) {
    $(id).disabled = !on;
    $(id).closest("label").classList.toggle("is-disabled", !on);
  }
}

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
  renderActiveSettings();
  $("fiveHourThreshold").value = String(warnAt());
  $("remindEvery").value = String(s.remindEvery ?? "smart");
  $("notifyResets").checked = s.notifyResets !== false;
  $("notifySpikes").checked = s.notifySpikes !== false;
  $("notifyExtra").checked = s.notifyExtra !== false;
  $("showExtra").checked = s.showExtra !== false;
  $("miniWindow").checked = Boolean(s.miniWindow);
  $("openAtLogin").checked = s.openAtLogin;
  $("codeLogs").checked = s.codeLogs !== false;
  $("autoRead").checked = Boolean(s.autoRead);
  $("shortcutOn").checked = Boolean(s.shortcutOn);
  paintShortcutKeys();
  renderShortcutNote();
  setChoice($("language"), I18N.getLang());
  setChoice($("theme"), s.theme || "dark");
  setChoice($("screens"), s.screens === "crt" ? "crt" : "paper");
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

$("openAtLogin").addEventListener("change", (e) => saveSetting({ openAtLogin: e.target.checked }));
$("codeLogs").addEventListener("change", (e) => saveSetting({ codeLogs: e.target.checked }));
// The timer asks first: it is automated access, which Claude's terms do not cover
$("autoRead").addEventListener("change", (e) => {
  if (e.target.checked && !confirm(t("adv.autoConfirm"))) {
    e.target.checked = false;
    return;
  }
  saveSetting({ autoRead: e.target.checked });
});
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

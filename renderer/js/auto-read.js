// Automatic reading in the header. The timer itself lives in the main process (main.js, refresh-policy.js); this only
// shows it and passes on what the menu asks for:
//   the lamp      "Auto · 10 min · next 6:12" in place of "Live" (chrome.js), "Auto paused" while it waits
//   Refresh       a ring around its icon that drains toward the next reading
//   the menu      a click on the lamp: read now, how often (only while it is on: turning it on stays in Settings, with its
//                 warning and hold), pause for an hour, skip the next reading, and the last readings
// The countdown ticks once a second, only while the timer is on and the window is visible.

let autoLive = { every: 0 };
let autoTicker = null;

const autoOn = () => Boolean(autoLive.every);
const autoLeft = () => (autoLive.nextAt ? Math.max(0, autoLive.nextAt - Date.now()) : null);
const autoMinutes = () => (autoLive.every === "smart" ? autoLive.minutes || 15 : autoLive.every);
function autoClock(ms) {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${pad(s % 60)}`;
}

// The lamp's word and the part after it
function autoLampWord() {
  if (autoLive.paused) return t("hd.autoPaused");
  return t(autoLive.every === "smart" ? "hd.autoSmart" : "hd.auto", { n: autoMinutes() });
}
function autoLampAge() {
  if (autoLive.paused === "user") return `· ${t("hd.paused.user", { time: fmtTime(autoLive.pauseUntil) })}`;
  if (autoLive.paused === "session" && autoLive.nextAt) return `· ${t("hd.next", { time: fmtTime(autoLive.nextAt) })}`;
  if (autoLive.paused) return `· ${t(`hd.paused.${autoLive.paused}`)}`;
  const left = autoLeft();
  return left === null ? "" : `· ${t("hd.next", { time: autoClock(left) })}`;
}

// One line on the timer: the lamp's tooltip and the menu's status
function autoMenuStatus() {
  if (!autoOn()) return t("am.status.off");
  if (autoLive.paused === "user") return t("am.status.user", { time: fmtTime(autoLive.pauseUntil) });
  if (autoLive.paused === "session") return t("am.status.session", { time: autoLive.nextAt ? fmtTime(autoLive.nextAt) : "–" });
  if (autoLive.paused) return t(`am.status.${autoLive.paused}`);
  const time = autoLive.nextAt ? fmtTime(autoLive.nextAt) : "–";
  return t(autoLive.every === "smart" ? "am.status.smart" : "am.status.on", { n: autoMinutes(), time });
}

// The ring on Refresh: full right after a reading, empty when the next one is due. Dashed while paused.
function renderAutoRing() {
  const btn = $("syncBtn");
  btn.classList.toggle("ringed", autoOn());
  btn.classList.toggle("ring-paused", autoOn() && Boolean(autoLive.paused));
  if (!autoOn()) return;
  const left = autoLeft();
  const span = autoLive.nextAt && autoLive.since ? autoLive.nextAt - autoLive.since : 0;
  const frac = autoLive.paused || !span || left === null ? 1 : Math.min(1, left / span);
  btn.style.setProperty("--ring-off", String(Math.round((1 - frac) * 1000) / 10));
}

function autoTick() {
  if (autoOn() && dataState() === "fresh") setText($("lampAgeTxt"), autoLampAge());
  renderAutoRing();
}
function syncAutoTicker() {
  const run = autoOn() && !autoLive.paused && !document.hidden;
  if (run && !autoTicker) autoTicker = setInterval(autoTick, 1000);
  if (!run && autoTicker) {
    clearInterval(autoTicker);
    autoTicker = null;
  }
}
document.addEventListener("visibilitychange", () => {
  syncAutoTicker();
  if (!document.hidden) autoTick();
});

function setAutoLive(st) {
  autoLive = st && typeof st === "object" ? st : { every: 0 };
  renderChrome(pickSource());
  renderAutoRing();
  if (typeof renderAutoStatus === "function") renderAutoStatus(); // Settings, Danger zone
  if (!$("autoMenu").classList.contains("hidden")) renderAutoMenu();
  syncAutoTicker();
}

// ---- The menu ----

function renderAutoMenu() {
  // The last reading failed: its error and way out first (the notice that said it may be gone by now)
  const lastFail = state.syncFail;
  $("amErr").classList.toggle("hidden", !lastFail);
  if (lastFail) {
    const { msg, action } = syncErrorInfo(lastFail);
    $("amErrText").textContent = msg;
    const act = $("amErrAct");
    act.classList.toggle("hidden", !action);
    act.textContent = action ? action.label : "";
    act.onclick = action
      ? () => {
          closeAutoMenu();
          action.run();
        }
      : null;
  }
  $("amStatus").textContent = autoMenuStatus();
  const on = autoOn();
  $("amEvery").classList.toggle("hidden", !on);
  $("amActs").classList.toggle("hidden", !on);
  if (on) setChoice($("amEvery"), String(autoLive.every));
  $("amPause").textContent = t(autoLive.paused === "user" ? "am.resume" : "am.pause");
  $("amNow").disabled = typeof syncBusy !== "undefined" && syncBusy;
  // The last readings, any kind: a square each, worked or failed, oldest first
  const log = Array.isArray(autoLive.log) ? autoLive.log : [];
  const ok = log.filter((r) => r.ok).length;
  const fail = log.length - ok;
  $("amLog").replaceChildren(...log.map((r) => node("i", r.ok ? "ok" : "bad")));
  $("amLog").setAttribute("aria-label", log.length ? t("am.logAria", { n: log.length, ok, fail }) : t("am.logNone"));
  $("amLog").classList.toggle("hidden", !log.length);
  $("amLogSum").textContent = log.length ? t("am.logSum", { ok, fail }) : "";
  $("amLogNone").classList.toggle("hidden", log.length > 0);
  $("amLogFrom").textContent = log.length ? fmtTime(log[0].at) : "";
  $("amLogTo").textContent = log.length > 1 ? fmtTime(log[log.length - 1].at) : "";
}

// Under the lamp, kept inside the window
function placeAutoMenu() {
  const menu = $("autoMenu");
  const r = $("lamp").getBoundingClientRect();
  const w = menu.offsetWidth;
  const left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8));
  menu.style.left = `${Math.round(left)}px`;
  menu.style.top = `${Math.round(r.bottom + 6)}px`;
}
function openAutoMenu() {
  renderAutoMenu();
  $("autoMenu").classList.remove("hidden");
  $("lamp").setAttribute("aria-expanded", "true");
  placeAutoMenu();
  if (api && api.autoReadState) api.autoReadState().then(setAutoLive); // fresh numbers: the log may have moved on
}
function closeAutoMenu(focusLamp = false) {
  if ($("autoMenu").classList.contains("hidden")) return;
  $("autoMenu").classList.add("hidden");
  $("lamp").setAttribute("aria-expanded", "false");
  if (focusLamp) $("lamp").focus();
}

$("lamp").addEventListener("click", () => ($("autoMenu").classList.contains("hidden") ? openAutoMenu() : closeAutoMenu()));
document.addEventListener("click", (e) => { if (!e.target.closest("#autoMenu, #lamp")) closeAutoMenu(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("autoMenu").classList.contains("hidden")) closeAutoMenu(true); });
window.addEventListener("resize", () => !$("autoMenu").classList.contains("hidden") && placeAutoMenu());

$("amNow").addEventListener("click", () => {
  closeAutoMenu();
  runSync();
});
// How often: only while it is on, so it takes effect at once (the Danger zone does the same)
bindChoice($("amEvery"), async (value) => {
  state.settings = await api.setSettings({ autoReadEvery: value === "smart" ? "smart" : Number(value) });
  if (typeof renderAutoRead === "function") renderAutoRead();
  setAutoLive(await api.autoReadState());
});
$("amPause").addEventListener("click", async () => setAutoLive(await api.autoReadAction(autoLive.paused === "user" ? "resume" : "pause")));
$("amSkip").addEventListener("click", async () => setAutoLive(await api.autoReadAction("skip")));
$("amSettings").addEventListener("click", () => {
  closeAutoMenu();
  go("settings");
  $("tDz").scrollIntoView({ block: "start" });
});

if (api && api.onAutoReadState) {
  api.onAutoReadState(setAutoLive);
  api.autoReadState().then(setAutoLive);
}

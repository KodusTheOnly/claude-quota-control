// The frame around the Overview: the header (tabs, status lamp, Refresh) and the message strip under it

// What the lamp and the strip say about the data: updating, offline, stale (older than an hour) or fresh
function dataState() {
  if (syncBusy) return "updating";
  if (typeof navigator !== "undefined" && navigator.onLine === false) return "offline";
  return Date.now() - lastUpdate() > HOUR ? "stale" : "fresh";
}

// Each data state borrows the color and shape of a level, so it is never color alone
const STATE_LEVEL = { fresh: 0, updating: 1, stale: 2, offline: 3, none: null };

// The age of the reading in the lamp: "now", "3m", "1h"
function lampAge(ms) {
  if (ms < MIN) return t("hd.ageNow");
  return ms < HOUR ? t("hd.ageMin", { n: Math.floor(ms / MIN) }) : t("hd.ageHour", { n: Math.floor(ms / HOUR) });
}

// Draws the header and returns the data state
function renderChrome(src) {
  const st = src ? dataState() : "none";
  const lamp = $("lamp");
  setLevelClass(lamp, STATE_LEVEL[st]);
  lamp.classList.toggle("is-updating", st === "updating");
  // A live region: written only when the text changes. The age comes from the render that already runs every 30 s.
  setText($("lampText"), st === "none" ? t("src.none") : t(`state.${st}`));
  setText($("lampAgeTxt"), st === "fresh" ? `· ${lampAge(Date.now() - lastUpdate())}` : ""); // hidden by CSS where the header has no room for it
  $("lampAge").textContent = src ? t("hd.read", { time: fmtTime(lastUpdate()) }) : "";
  $("lampAge").title = src ? `${sourceLabel(src)} ${ago(lastUpdate())}` : "";
  const connected = Boolean(state.settings.claudeConnected);
  $("syncBtn").classList.toggle("hidden", !src || !connected);
  $("connectBtn").classList.toggle("hidden", !src || connected);
  document.querySelectorAll(".nav-btn").forEach((b) => {
    const on = b.dataset.view === (state.view === "about" ? "help" : state.view); // About opens from Help, so Help stays lit
    b.classList.toggle("on", on);
    if (on) b.setAttribute("aria-current", "page");
    else b.removeAttribute("aria-current");
  });
  return st;
}

// The strip under the header for the updating, stale and offline states
function renderDataMsg(st) {
  $("prog").classList.toggle("hidden", st !== "updating");
  const box = $("dataMsg");
  const show = st === "updating" || st === "stale" || st === "offline";
  box.classList.toggle("hidden", !show);
  if (!show) return;
  box.className = "msg";
  setLevelClass(box, STATE_LEVEL[st]);
  setText($("dataMsgText"), t(`msg.${st}`, { dur: fmtDur(Date.now() - lastUpdate()), time: fmtTime(lastUpdate()) }));
  $("dataMsgBtn").classList.toggle("hidden", st === "updating");
  $("dataMsgBtn").textContent = st === "offline" ? t("msg.retry") : t("hd.refresh");
}

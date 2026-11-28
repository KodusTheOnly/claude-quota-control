// The frame around the Overview: the header (tabs, status lamp, Refresh) and the message strip under it

// What the lamp and the strip say about the data: updating, offline, stale (older than an hour) or fresh
function dataState() {
  return syncBusy ? "updating" : restState();
}
// The same without a reading that runs: what the data is while it waits
function restState() {
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
  // The last reading failed (state.syncFail, set by runSync): the lamp says so until one works, and its menu shows the
  // error again (auto-read.js). Updating and offline keep their words.
  const failed = Boolean(state.syncFail) && (st === "fresh" || st === "stale");
  setLevelClass(lamp, failed ? 3 : STATE_LEVEL[st]);
  lamp.classList.toggle("is-failed", failed);
  lamp.classList.toggle("is-updating", st === "updating");
  // A live region: written only when the text changes. The age comes from the render that already runs every 30 s.
  // With automatic reading on, a fresh reading's "Live" gives way to the timer: "Auto · 10 min" and the time to the
  // next reading (auto-read.js keeps that countdown going). Updating, stale and offline keep their words: they matter more.
  const auto = st === "fresh" && !failed && autoOn();
  setText($("lampText"), st === "none" ? t("src.none") : failed ? t("state.failed") : auto ? autoLampWord() : t(`state.${st}`));
  // The narrow header can cut the word short. While updating, the tooltip also says the numbers are from the last reading.
  lamp.title = st === "updating" ? t("msg.updating") : failed ? t("hd.failedTitle") : auto ? t("hd.autoTitle", { what: autoMenuStatus() }) : $("lampText").textContent;
  setText($("lampAgeTxt"), auto ? autoLampAge() : st === "fresh" && !failed ? `· ${lampAge(Date.now() - lastUpdate())}` : ""); // hidden by CSS where the header has no room for it
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

// The strip under the header for the stale and offline states. It only explains: Refresh is in the header.
// A reading lights the rule under the header (.sweep), which already has its height, so nothing moves while it runs.
// A strip that was there stays through the reading and says it is reading; it goes with the reading that worked,
// when the numbers change anyway.
function renderDataMsg(st) {
  document.querySelector(".rule").classList.toggle("sweep", st === "updating");
  const under = st === "updating" ? restState() : st;
  const box = $("dataMsg");
  const show = under === "stale" || under === "offline";
  box.classList.toggle("hidden", !show);
  if (!show) return;
  box.className = "msg";
  const reading = st === "updating";
  setLevelClass(box, STATE_LEVEL[reading ? "updating" : st]);
  $("dataMsgMark").classList.toggle("is-updating", reading);
  setText($("dataMsgText"), reading ? t("msg.updating") : t(`msg.${st}`, { dur: fmtDur(Date.now() - lastUpdate()), time: fmtTime(lastUpdate()) }));
}

// Claude account: connect, refresh, disconnect

const SYNC_ERROR_CODES = ["need-login", "challenge", "format", "offline", "closed"];

// One floating notice for confirmations and errors, on every screen. It sits over the content, pushes nothing and goes
// away by itself after NOTE_MS (the line along its bottom shows the time left); the mouse on it or the focus inside
// pauses that, and Esc or its close key end it sooner. A newer notice replaces it.
// opts.sync: a reading's notice, under Refresh, where the eye is after the click. The others sit at the top, centered.
// opts.sticky: stays until it is closed (a damaged settings file, which must not slip by).
// A failed reading's notice flies into the lamp as it goes: the lamp says Failed until a reading works, and its menu
// shows the error again, so nothing is lost when the notice leaves.
const NOTE_MS = { ok: 4000, error: 6000, action: 10000 };
let note = null; // the notice on screen: { kind, sync, timer, left, startedAt }
let noteGone = null; // the fade or the flight of the one before

function toast(text, kind, action, opts = {}) {
  const f = $("toast");
  const err = kind === "error";
  stopNote();
  if (noteGone) noteGone();
  setText($("toastText"), text);
  const act = $("toastAct");
  act.classList.toggle("hidden", !action);
  act.textContent = action ? action.label : "";
  act.onclick = action
    ? () => {
        closeNote(false);
        action.run();
      }
    : null;
  const ms = opts.sticky ? 0 : err ? (action ? NOTE_MS.action : NOTE_MS.error) : NOTE_MS.ok;
  f.className = `toast${err ? " err" : ""}${ms ? "" : " sticky"}`;
  f.setAttribute("role", err ? "alert" : "status");
  f.style.setProperty("--dur", `${ms}ms`);
  const line = $("toastTime");
  line.style.animation = "none";
  void line.offsetWidth; // the line starts full again
  line.style.animation = "";
  note = { kind: err ? "error" : "ok", sync: Boolean(opts.sync), timer: null, left: ms, startedAt: 0 };
  placeNote();
  if (ms) runNoteClock();
}

// Under Refresh when it is a reading's notice and Refresh is there; otherwise at the top, centered. Always under the rule.
function placeNote() {
  if (!note) return;
  const f = $("toast");
  const top = document.querySelector(".rule").getBoundingClientRect().bottom + 8;
  f.style.top = `${Math.round(top)}px`;
  const key = $("syncBtn");
  const under = note.sync && key.offsetParent !== null;
  f.classList.toggle("at-sync", under);
  f.style.right = under ? `${Math.round(Math.max(8, window.innerWidth - key.getBoundingClientRect().right))}px` : "";
}
window.addEventListener("resize", placeNote);

function runNoteClock() {
  note.startedAt = Date.now();
  note.timer = setTimeout(() => closeNote(true), note.left);
}
function stopNote() {
  if (note) clearTimeout(note.timer);
  note = null;
}
function pauseNote() {
  if (!note || !note.timer) return;
  clearTimeout(note.timer);
  note.timer = null;
  note.left = Math.max(800, note.left - (Date.now() - note.startedAt));
}
function resumeNote() {
  const f = $("toast");
  if (!note || note.timer || !note.left || f.matches(":hover") || f.contains(document.activeElement)) return;
  runNoteClock();
}
$("toast").addEventListener("mouseenter", pauseNote);
$("toast").addEventListener("mouseleave", resumeNote);
$("toast").addEventListener("focusin", pauseNote);
$("toast").addEventListener("focusout", () => setTimeout(resumeNote, 0));
$("toastClose").addEventListener("click", () => closeNote(true));
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && note && $("autoMenu").classList.contains("hidden") && !document.querySelector("dialog[open]")) closeNote(true);
});

// fly: a failed reading's notice goes into the lamp (only while the lamp still says Failed)
function closeNote(fly) {
  if (!note) return;
  const f = $("toast");
  const toLamp = fly && note.kind === "error" && note.sync && Boolean(state.syncFail) && $("lamp").classList.contains("is-failed");
  stopNote();
  $("toastAct").onclick = null;
  if (f.contains(document.activeElement)) document.activeElement.blur();
  const done = () => {
    noteGone = null;
    f.classList.add("hidden");
    f.classList.remove("fade");
    f.getAnimations().forEach((a) => a.cancel());
  };
  if (toLamp && motionLevel() !== "off" && f.animate) {
    const a = f.getBoundingClientRect();
    const l = $("lamp").getBoundingClientRect();
    const dx = l.left + l.width / 2 - (a.left + a.width / 2);
    const dy = l.top + l.height / 2 - (a.top + a.height / 2);
    const flight = f.animate(
      [{ transform: "none", opacity: 1 }, { transform: `translate(${dx}px, ${dy}px) scale(${l.width / a.width}, ${l.height / a.height})`, opacity: 0.15 }],
      { duration: 430, easing: "cubic-bezier(.55, 0, .25, 1)", fill: "forwards" }
    );
    noteGone = done;
    flight.onfinish = () => {
      if (noteGone !== done) return;
      done();
      pingLamp("ping");
    };
    return;
  }
  f.classList.add("fade");
  const timer = setTimeout(() => noteGone === done && done(), 450);
  noteGone = () => {
    clearTimeout(timer);
    done();
  };
  if (toLamp) pingLamp("ping");
}

// The lamp answers: "ping" when a failed reading's notice lands in it, "read-ok" (with the time of the reading) when a
// reading you asked for worked. That blink is the whole confirmation: the numbers that changed glow by themselves.
function pingLamp(cls) {
  for (const el of cls === "read-ok" ? [$("lamp"), $("lampAge")] : [$("lamp")]) {
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
  }
}

function showError(text, action, opts) {
  toast(text, "error", action, opts);
}
// Closes an error notice (a newer piece of news made it old); a confirmation is left alone
function hideError() {
  if (note && note.kind === "error") closeNote(false);
}

// The message and the way out for a failed reading: the notice and the lamp's menu (auto-read.js) both use it
function syncErrorInfo(code) {
  const msg = SYNC_ERROR_CODES.includes(code) ? t(`sync.err.${code}`) : t("sync.fail");
  let action = null;
  if (code === "need-login") action = { label: t("sync.connect"), run: connectClaude };
  if (code === "challenge") action = { label: t("sync.openPage"), run: () => runSync({ visible: true }) };
  if (code === "format") action = { label: t("hero.type"), run: openTypeIn };
  return { msg, action };
}

function syncFeedback(text, kind, action) {
  // The tray card shows the result too
  state.syncMsg = { text, kind: kind || "ok", at: Date.now() };
  if (kind !== "error") hideError(); // a reading that worked clears the last error
  render();
  if (kind === "error") toast(text, "error", action, { sync: true });
  else pingLamp("read-ok");
}

// At most one reading a minute (MIN_GAP in claude-sync.js, counted from the last reading that worked, whoever asked).
// Every reading goes through runSync, so the window keeps the same count and Refresh shows it: its base fills up over
// the minute. A click before that asks Claude nothing and only gets a bubble with the seconds left. If the count ever
// differs, the main process still says "too-soon", and its retryIn resets the count here.
const READ_GAP = 60 * 1000;
let readOkAt = 0;
let coolTimer = null;
let soonTimer = null;
const coolLeft = () => Math.max(0, readOkAt + READ_GAP - Date.now());

function startCool() {
  $("syncBtn").classList.add("cooling");
  clearInterval(coolTimer);
  tickCool();
  coolTimer = setInterval(tickCool, 500);
}
function tickCool() {
  const btn = $("syncBtn");
  const left = coolLeft();
  btn.style.setProperty("--cool", String(Math.round((1 - left / READ_GAP) * 1000) / 1000));
  if (!$("soon").classList.contains("hidden")) setText($("soonText"), t("sync.soon", { s: Math.ceil(left / 1000) }));
  if (left > 0) return;
  clearInterval(coolTimer);
  coolTimer = null;
  btn.classList.remove("cooling");
  btn.classList.remove("ready");
  void btn.offsetWidth;
  btn.classList.add("ready");
}

function showSoon() {
  const btn = $("syncBtn");
  btn.classList.remove("nudge");
  void btn.offsetWidth;
  btn.classList.add("nudge");
  const b = $("soon");
  setText($("soonText"), t("sync.soon", { s: Math.ceil(coolLeft() / 1000) }));
  b.classList.remove("hidden", "fade");
  const k = btn.getBoundingClientRect();
  const left = Math.max(8, Math.min(window.innerWidth - b.offsetWidth - 8, k.left + k.width / 2 - b.offsetWidth / 2));
  b.style.left = `${Math.round(left)}px`;
  b.style.top = `${Math.round(k.bottom + 9)}px`;
  b.style.setProperty("--ax", `${Math.round(k.left + k.width / 2 - left)}px`);
  clearTimeout(soonTimer);
  soonTimer = setTimeout(() => {
    b.classList.add("fade");
    soonTimer = setTimeout(() => b.classList.add("hidden"), 260);
  }, 2200);
}
function hideSoon() {
  clearTimeout(soonTimer);
  $("soon").classList.add("hidden");
}

let syncBusy = false;
let syncQuiet = false; // the reading that is running was started by the app itself, so it reports nothing

// A reading of the usage page. "auto" marks the ones the app starts by itself (opening the app,
// coming back to it, opening the tray card): they never move you to another screen and never show
// an error or the "updated" notice. The lamp and the message strip still tell the story, and the usual
// alerts (a change of level, a reset) can still fire from a fresh reading.
async function runSync({ visible = false, auto = false } = {}) {
  if (!api) return;
  // A reading is already running. If the app started it and this one is the person asking, the one that is
  // running reports its result as theirs.
  if (syncBusy) {
    if (!auto) syncQuiet = false;
    return;
  }
  if (!state.settings.claudeConnected) {
    if (auto) return;
    go("panel");
    syncFeedback(t("sync.connectFirst"), "error", { label: t("sync.connect"), run: connectClaude });
    return;
  }
  // Pressed within the minute after a reading: Claude is not asked, the bubble says when it can be (the page opened to
  // pass a check is not held back, as in claude-sync.js)
  if (!auto && !visible && coolLeft() > 0) {
    showSoon();
    return;
  }
  hideSoon();
  syncBusy = true;
  syncQuiet = auto;
  state.syncMsg = null;
  render(); // tells the tray card a refresh is running
  const btn = $("syncBtn");
  btn.disabled = true;
  btn.classList.add("is-busy");
  // The spinner on the key says it is working; the label only changes when the page is open and waiting for you
  btn.setAttribute("aria-busy", "true");
  if (visible) $("syncLabel").textContent = t("hero.waiting");
  let res;
  try {
    res = await api.claudeSync({ visible });
  } catch {
    res = { ok: false, error: "fail" }; // the main process did not answer: a plain failure, with its message
  } finally {
    syncBusy = false;
    btn.disabled = false;
    btn.classList.remove("is-busy");
    btn.removeAttribute("aria-busy");
    $("syncLabel").textContent = t("hd.refresh");
  }
  auto = syncQuiet; // someone may have asked while it ran
  if (res.ok) {
    readOkAt = Date.now(); // the minute until the next reading starts now (claude-sync.js counts from the same moment)
    startCool();
  }

  // The verdict's face and the lamp show a failed reading (state.syncFail, the error code) until one works
  if (res.ok) state.syncFail = null;
  else if (res.error !== "too-soon") state.syncFail = res.error || "fail";
  if (res.ok && !res.weekly.resetsAt && !(state.settings.manual && state.settings.manual.anchor)) {
    if (!auto) {
      syncFeedback(t("sync.noReset", { pct: pct(res.weekly.used) }), "error",
        { label: t("sync.openSettings"), run: () => go("settings") });
    } else render(); // the face stops reading
    return;
  }
  if (res.ok) {
    const same = sameReading(state.settings.manual, res);
    // Extra usage comes from the page text. A reading that shows none clears the old one; a
    // reading that could not read the text at all (undefined) keeps what the app already had.
    if (res.extra !== undefined) {
      state.settings = await api.setSettings({ extra: res.extra ? { ...res.extra, at: res.at || Date.now() } : null });
    }
    // Use per product and Claude's resets (History): each reading replaces them, null when it did not show them
    if ("products" in res || "resets" in res) {
      const at = res.at || Date.now();
      state.settings = await api.setSettings({
        products: res.products ? { rows: res.products, at, resetsAt: res.weekly.resetsAt } : null,
        resets: res.resets ? { ...res.resets, at } : null,
      });
    }
    await saveManual({
      weekly: res.weekly.used,
      session: res.session ? res.session.used : null,
      sessionResetAt: res.session ? res.session.resetsAt : null,
      anchor: res.weekly.resetsAt || undefined,
      via: "sync",
    });
    const text = same
      ? t("sync.unchanged")
      : res.session
      ? t("sync.updatedBoth", { week: pct(res.weekly.used), session: pct(res.session.used) })
      : t("sync.updatedWeek", { week: pct(res.weekly.used) });
    if (auto) return; // saveManual already redrew everything: the numbers just change
    syncFeedback(text);
    if (!same) api.toast({ title: t("toast.updated"), body: text });
    return;
  }

  state.settings = await api.getSettings();
  render();
  // Not an error: the minute between readings was not over. The count here was off, so it takes the main process's.
  if (res.error === "too-soon") {
    readOkAt = Date.now() - Math.max(0, READ_GAP - (Number(res.retryIn) || 0));
    startCool();
    if (!auto) showSoon();
    return;
  }
  if (auto) return;
  const { msg, action } = syncErrorInfo(res.error);
  go("panel");
  syncFeedback(msg, "error", action);
  api.toast({ title: t("toast.fail"), body: msg });
}

async function connectClaude() {
  const btns = [$("claudeLoginBtn"), $("connectBtn"), $("setupConnectBtn")];
  btns.forEach((b) => b && (b.disabled = true));
  const res = await api.claudeLogin();
  btns.forEach((b) => b && (b.disabled = false));
  state.settings = await api.getSettings();
  bindAccount();
  render();
  if (res.ok) {
    hideError();
    toast(t("acct.connected"));
    // First reading right after connecting: still the same user action
    runSync();
  } else if (res.error === "closed") {
    toast(t("acct.cancelled"), "error");
  }
}

async function disconnectClaude() {
  if (!confirm(t("acct.confirmDisconnect"))) return;
  await api.claudeLogout();
  state.syncFail = null;
  state.settings = await api.getSettings();
  bindAccount();
  render();
  toast(t("acct.disconnected"));
}

function bindAccount() {
  const connected = Boolean(state.settings.claudeConnected);
  setLevelClass($("claudeChip"), connected ? 0 : null);
  $("claudeText").textContent = connected ? t("acct.on") : t("acct.off");
  $("claudeLoginBtn").textContent = connected ? t("acct.signInAgain") : t("acct.connectBtn");
  $("claudeLoginBtn").classList.toggle("primary", !connected);
  $("claudeLogoutBtn").classList.toggle("hidden", !connected);
}

$("syncBtn").addEventListener("click", () => runSync());
$("connectBtn").addEventListener("click", connectClaude);
$("claudeLoginBtn").addEventListener("click", connectClaude);
$("claudeLogoutBtn").addEventListener("click", disconnectClaude);
$("setupConnectBtn").addEventListener("click", connectClaude);

document.querySelectorAll(".nav-btn").forEach((b) => b.addEventListener("click", () => go(b.dataset.view)));
document.querySelectorAll("[data-goto]").forEach((b) => b.addEventListener("click", () => go(b.dataset.goto)));
document.querySelectorAll("[data-open-usage]").forEach((b) => b.addEventListener("click", () => api && api.openUsage()));
document.querySelectorAll(".rk").forEach((b) =>
  b.addEventListener("click", () => {
    state.range = Number(b.dataset.range);
    renderHistory(); // also marks the range key that is on
  })
);

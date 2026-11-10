// Claude account: connect, refresh, disconnect

const SYNC_ERROR_CODES = ["need-login", "challenge", "format", "offline", "closed"];

// Short confirmation at the top: floats over the content, pushes nothing, fades after 4 s.
// An error goes to the error strip instead: it can be long, and a floating line would cover the numbers.
function toast(text, kind, action) {
  if (kind === "error") {
    showError(text, action);
    return;
  }
  const f = $("toast");
  f.textContent = "";
  const msg = document.createElement("span");
  msg.className = "tmsg";
  msg.textContent = text;
  f.appendChild(msg);
  f.className = "toast";
  // Sit just under the header and the error strip, whatever their height
  const above = $("errMsg").classList.contains("hidden") ? document.querySelector(".rule") : $("errMsg");
  f.style.top = above ? `${Math.round(above.getBoundingClientRect().bottom + 6)}px` : "";
  clearTimeout(f.__t);
  clearTimeout(f.__t2);
  f.__t = setTimeout(() => f.classList.add("fade"), 3500);
  f.__t2 = setTimeout(() => f.classList.add("hidden"), 4000);
}

// Error strip under the header, on every screen: pushes the content down and stays until it is closed,
// its action is used, a newer error replaces it or a reading succeeds
function showError(text, action) {
  setText($("errMsgText"), text);
  const act = $("errMsgAct");
  act.classList.toggle("hidden", !action);
  act.textContent = action ? action.label : "";
  act.onclick = action
    ? () => {
        hideError();
        action.run();
      }
    : null;
  $("errMsg").classList.remove("hidden");
}
function hideError() {
  $("errMsg").classList.add("hidden");
  $("errMsgAct").onclick = null;
}
$("errMsgClose").addEventListener("click", hideError);

function syncFeedback(text, kind, action) {
  // The tray card shows the result too
  state.syncMsg = { text, kind: kind || "ok", at: Date.now() };
  if (kind !== "error") hideError(); // a reading that worked clears the last error
  render();
  toast(text, kind, action);
}

let syncBusy = false;

// A reading of the usage page. "auto" marks the ones the app starts by itself (opening the app,
// coming back to it, opening the tray card): they never move you to another screen and never show
// an error or the "updated" notice. The lamp and the message strip still tell the story, and the usual
// alerts (a change of level, a reset) can still fire from a fresh reading.
async function runSync({ visible = false, auto = false } = {}) {
  if (syncBusy || !api) return;
  if (!state.settings.claudeConnected) {
    if (auto) return;
    go("panel");
    syncFeedback(t("sync.connectFirst"), "error", { label: t("sync.connect"), run: connectClaude });
    return;
  }
  syncBusy = true;
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
  } finally {
    syncBusy = false;
    btn.disabled = false;
    btn.classList.remove("is-busy");
    btn.removeAttribute("aria-busy");
    $("syncLabel").textContent = t("hd.refresh");
  }

  // The verdict's face shows a failed reading (state.syncFail, the error code) until one works
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
  if (auto) return;
  if (res.error === "too-soon") {
    syncFeedback(t("sync.tooSoon", { s: Math.ceil(res.retryIn / 1000) }), "error");
    return;
  }
  const msg = SYNC_ERROR_CODES.includes(res.error) ? t(`sync.err.${res.error}`) : t("sync.fail");
  let action = null;
  if (res.error === "need-login") action = { label: t("sync.connect"), run: connectClaude };
  if (res.error === "challenge") action = { label: t("sync.openPage"), run: () => runSync({ visible: true }) };
  if (res.error === "format") action = { label: t("hero.type"), run: openTypeIn };
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

// Full render

function render(opts = {}) {
  const src = pickSource();
  const banner = $("banner");
  banner.classList.add("hidden");
  const st = renderChrome(src);
  renderDataMsg(st);
  $("anchorForm").classList.toggle("hidden", !needsAnchorForm(state.settings)); // connecting, a reading or disconnecting can change it

  if (!src) {
    $("setup").classList.remove("hidden");
    $("dash").classList.add("hidden");
    placeOvKeys();
    const anchor = state.settings.manual && state.settings.manual.anchor;
    if (anchor && !$("sReset").value) $("sReset").value = toLocalInput(nextReset(anchor));
    updateTray(null);
    publishSummary(null);
    if (state.view === "history") renderHistory();
    return;
  }

  $("setup").classList.add("hidden");
  const m = compute(src);
  if (m.rolled) {
    banner.textContent = t("banner.rolled", { when: fmtWhen(m.rolled, m.now) });
    banner.classList.remove("hidden");
  }

  $("dash").classList.remove("hidden");
  $("dash").classList.toggle("is-stale", st === "stale");
  $("dash").classList.toggle("is-offline", st === "offline");
  $("dash").classList.toggle("is-reading", st === "updating");
  renderOverview(m, Boolean(opts.fresh));
  tipRefresh();
  placeOvKeys();
  if (state.view === "history") renderHistory();
  updateTray(m);
  publishSummary(m, src);
  checkAlerts(m, opts.fresh, src);
  sendAutoReadHint(m);
  dashMotion(Boolean(opts.fresh));
}

// The Overview's own motion (overview.css, "Motion kit"): the screens power on the first time it shows, and the bars
// light up again, segment by segment, after a new reading. Settings > Display > Motion decides how much plays.
let dashPowered = false;
const dashTimers = {};
function dashPlay(cls, ms) {
  if (motionLevel() === "off") return;
  const d = $("dash");
  d.classList.remove(cls);
  void d.offsetWidth; // restart
  d.classList.add(cls);
  clearTimeout(dashTimers[cls]);
  dashTimers[cls] = setTimeout(() => d.classList.remove(cls), ms);
}
function dashMotion(fresh) {
  if (!dashPowered) {
    if (document.hidden || state.view !== "panel") return; // waits until it is seen
    dashPowered = true;
    dashPlay("power-on", 2200);
    return;
  }
  if (fresh) dashPlay("cascade", 1200);
}
document.addEventListener("visibilitychange", () => !document.hidden && !dashPowered && pickSource() && dashMotion(false));

// Smart auto read (Settings, Danger zone) reads more often while a session runs or the week is Tight or Pause.
// The main process does not compute levels, so the window tells it, only when it changes.
let autoReadHot = null;
function sendAutoReadHint(m) {
  const f = m.five;
  const hot = Boolean((f && f.used > 0 && f.resetsAt && f.resetsAt > m.now) || (m.head && m.head.level >= 2));
  if (hot === autoReadHot || !api || !api.autoReadHint) return;
  autoReadHot = hot;
  api.autoReadHint(hot);
}

// Navigation

function go(view) {
  const changed = state.view !== view;
  state.view = view;
  if (view === "panel") faceResume();
  else faceStop(); // the verdict's face only plays on the Overview
  document.querySelectorAll(".view").forEach((v) => v.classList.toggle("hidden", v.id !== `view-${view}`));
  renderChrome(pickSource());
  placeOvKeys();
  if (view === "panel" && !dashPowered && pickSource()) dashMotion(false); // the power on waits for the Overview
  if (view === "history") renderHistory();
  if (view === "about") renderAbout();
  if (view === "help") {
    renderHelpCalc();
    renderHelpTiles();
  }
  if (view === "settings") {
    refreshCollector();
    bindSettings();
  }
  if (changed) document.querySelector(".content").scrollTop = 0; // every screen starts at its top
  syncToc();
}

function focusUpdate() {
  go("panel");
  if (pickSource()) {
    openTypeIn();
  } else {
    $("sUsed").focus();
    $("sUsed").select();
  }
}

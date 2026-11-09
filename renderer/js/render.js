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
  renderOverview(m, Boolean(opts.fresh));
  placeOvKeys();
  if (state.view === "history") renderHistory();
  updateTray(m);
  publishSummary(m, src);
  checkAlerts(m, opts.fresh, src);
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

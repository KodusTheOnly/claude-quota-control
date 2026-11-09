// Start-up

// Claude Code readings go into the log too (for session pace and the hourly strip). The collector
// keeps a short log of its own, so the readings made while the app was closed are added first,
// oldest to newest, and only the ones newer than what the log already has.
async function ingestAuto(data) {
  state.data = data;
  if (data && data.weekly && data.updatedAt) {
    const missed = (Array.isArray(data.recent) ? data.recent : [])
      .filter((r) => r && Number.isFinite(r.at) && Number.isFinite(r.w))
      .sort((a, b) => a.at - b.at);
    for (const r of missed) {
      const list = (state.settings && state.settings.readings) || [];
      const last = list[list.length - 1];
      if (last && r.at <= (last.to || last.at)) continue;
      const point = { weekly: r.w, session: Number.isFinite(r.s) ? r.s : null, sessionResetsAt: Number.isFinite(r.sr) ? r.sr : null };
      await logReading({ at: r.at, ...point });
      if (Number.isFinite(r.to) && r.to > r.at) await logReading({ at: r.to, ...point });
    }
    await logReading({
      at: data.updatedAt,
      weekly: data.weekly.used,
      session: data.fiveHour ? data.fiveHour.used : null,
      sessionResetsAt: data.fiveHour ? data.fiveHour.resetsAt : null,
    });
  }
}

// The settings file could not be read at start: say what happened and where the damaged copy is.
// The notice stays in the error strip until it is closed.
async function showSettingsRecovery() {
  const rec = api.settingsRecovery ? await api.settingsRecovery() : null;
  if (!rec) return;
  const file = String(rec.copy || "").split(/[\\/]/).pop();
  const key = rec.kind === "restored" ? "data.recoveredRestored" : "data.recoveredReset";
  showError(t(key, { file }));
}

async function init() {
  if (!api) return;
  state.settings = await api.getSettings();
  applyLanguage();
  applyTheme();
  await backfillSessions();
  await ingestAuto(await api.getData());
  bindSettings();
  bindAccount();
  render();
  showSettingsRecovery();
  api.onData(async (data) => {
    await ingestAuto(data);
    render({ fresh: true });
  });
  api.onAutoReadStopped(async () => {
    state.settings = await api.getSettings();
    bindSettings();
    toast(t("adv.autoStopped"), "error");
  });
  api.onFocusUpdate(focusUpdate);
  api.onSyncRequest((opts) => runSync({ auto: Boolean(opts && opts.auto) }));
  // Safety net: if focus or a hash ever scrolls the page itself, put it back
  window.addEventListener("scroll", () => {
    const el = document.scrollingElement;
    if (el && (el.scrollTop || el.scrollLeft)) el.scrollTo(0, 0);
  });
  window.addEventListener("online", () => render());
  window.addEventListener("offline", () => render());
  setInterval(render, 30000);
  api.rendererReady(); // from here on the main process may ask for a refresh
}

init();

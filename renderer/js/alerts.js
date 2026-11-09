// Notifications

function checkAlerts(m, fresh, src) {
  if (!api || !m) return;
  const s = state.settings;
  const now = Date.now();
  const resets = s.notifyResets !== false;

  // Session reset: the time is already known, so this needs no reading
  const raw = src && src.data.fiveHour;
  if (resets && raw && raw.resetsAt && raw.resetsAt <= now && now - raw.resetsAt < 2 * HOUR && raw.used >= warnAt()) {
    api.notify({ key: `sess-reset-${raw.resetsAt}`, title: t("alert.sessionReset"), body: t("alert.sessionResetBody"), syncOnClick: Boolean(s.claudeConnected) });
  }

  // Session far above normal
  if (fresh && s.notifySpikes !== false && raw && raw.resetsAt && raw.resetsAt > now) spikeAlert(raw);

  // Monthly spend limit at 80% and at 100%
  const ex = s.extra;
  if (fresh && s.notifyExtra !== false && ex && ex.limit > 0 && ex.spent > 0) {
    const month = new Date(now).toISOString().slice(0, 7);
    const body = t("alert.extraBody", { spent: fmtMoney(ex.spent, ex.currency, ex.symbol), limit: fmtMoney(ex.limit, ex.currency, ex.symbol) });
    if (ex.spent >= ex.limit) api.notify({ key: `extra-100-${month}`, title: t("alert.extra100"), body });
    else if (ex.spent >= ex.limit * 0.8) api.notify({ key: `extra-80-${month}`, title: t("alert.extra80"), body });
  }

  // Week rolled over: notify with a summary of the week that ended
  const R = m.w.resetsAt;
  if (s.weekSeen !== R) {
    const ended = s.weekSeen;
    api.setSettings({ weekSeen: R }).then((next) => {
      state.settings = next;
    });
    if (resets && ended && ended <= now && now - ended < 3 * DAY) {
      const sum = weekSummary(ended);
      api.notify({
        key: `week-${ended}`,
        title: t("alert.weekTitle"),
        body: sum && sum.top
          ? t("alert.weekBody", { used: pct(sum.used), day: shortWeekday(new Date(sum.top.ms)), spent: pct(sum.top.spent) })
          : sum ? t("alert.weekBodyShort", { used: pct(sum.used) }) : t("alert.weekBodyNone"),
      });
    }
  }

  // The week's level went up to Tight or Pause, only on a fresh reading
  if (fresh && s.notifyLevel !== false) {
    const { level, note } = levelAlert(m, s.lastLevel, now);
    if (level !== s.lastLevel) {
      api.setSettings({ lastLevel: level }).then((next) => {
        state.settings = next;
      });
    }
    if (note) api.notify(note);
  }

  const hour = new Date(now).getHours();
  const connected = Boolean(s.claudeConnected);
  if (s.remindEvery === "smart") {
    smartReminder(m, now, hour, connected);
    return;
  }
  const every = Number(s.remindEvery) || 0;
  if (every > 0 && hour >= 8 && hour < 23 && now - lastUpdate() > every * HOUR) {
    api.notify({
      key: `remind-${Math.floor(now / (every * HOUR))}`,
      title: t("alert.remindTitle"),
      body: t(connected ? "alert.remindConnected" : "alert.remindManual", { ago: ago(lastUpdate()) }),
      focusUpdate: !connected,
      syncOnClick: connected,
    });
  }
}

// The week's level, as the verdict shows it (not rated while warming up, unless the week is at Pause already).
// Only a rise to Tight or Pause is worth a notification; Free and Moderate say nothing. The key holds the level and
// the local day, and the main process shows a key only once (it keeps them in the settings, `notified`), so each
// level notifies at most once a day, even after going down and up again or a restart.
// prev: the level of the last fresh reading (settings.lastLevel). Returns the level to keep and the note, or null.
function levelAlert(m, prev, now) {
  const level = verdictLevel(m);
  const rose = level !== null && level >= 2 && (prev === null || prev === undefined || level > prev);
  const note = rose
    ? { key: `week-level-${LEVEL_KEYS[level]}-${dayKey(now)}`, title: t("alert.level", { level: levelName(level) }), body: `${m.head.guide} ${m.head.reason}` }
    : null;
  return { level, note };
}

// Typical session peak: the median of the last sessions
function typicalPeak(excludeSr) {
  const peaks = ((state.settings && state.settings.sessions) || [])
    .filter((x) => Math.abs(x.sr - excludeSr) >= 10 * MIN && x.peak > 0)
    .slice(-30)
    .map((x) => x.peak)
    .sort((x, y) => x - y);
  if (peaks.length < SPIKE_MIN_SESSIONS) return null;
  return peaks[Math.floor(peaks.length / 2)];
}

function spikeAlert(raw) {
  const typical = typicalPeak(raw.resetsAt);
  if (!typical || raw.used < 20 || raw.used < typical * SPIKE_FACTOR) return;
  api.notify({
    key: `spike-${raw.resetsAt}`,
    title: t("alert.spikeTitle"),
    body: t("alert.spikeBody", { used: pct(raw.used), typical: pct(typical), times: fmtNum(raw.used / typical, 1, 1) }),
  });
}

// Smart reminder: only when a new reading could change the answer
function smartReminder(m, now, hour, connected) {
  if (hour < 8 || hour >= 23) return;
  const age = now - lastUpdate();
  const base = { focusUpdate: !connected, syncOnClick: connected };
  // 1) at the latest pace the session is about to fill up
  if (m.pace && m.pace.fullAt && m.pace.fullAt - now < 20 * MIN && m.pace.fullAt > now - 30 * MIN && age > 15 * MIN) {
    api.notify({ key: `remind-full-${Math.round(m.pace.fullAt / (10 * MIN))}`, title: t("alert.fullSoonTitle"),
      body: t("alert.fullSoonBody", { time: fmtTime(m.pace.fullAt) }), ...base });
    return;
  }
  // 2) no reading yet today
  if (hour >= 9 && startOfDay(lastUpdate()) < startOfDay(now)) {
    api.notify({ key: `remind-day-${dayKey(now)}`, title: t("alert.noReadingTitle"),
      body: t(connected ? "alert.noReadingConnected" : "alert.noReadingManual"), ...base });
    return;
  }
  // 3) too long without a reading
  if (age > 6 * HOUR) {
    api.notify({ key: `remind-6h-${Math.floor(now / (6 * HOUR))}`, title: t("alert.remindTitle"),
      body: t(connected ? "alert.remindConnected" : "alert.remindManual", { ago: ago(lastUpdate()) }), ...base });
  }
}

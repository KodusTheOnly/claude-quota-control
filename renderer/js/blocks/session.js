// 03 Session: "will I be cut off right now?" The 5-hour window is rated on its own % used.

function renderSession(m) {
  const f = m.five;
  const level = f ? m.lv.session : null;
  // How much of the 5-hour window has gone by, when Claude told us when it ends
  const elapsed = f && f.resetsAt ? clamp100(100 - ((f.resetsAt - m.now) / (5 * HOUR)) * 100) : null;

  $("sPct").textContent = f ? `${r0(f.used)}%` : "–";
  $("sOf").textContent = f ? t("session.of5h") : "";
  paintLevel($("sLevel"), level);
  $("sResets").textContent = !f ? t("session.noReading") : f.resetsAt ? t("mod.sessionResets", { dur: fmtDur(f.resetsAt - m.now) }) : t("session.logged", { ago: ago(f.at) });

  const bar = $("sBar");
  setLevelClass(bar, level);
  setBar(bar, { fill: f ? f.used : 0, tick: elapsed });
  bar.setAttribute("aria-label", f ? t("mod.aria.session", { used: r0(f.used) }) : t("session.noReading"));
  setBarLabel($("sBl"), elapsed === null ? "" : t("session.passed", { pct: r0(elapsed) }));

  // Detail: how fast it is climbing, once two readings of the same window exist
  const p = m.pace;
  const fills = p && p.known && p.fullAt;
  // Filling up before the reset: say how long the rest of the window stays locked. Full already, or no reset known: the plain text.
  const locked = fills && f.resetsAt && f.used < 100 && p.fullAt > m.now ? f.resetsAt - p.fullAt : 0;
  const time = fills ? fmtTime(p.fullAt) : "";
  // Longest first; fitSessionPace() takes the first that fits, so "· Xh Ym locked" is the first part to go
  sessionPaceTexts = !fills ? [""] : locked > 0 ? [t("session.fillsLocked", { time, dur: fmtDur(locked) }), t("session.fillsShort", { time })] : [t("session.fillsAround", { time })];
  fitSessionPace();
  $("sPace").classList.toggle("hidden", !fills);
}

let sessionPaceTexts = [""];
function fitSessionPace() {
  const el = $("sPace");
  for (const text of sessionPaceTexts) {
    setText(el, text);
    if (el.scrollWidth <= el.clientWidth + 1) return;
  }
}
new ResizeObserver(() => fitSessionPace()).observe($("sPace"));

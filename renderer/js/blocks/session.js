// 03 Session: "will I be cut off right now?" The 5-hour window is rated on its own % used.
// Two bars: how much of the session is used, and how much of its 5 hours has passed. Used ahead of time means the
// session runs out before it resets. Under them, the reset time; in its last minutes that line turns into a warning.

const SESSION_SOON = 50 * MIN; // how long before the reset the warning shows
const SESSION_NEAR = 30 * MIN; // the warning turns yellow
const SESSION_LAST = 10 * MIN; // the warning turns red

function renderSession(m) {
  const f = m.five;
  const level = f ? m.lv.session : null;

  setNum($("sPct"), f ? `${r0(f.used)}%` : "–");
  // Like Today, the level only shows when it matters (Tight or Pause): the number and the bar already say the rest
  paintLevel($("sLevel"), level);
  $("sLevel").classList.toggle("hidden", !(level >= 2));

  // The used bar is a gauge: its color zones are the session cuts (overview.css), not the level
  const bar = $("sBar");
  SESSION_CUTS.forEach((cut, i) => bar.style.setProperty(`--z${i + 1}`, `${cut}%`));
  setBar(bar, { fill: f ? f.used : 0, tick: null });
  bar.setAttribute("aria-label", f ? t("mod.aria.session", { used: r0(f.used) }) : t("session.noReading"));
  for (const el of [bar, $("sPct")]) setTip(el, "sused", f ? `${r0(f.used)}%` : "");

  // The time bar needs the reset time; a reading without one (typed in without it) has no clock to show
  const left = f && f.resetsAt ? f.resetsAt - m.now : null;
  const timed = left !== null && left > 0;
  const passed = timed ? clamp100(100 - (left / (5 * HOUR)) * 100) : 0;
  const time = $("sTime");
  setBar(time, { fill: passed, tick: null });
  time.setAttribute("aria-label", t("session.timeAria", { pct: r0(passed) }));
  time.classList.toggle("hidden", !timed);
  setTip(time, "stime", timed ? `${fmtDur(5 * HOUR - left)} / 5 h` : "");
  $("sTimeKey").classList.toggle("hidden", !timed);

  const soon = timed && left <= SESSION_SOON;
  $("sScr").classList.toggle("soon", soon);
  $("sScr").classList.toggle("s30", soon && left <= SESSION_NEAR && left > SESSION_LAST);
  $("sScr").classList.toggle("s10", soon && left <= SESSION_LAST);
  // "Resets 17:51 · in 2h 04m", or near the reset "Resets in 12 min · 15:59". The words and the second part give way in a
  // narrow tile (overview.css), the time or the countdown stays.
  const box = $("sResetsText");
  setTip($("sResets"), soon ? "ssoon" : "sreset", timed ? `${fmtWhen(f.resetsAt, m.now)} · ${fmtDur(left)}` : "");
  if (!timed) {
    setText(box, !f ? t("session.noReading") : t("session.logged", { ago: ago(f.at) }));
    return;
  }
  const when = fmtWhen(f.resetsAt, m.now);
  const dur = fmtDur(left);
  box.replaceChildren(
    "↻ ",
    node("span", "rs-a", `${t(soon ? "session.resetInWord" : "session.resetWord")} `),
    node("b", "", soon ? dur : when),
    node("span", "rs-b", ` · ${soon ? when : t("session.inDur", { dur })}`)
  );
}

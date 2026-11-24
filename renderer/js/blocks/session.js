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

  // At this pace, when the session fills up before it resets (pace.fullAt), and for how long it stays locked. Full
  // already: locked until the reset.
  const p = m.pace;
  const locked = timed && f.used >= 100;
  const lockAt = !locked && timed && p && p.known && p.fullAt && p.fullAt > m.now && p.fullAt < f.resetsAt ? p.fullAt : null;
  paintSessionLock(m, f, { locked, lockAt, passed, level });

  const soon = timed && left <= SESSION_SOON;
  $("sScr").classList.toggle("soon", soon);
  $("sScr").classList.toggle("s30", soon && left <= SESSION_NEAR && left > SESSION_LAST);
  $("sScr").classList.toggle("s10", soon && left <= SESSION_LAST);
  $("sScr").classList.toggle("locked", locked);
  // "Resets 17:51 · in 2h 04m", or near the reset "Resets in 12 min · 15:59". Locked: "Locked · back 17:51 · in 2h 04m".
  // The parts give way in a narrow tile (fitStrip, and overview.css); the time or the countdown stays.
  const box = $("sResetsText");
  setTip($("sResets"), soon ? "ssoon" : "sreset", timed ? `${fmtWhen(f.resetsAt, m.now)} · ${fmtDur(left)}` : "");
  if (!timed) {
    setText(box, !f ? t("session.noReading") : t("session.logged", { ago: ago(f.at) }));
    fitStrip();
    return;
  }
  const when = fmtWhen(f.resetsAt, m.now);
  const dur = fmtDur(left);
  const wasLocked = sessionWasLocked;
  sessionWasLocked = locked;
  if (locked) {
    const badge = lockBadge(t("session.locked"));
    if (wasLocked === false && motionLevel() !== "off") badge.classList.add("stamp"); // it just locked
    box.replaceChildren(
      badge,
      node("span", "rs-a", ` ${t(soon ? "session.unlocksIn" : "session.backWord")} `),
      node("b", "", soon ? dur : when),
      node("span", "rs-b", ` · ${soon ? when : t("session.inDur", { dur })}`)
    );
  } else {
    box.replaceChildren(
      "↻ ",
      node("span", "rs-a", `${t(soon ? "session.resetInWord" : "session.resetWord")} `),
      node("b", "", soon ? dur : when),
      node("span", "rs-b", ` · ${soon ? when : t("session.inDur", { dur })}`)
    );
  }
  fitStrip();
}

let sessionWasLocked = null; // null until the first reading with a clock: opening the app on a locked session stamps nothing

// A small padlock, drawn as an SVG (the font has none that lines up with the text)
const LOCK_SVG = '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3" y="7" width="10" height="7" rx="1.5"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2"/></svg>';
function lockBadge(text) {
  const el = node("span", "lkb");
  el.innerHTML = LOCK_SVG;
  el.append(text);
  return el;
}

// The lock, on the bars and on the right of the reset line:
//   ahead   the used bar is hatched from the % used to its end, the time bar from when it fills up to the reset, and a
//           chip says "Locks ~22:28 · 3h 21m off"
//   locked  the time bar is hatched from now to the reset (the time without Claude)
function paintSessionLock(m, f, { locked, lockAt, passed, level }) {
  const bar = $("sBar");
  const time = $("sTime");
  const ahead = lockAt !== null;
  bar.style.setProperty("--pj-l", ahead ? `${clamp100(f.used)}%` : "100%");
  bar.style.setProperty("--pj-w", ahead ? `${clamp100(100 - f.used)}%` : "0%");
  const start = f && f.resetsAt ? f.resetsAt - 5 * HOUR : 0;
  const lockPct = ahead ? clamp100(((lockAt - start) / (5 * HOUR)) * 100) : locked ? passed : 100;
  time.style.setProperty("--lk-l", `${lockPct}%`);
  time.style.setProperty("--lk-w", `${100 - lockPct}%`);
  time.querySelector(".ltick").classList.toggle("hidden", !ahead);
  const chip = $("sLock");
  chip.classList.toggle("hidden", !ahead);
  setLevelClass(chip, level === null || level === undefined ? 3 : Math.max(level, 2));
  if (!ahead) {
    setTip(chip, "slock", "");
    return;
  }
  const off = f.resetsAt - lockAt;
  chip.replaceChildren(lockBadge(t("session.locks", { time: `~${fmtTime(lockAt)}` })), node("span", "lk-b", `· ${t("session.off", { dur: fmtDur(off) })}`));
  setTip(chip, "slock", `~${fmtTime(lockAt)} · ${fmtDur(off)}`);
}

// The reset line gives way on its own, measured: first the countdown after the time, then the word before it, and only
// then the lock chip's "· 3h 21m off". The time and "Locks ~22:28" stay.
const STRIP_STEPS = ["", "no-b", "no-b no-a", "no-b no-a no-off"];
function fitStrip() {
  const strip = $("sResets");
  for (const step of STRIP_STEPS) {
    strip.classList.remove("no-a", "no-b", "no-off");
    if (step) strip.classList.add(...step.split(" "));
    if (strip.scrollWidth <= strip.clientWidth + 1) return;
  }
}
new ResizeObserver(() => fitStrip()).observe($("sResets"));

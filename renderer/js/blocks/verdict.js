// 01 Verdict: "can I use Claude until the reset?"
// The answer and its level on the first line; under it, chips: where the week ends, or when it hits the goal and for how long it
// stays locked, how much to slow down. Each chip is an icon, a word or two and the value, with the full sentence as its title.

// Why the verdict is what it is. When the level is high, add the pace that would still make it to the reset.
function verdictReason(m) {
  const h = m.head;
  if (m.forecast.kind === "out") return t("hero.sub.out");
  const rate = h.level >= 2 && m.perDay > 0
    ? ` ${t("reason.makeIt", { rate: t(evenWeights() ? "week.perDay" : "week.perNormalDay", { pct: pct(m.perDay) }) })}`
    : "";
  return h.reason + rate;
}

// The big number of the verdict and the words next to it ("86%", "at reset · in 4d 21h"), as the tray card shows them.
// The band in the Overview says it its own way, see bandFigures.
function verdictFigures(m) {
  const proj = m.lv.proj;
  const out = m.forecast.kind === "out";
  return {
    pct: out ? "100%" : proj ? `${r0(proj.projected)}%` : "–",
    when: out ? t("forecast.out") : proj ? t("verdict.when", { dur: fmtDur(m.w.resetsAt - m.now) }) : t("forecast.early"),
  };
}

// The chips of the second line. The first one says the most; fitChips() drops the last ones first when the line is narrow.
//   on its way to the goal   ◷ goal ~Mon 20:00 · ⊘ locked 12 h · ▼ slow down ~15%
//   under the plan           ◎ at reset 91% · + to spend ~6%
//   on the reserve           ◫ reserve 6% · ◷ lasts ~3h 20m
//   warming up               "Too early to tell" (words only)
// Then "! session first ~14:00" when the session runs out before the week, and "◫ reserve 10%" while a reserve is held.
function bandChips(m) {
  if (m.forecast.kind === "out") return [{ icon: "⊘", value: t("forecast.out"), title: t("hero.sub.out"), warn: true }];
  if (m.reserveMode) {
    const rate = weekPaceRecent(m.now);
    const left = reserveLeft(m.w.used, m.g);
    return [
      { icon: "◫", word: t("chip.reserve"), value: `${asShownPct(left)}%`, title: `${asShownPct(left)}% ${t("band.reserveLeft")}` },
      ...(rate ? [{ icon: "◷", word: t("chip.lasts"), value: `~${fmtDur(left / rate)}`, title: t("band.lasts", { dur: fmtDur(left / rate) }) }] : []),
    ];
  }
  if (m.forecast.kind === "early" || !m.lv.proj) return [{ value: t("forecast.early") }];
  const chips = [];
  const lock = m.lv.lock;
  if (m.lv.projection >= 1 && lock && lock.at !== null) {
    const when = `~${shortWeekday(new Date(lock.at))} ${fmtTime(lock.at)}`;
    chips.push({ icon: "◷", word: t("chip.goal"), value: when, title: `${t("band.out", { goal: m.g.goal })} ${when}` });
    chips.push({ icon: "⊘", word: t("chip.locked"), value: lockDur(lock.hours), title: t("band.early", { dur: lockDur(lock.hours) }), warn: true });
    // Slowing down by 90% or more means stopping: the chip says so instead of "slow down ~100%"
    if (m.lv.slow !== null) chips.push(m.lv.slow >= 90 ? { icon: "■", value: t("chip.stop"), title: t("band.slow", { pct: m.lv.slow }), warn: true } : { icon: "▼", word: t("chip.slow"), value: `~${m.lv.slow}%`, title: t("band.slow", { pct: m.lv.slow }) });
  } else {
    // Under the plan's ceiling: where the week ends, and how much would be left to spend at this pace
    const shown = asShownPct(m.lv.proj.projected);
    const ceil = asShownPct(m.ceiling);
    chips.push({ icon: "◎", word: t("chip.atReset"), value: `${shown}%`, title: `${shown}% ${t("band.atReset")}` });
    if (shown < ceil) chips.push({ icon: "+", word: t("chip.toSpend"), value: `~${ceil - shown}%`, title: t("band.toSpend", { pct: ceil - shown }) });
  }
  // "Session first" only for the session: when the week comes first, the goal chip already says it
  const first = limitsFirst(m);
  if (first && first.kind === "session") chips.push({ icon: "!", word: t("chip.first"), value: `~${fmtTime(first.ms)}`, title: t("band.first", { what: t("band.firstSession"), when: fmtTime(first.ms) }) });
  const held = Math.min(reserveHeld(m.now, m.w.resetsAt, m.g), reserveLeft(m.w.used, m.g));
  if (held > 0) {
    const relStart = m.g.release ? m.w.resetsAt - m.g.release * HOUR : null;
    const pctLeft = asShownPct(reserveLeft(m.w.used, m.g));
    const title = relStart !== null && relStart > m.now ? t("band.reserveMelts", { pct: pctLeft, when: fmtWhen(relStart, m.now) }) : t("band.reserveHeld", { pct: asShownPct(held) });
    chips.push({ icon: "◫", word: t("chip.reserve"), value: `${asShownPct(held)}%`, title });
  }
  return chips;
}

function paintChips(m) {
  $("vChips").replaceChildren(...bandChips(m).map((c) => {
    const el = node("span", `chip${c.warn ? " warn" : ""}${c.icon ? "" : " plain"}`);
    if (c.icon) el.append(node("i", "ci", c.icon));
    if (c.word) el.append(node("span", "cw", c.word));
    el.append(node("b", "cv", c.value));
    if (c.title) el.title = c.title;
    return el;
  }));
  fitChips();
}

// The chips that do not fit go, last first; then the first one loses its word (the icon and the value stay)
function fitChips() {
  const box = $("vChips");
  const chips = [...box.children];
  chips.forEach((c) => c.classList.remove("hidden", "bare"));
  for (let i = chips.length - 1; i > 0 && box.scrollWidth > box.clientWidth + 1; i--) chips[i].classList.add("hidden");
  if (chips[0] && box.scrollWidth > box.clientWidth + 1) chips[0].classList.add("bare");
}
new ResizeObserver(() => fitChips()).observe($("vChips"));

// The answer in one or two words, with a face. The face is decoration (aria-hidden): the level keeps its color, shape and word.
// In the first days of the week there is no projection yet, so the answer is "warming up" instead of a level.
// Each face is a few frames of a short loop (the CSS in overview.css times them). ASCII only, so the font never
// changes, and every frame of a face is as wide as the others. The first frame is the still one.
const VERDICT_FACES = [
  ["^.^", "-.-"], // Free: blinks
  [">.>", "<.<"], // Moderate: looks aside and back
  ["(o.o)/", "(o.o)_"], // Tight: waves a hand, calm down
  [" (O.O) ", "\\(O.O)/"], // Pause: a traffic guard raising both arms (the spaces keep both frames as wide)
];
const EARLY_FACE = ["o.o", "-.-", "-o-"]; // Warming up: dozes, yawns, wakes up
const ROOM_FACE = ["$.$", "-.-"]; // Room to spend: money eyes, blinks
const RESERVE_FACE = ["O.o", "o.O"]; // On the reserve: one eye, then the other
// The verdict's mode: "reserve" (using the emergency reserve), "room" (well under the plan), "early" or the level's key
function verdictMode(m) {
  if (m.reserveMode) return "reserve";
  if (m.forecast.kind === "early") return "early";
  return m.head.room ? "room" : LEVEL_KEYS[m.head.level];
}
function verdictAnswer(m) {
  const mode = verdictMode(m);
  if (mode === "reserve") return { text: t("hero.ans.reserve"), face: RESERVE_FACE };
  if (mode === "early") return { text: t("hero.ans.early"), face: EARLY_FACE };
  if (mode === "room") return { text: t("hero.ans.room"), face: ROOM_FACE };
  return { text: t(`hero.ans.${LEVEL_KEYS[m.head.level]}`), face: VERDICT_FACES[m.head.level] };
}

// The level the verdict shows. While the projection is still missing the level would rest on one
// noisy day, so it stays "not rated" (null), unless the week is already so far gone that it reads Pause.
function verdictLevel(m) {
  return m.forecast.kind === "early" && !weekAtPause(m.w.used) ? null : m.head.level;
}

// The face plays for a burst of about 10 s when the level changes or a new reading arrives, then one loop every
// 30 s. Never while the window is hidden or another screen is open; prefers-reduced-motion stops it in the CSS.
const FACE_BURST_MS = 10000;
const FACE_REST_MS = 30000;
let faceBurst = null;
let faceRest = null;

// Puts the frames in place; true when the face changed
function paintFace(box, frames, key) {
  const sig = `${key}:${frames.join("|")}`;
  if (box.dataset.sig === sig) return false;
  box.dataset.sig = sig;
  box.dataset.face = key;
  box.replaceChildren(...frames.map((f) => node("span", "", f)));
  return true;
}
function faceStop() {
  clearTimeout(faceBurst);
  clearInterval(faceRest);
  faceBurst = null;
  faceRest = null;
  $("vFace").classList.remove("play", "once");
}
const faceCanPlay = () => !document.hidden && state.view === "panel";
function faceOnce() {
  if (!faceCanPlay()) return;
  const face = $("vFace");
  face.classList.remove("once");
  void face.offsetWidth; // restart the loop
  face.classList.add("once");
}
// The quiet part: one loop every 30 s, if nothing is running yet
function faceResume() {
  if (faceBurst || faceRest || !faceCanPlay()) return;
  faceRest = setInterval(faceOnce, FACE_REST_MS);
}
function faceKick() {
  faceStop();
  if (!faceCanPlay()) return;
  $("vFace").classList.add("play");
  faceBurst = setTimeout(() => {
    faceBurst = null;
    $("vFace").classList.remove("play");
    faceResume();
  }, FACE_BURST_MS);
}
$("vFace").addEventListener("animationend", () => $("vFace").classList.remove("once"));
document.addEventListener("visibilitychange", () => (document.hidden ? faceStop() : faceResume()));

function renderVerdict(m, fresh = false) {
  const level = verdictLevel(m);
  paintChips(m);

  const answer = verdictAnswer(m);
  $("vAns").textContent = answer.text;
  const mode = verdictMode(m);
  if (paintFace($("vFace"), answer.face, mode) || fresh) faceKick();
  else faceResume();
  // The answer and the cursor take the level's color; room and the reserve take the accent
  const ans = $("vAns").parentElement;
  if (mode === "room" || mode === "reserve") {
    ans.classList.remove(...LEVEL_CLASSES);
    ans.classList.add(`lv-${mode}`);
  } else setLevelClass(ans, level);
  if (mode === "room") {
    $("vLevel").classList.remove(...LEVEL_CLASSES);
    $("vLevel").classList.add("lv-room");
    $("vLevel").querySelector(".lvn").textContent = t("level.room.name");
  } else paintLevel($("vLevel"), level);

  // The ruler: Room first, then the four levels. Room lights instead of Free.
  const ruler = $("vRuler");
  const lit = mode === "room" ? 0 : level === null ? -1 : level + 1;
  ruler.setAttribute("aria-label", t("hero.levelAria", { level: mode === "room" ? t("level.room.name") : lvName(level) }));
  [...ruler.children].forEach((span, i) => span.classList.toggle("on", i === lit));
  fitBand();

  // The long explanation lives in the Math drawer; the band only carries it as a tooltip
  $("vScr").title = verdictTexts(m).reason;
}

// The first line of the band gives way on its own (the chips under it have fitChips). Measured, since the room changes
// with the level, the language and the window: no fixed breakpoint fits them all.
// Line 1, the answer and the level: whole (the ruler shows only the lit level, with its name), then the shape without
// its name, then closer together and without the blinking cursor (the face, the answer and the shape keep the level's
// color and shape), and only then the shape under the words.
const TOP_STEPS = [{}, { bare: true }, { bare: true, snug: true }, { bare: true, snug: true, wrap: true }];
function fitBand() {
  const top = $("vTop");
  const vl = top.parentElement;
  const hasLit = Boolean($("vRuler").querySelector(".on")); // with no level lit, the shapes all stay
  for (const step of TOP_STEPS) {
    if (step.bare && !hasLit && !step.wrap) continue;
    vl.classList.toggle("lit-bare", Boolean(step.bare) && hasLit);
    top.classList.toggle("snug", Boolean(step.snug));
    top.classList.toggle("wrap", Boolean(step.wrap));
    if (step.wrap || top.scrollWidth <= top.clientWidth + 1) break;
  }
}
new ResizeObserver(() => fitBand()).observe($("vTop"));

// The longer words behind the verdict: why, what to do, and when it eases. Shown in the Math drawer.
function verdictTexts(m) {
  const h = m.head;
  return {
    reason: verdictReason(m),
    guide: h.guide,
    until: h.until
      ? t(h.next === 0 ? "hero.backToFree" : "hero.easesTo", { level: levelName(h.next), when: fmtWhen(h.until, m.now) })
      : h.level === 0 ? "" : t("hero.nothingHolding"),
  };
}

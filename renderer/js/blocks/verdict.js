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
  // On its way past the limit: the week cannot end above 100%, so it says 100% and when the limit comes, as the band's chip does
  const lock = m.lv.lock;
  if (!out && proj && m.lv.projection >= 1 && lock && lock.at !== null) {
    return { pct: "100%", when: `${t("chip.goal")} ~${shortWeekday(new Date(lock.at))} ${fmtTime(lock.at)}` };
  }
  return {
    pct: out ? "100%" : proj ? `${r0(Math.min(proj.projected, 100))}%` : "–",
    when: out ? t("forecast.out") : proj ? t("verdict.when", { dur: fmtDur(m.w.resetsAt - m.now) }) : t("forecast.early"),
  };
}

// The chips of the second line. The first one says the most; fitChips() drops the last ones first when the line is narrow.
//   on its way to the goal   ◷ goal ~Mon 20:00 · ⊘ locked 12 h · ▼ slow down ~15%
//   under the plan           nothing: the week bar shows where the week ends and what is left over
//   on the reserve           ◫ reserve 6% · ◷ lasts ~3h 20m
//   warming up               "Too early to tell" (words only)
// Then "! session first ~14:00" when the session runs out before the week, and "◫ reserve 10%" while a reserve is held.
// The weekly reset always comes last, quiet: "↻ Tue 08:00 · 16h 13m".
function bandChips(m) {
  return [...stateChips(m), resetChip(m)];
}
function resetChip(m) {
  const when = `${shortWeekday(new Date(m.w.resetsAt))} ${fmtTime(m.w.resetsAt)}`;
  return { icon: "↻", value: `${when} · ${fmtDur(m.w.resetsAt - m.now)}`, short: when, title: t("chip.resetTitle", { when }), quiet: true };
}
function stateChips(m) {
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
  }
  // "Session first" only for the session: when the week comes first, the goal chip already says it
  const first = limitsFirst(m);
  if (first && first.kind === "session") chips.push({ icon: "!", word: t("chip.first"), value: `~${fmtTime(first.ms)}`, title: t("band.first", { what: t("band.firstSession"), when: fmtTime(first.ms) }) });
  const held = Math.min(reserveHeld(m.now, m.w.resetsAt, m.g), reserveLeft(m.w.used, m.g));
  if (held > 0) {
    const rw = reserveWindow(m.w.resetsAt, m.g);
    const relStart = rw ? rw.from : null;
    const pctLeft = asShownPct(reserveLeft(m.w.used, m.g));
    const title = relStart !== null && relStart > m.now ? t("band.reserveMelts", { pct: pctLeft, when: fmtWhen(relStart, m.now) }) : t("band.reserveHeld", { pct: asShownPct(held) });
    chips.push({ icon: "◫", word: t("chip.reserve"), value: `${asShownPct(held)}%`, title });
  }
  return chips;
}

function paintChips(m) {
  $("vChips").replaceChildren(...bandChips(m).map((c) => {
    const el = node("span", `chip${c.warn ? " warn" : ""}${c.icon ? "" : " plain"}${c.quiet ? " quiet" : ""}`);
    if (c.icon) el.append(node("i", "ci", c.icon));
    if (c.word) el.append(node("span", "cw", c.word));
    if (c.icon) el.append(node("span", "cl")); // the dotted leader to the value
    el.append(node("b", "cv", c.value));
    if (c.short) Object.assign(el.dataset, { full: c.value, short: c.short });
    if (c.quiet) setTip(el, "wreset", c.title);
    else if (c.title) setTip(el, "plain", c.title, Boolean(c.warn));
    return el;
  }));
  fitChips();
}

// The readout's rows give way on their own. A row too wide loses its word (the icon, the leader and the value stay), then
// a value with a shorter form (the reset without its countdown) takes it. Rows that do not fit the height go, last first.
function fitChips() {
  const box = $("vChips");
  const rows = [...box.children];
  const wide = (r) => r.scrollWidth > r.clientWidth + 1;
  rows.forEach((r) => {
    r.classList.remove("hidden", "bare");
    if (r.dataset.full) r.querySelector(".cv").textContent = r.dataset.full;
  });
  for (const r of rows) {
    if (wide(r)) r.classList.add("bare");
    if (r.dataset.short && wide(r)) r.querySelector(".cv").textContent = r.dataset.short;
  }
  box.classList.remove("none");
  for (let i = rows.length - 1; i >= 0 && box.scrollHeight > box.clientHeight; i--) rows[i].classList.add("hidden");
  box.classList.toggle("none", rows.length > 0 && rows.every((r) => r.classList.contains("hidden"))); // no room for a row: no rule either
}
new ResizeObserver(() => fitChips()).observe($("vChips"));

// The verdict's mode: "locked" (the limit is reached), "reserve" (using the emergency reserve), "early", "room" (well
// under the plan) or the level's key
function verdictMode(m) {
  if (m.forecast.kind === "out") return "locked";
  if (m.reserveMode) return "reserve";
  if (m.forecast.kind === "early") return "early";
  return m.head.room ? "room" : LEVEL_KEYS[m.head.level];
}
// The answer's short why, one line under it. The longer one (verdictReason) is the verdict's tooltip.
function verdictWhy(m) {
  const mode = verdictMode(m);
  const first = limitsFirst(m);
  if (mode !== "locked" && first && first.kind === "session") return t("why.session");
  return t(`why.${mode}`);
}
// The answer in one or two words, and the face at rest for the mode (the tray card shows it, still). The face is
// decoration (aria-hidden): the level keeps its color, shape and word. It lives in face.js.
function verdictAnswer(m) {
  const mode = verdictMode(m);
  const text = ["reserve", "early", "room"].includes(mode) ? t(`hero.ans.${mode}`) : t(`hero.ans.${LEVEL_KEYS[m.head.level]}`);
  return { text, face: [faceText(faceRest({ mode }))] };
}

// The level the verdict shows. While the projection is still missing the level would rest on one
// noisy day, so it stays "not rated" (null), unless the week is already so far gone that it reads Pause.
function verdictLevel(m) {
  return m.forecast.kind === "early" && !weekAtPause(m.w.used, hoursToReset(m)) ? null : m.head.level;
}

// Inside the active hours (Settings > Plan), or all day when there are none
function inActiveHours(ms) {
  const a = activeHours();
  return !a || activeSpans(ms, a).some(([from, to]) => ms >= from && ms < to);
}

function renderVerdict(m, fresh = false) {
  const level = verdictLevel(m);
  paintChips(m);

  const answer = verdictAnswer(m);
  $("vAns").textContent = answer.text;
  setText($("vWhy"), verdictWhy(m));
  const mode = verdictMode(m);
  // The answer, the cursor and the face take the level's color; room and the reserve take the accent
  const ans = $("vAns").parentElement;
  for (const el of [ans, $("vSlot")]) {
    if (mode === "room" || mode === "reserve") {
      el.classList.remove(...LEVEL_CLASSES);
      el.classList.add(`lv-${mode}`);
    } else setLevelClass(el, level);
  }
  renderFace(m, mode, fresh);
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

  // The long explanation lives in the Math drawer; the verdict's tip carries the reason
  setTip($("vScr").querySelector(".vl"), "verdict", verdictTexts(m).reason);
}

// The answer gives way on its own when it is too wide for the room next to the face: first the blinking cursor goes, then
// the face gets smaller (the cursor back, then gone again), then the answer moves under the full face (centered, as a
// column), then the cursor goes there too. The why under the answer is
// whole or not there at all. Measured, since the room changes with the level, the language and the window. (The ruler
// drops the names of the levels that are not lit in a narrow verdict, in the CSS.) Then the readout fits what is left.
const TOP_STEPS = [[], ["snug"], ["small"], ["small", "snug"], ["stack"], ["stack", "snug"]];
function fitBand() {
  const top = $("vTop");
  const vl = $("vCard");
  const why = $("vWhy");
  why.classList.remove("hidden");
  for (const step of TOP_STEPS) {
    top.classList.toggle("snug", step.includes("snug"));
    vl.classList.toggle("small", step.includes("small"));
    vl.classList.toggle("stack", step.includes("stack"));
    if (top.scrollWidth <= top.clientWidth + 1) break;
  }
  if (!why.textContent || why.scrollHeight > why.clientHeight + 1 || why.scrollWidth > why.clientWidth + 1) why.classList.add("hidden");
  // The ruler: the names of the levels that are not lit go when they do not fit
  const ruler = $("vRuler");
  ruler.classList.remove("bare");
  if ([...ruler.children].some((s) => s.scrollWidth > s.clientWidth + 1)) ruler.classList.add("bare");
  fitChips();
}
new ResizeObserver(() => fitBand()).observe($("vCard"));

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

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
//
// The face has a small screen of its own, left of the answer. Each part of it means one thing, so a new face stays readable:
//   eyes   how much you can relax: ^ happy, o watching, O alarmed, - closed, x failed, ? lost
//   mouth  the tension: . relaxed, _ tense, o surprised
//   marks  ; sweat (worry), ! alarm; a z rises while it sleeps
//   arms   only in the good moments: a new week, the first hello of the day
// So the levels read from the eyes alone: ^.^ o.o o_o; O_O!. ASCII only, so the font never changes. The screen has a fixed
// width, so the frames of a face need not be as wide as each other; a long face is drawn smaller to fit (faceFit).
//
// frames[0] is the still face (the tray card shows it). acts are what it does now and then: a weight, the frames to show and
// for how long (it goes back to frames[0] after), and an effect: "hop", "shake", "squash", "glance" (it looks down at the
// chart and today's point there pings) or "zz" (a z rises). poke is the face for a click on it.
const FACES = {
  room: { frames: ["^.~", "~.^", "^o^"], poke: "^o^", acts: [{ w: 3, seq: [[1, 500]] }, { w: 2, seq: [[2, 800]], fx: "hop" }] }, // Room to spend: a wink, swaps eyes, smiles
  free: { frames: ["^.^", "-.-", "^o^"], poke: "^o^", acts: [{ w: 5, seq: [[1, 140]] }, { w: 2, seq: [[1, 110], [0, 120], [1, 110]] }, { w: 2, seq: [[2, 900]], fx: "hop" }] }, // Free: blinks, smiles
  moderate: { frames: ["o.o", "._.", "-.-"], poke: "O.O", acts: [{ w: 4, seq: [[1, 1000]], fx: "glance" }, { w: 4, seq: [[2, 140]] }] }, // Moderate: watches, glances at the chart
  tight: { frames: ["o_o;", "-_-;", "._.;"], poke: "O_O;", acts: [{ w: 3, seq: [[1, 600]] }, { w: 3, seq: [[2, 1000]], fx: "glance" }, { w: 2, seq: [[0, 400]], fx: "squash" }] }, // Tight: sweats, wipes it, glances at the chart, gulps
  pause: { frames: ["O_O!", "-_-!"], poke: ">_<!", acts: [{ w: 4, seq: [[0, 500]], fx: "shake" }, { w: 3, seq: [[1, 90]] }] }, // Pause: alarmed, shakes, quick blinks
  locked: { frames: ["T_T", "T.T", "TOT"], poke: "TOT", acts: [{ w: 3, seq: [[1, 220], [0, 220], [1, 220]], fx: "squash" }, { w: 1, seq: [[2, 700]], fx: "shake" }] }, // Limit reached: cries and sobs
  early: { frames: ["'.'", "-.-", "'o'"], poke: "O.O", acts: [{ w: 4, seq: [[1, 500]] }, { w: 2, seq: [[2, 900]] }] }, // Warming up: small sleepy eyes, slow blinks, yawns
  reserve: { frames: ["O_o", "o_O", "O_o;"], poke: "o_O!", acts: [{ w: 4, seq: [[1, 500], [0, 500], [1, 500]] }, { w: 2, seq: [[2, 1100]] }] }, // On the reserve: one eye, then the other
  // What the app is doing comes before the level, in the muted color, so the color keeps saying only the level
  reading: { frames: ["o.o", "<.<", ">.>"], tone: "muted", loop: [[1, 260], [0, 200], [2, 260], [0, 200]] }, // A reading: the eyes run along the page
  error: { frames: ["x.x"], tone: "muted", enter: "shake" }, // The last reading failed, until one works
  login: { frames: ["?.?"], tone: "muted", hold: "tilt" }, // Claude asks to sign in again
  asleep: { frames: ["-.-"], tone: "dim", poke: "o.O", gap: [1800, 3200], acts: [{ w: 1, seq: [[0, 0]], fx: "zz" }] }, // Outside the active hours: sleeps
};
// One-off moments; then the face goes back to what it was doing. Steps are [frame, ms, effect].
const FACE_MOMENTS = {
  reset: { frames: ["\\(^o^)/", "(^o^)"], seq: [[0, 320, "hop"], [1, 320], [0, 320, "hop"], [1, 320], [0, 320, "hop"], [1, 320], [0, 320, "hop"], [1, 320]] }, // a new week
  hello: { frames: ["^o^/", "^o^-"], seq: [[0, 280, "hop"], [1, 280], [0, 280], [1, 280], [0, 280], [1, 280], [0, 600]] }, // the first time the Overview shows today
  jump: { frames: ["O.O", "._."], seq: [[0, 600, "shake"], [1, 1200, "glance"]] }, // a new reading went up a lot
  worse: { frames: ["O.O"], seq: [[0, 750, "shake"]] }, // the level got worse
  better: { frames: ["^o^"], seq: [[0, 700, "hop"]] }, // the level got better
  relief: { frames: ["^_^;", "-_-;"], seq: [[0, 1400, "hop"], [1, 500], [0, 1400], [1, 500], [0, 1600]] }, // back to Free from Tight or worse: relieved, still sweating
};
// How bad each verdict is, to tell worse from better (Warming up sits with Free)
const FACE_RANK = { room: 0, free: 1, early: 1, moderate: 2, tight: 3, pause: 4, reserve: 4, locked: 5 };
const FACE_JUMP = 5; // points of the week between two readings that make it jump; under half a point it only nods
// The pace sets its energy, the time between two acts: slow, on pace, fast (with no pace, on pace)
const FACE_GAPS = [[8000, 15000], [3000, 12000], [2000, 5000]];

// The verdict's mode: "locked" (the limit is reached), "reserve" (using the emergency reserve), "early", "room" (well
// under the plan) or the level's key
function verdictMode(m) {
  if (m.forecast.kind === "out") return "locked";
  if (m.reserveMode) return "reserve";
  if (m.forecast.kind === "early") return "early";
  return m.head.room ? "room" : LEVEL_KEYS[m.head.level];
}
function verdictAnswer(m) {
  const mode = verdictMode(m);
  const text = ["reserve", "early", "room"].includes(mode) ? t(`hero.ans.${mode}`) : t(`hero.ans.${LEVEL_KEYS[m.head.level]}`);
  return { text, face: FACES[mode].frames };
}

// The level the verdict shows. While the projection is still missing the level would rest on one
// noisy day, so it stays "not rated" (null), unless the week is already so far gone that it reads Pause.
function verdictLevel(m) {
  return m.forecast.kind === "early" && !weekAtPause(m.w.used) ? null : m.head.level;
}

// Inside the active hours (Settings > Plan), or all day when there are none
function inActiveHours(ms) {
  const a = activeHours();
  return !a || activeSpans(ms, a).some(([from, to]) => ms >= from && ms < to);
}

// What the face shows: what the app is doing first (a reading, a failed one, asleep), then the verdict's mode
function faceKey(m, mode) {
  if (typeof syncBusy !== "undefined" && syncBusy) return "reading";
  if (state.syncFail === "need-login") return "login";
  if (state.syncFail) return "error";
  if (!inActiveHours(m.now)) return "asleep";
  return mode;
}

// ---- The face's player ----
// One timer at a time. It plays only while the Overview is on screen and motion is allowed; otherwise the face holds its
// still frame. The new week and the hello wait until it can play.
const face = { key: null, token: 0, timer: null, live: false, fit: null, pending: null, used: null, today: null, zone: null, glance: null };
const faceReduced = () => Boolean(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
const faceCanPlay = () => !document.hidden && state.view === "panel" && !faceReduced();
// The new week and the day of the last hello live in this window's storage
function faceStore(k, v) {
  try {
    if (v === undefined) return localStorage.getItem(`face.${k}`);
    localStorage.setItem(`face.${k}`, String(v));
  } catch {
    return null;
  }
  return null;
}

function faceShow(text) {
  $("vFace").textContent = text;
}
// The face's size comes from the CSS; a face too long for the screen gets a smaller one (Plex Mono is 0.6em a character)
function faceFit(frames) {
  face.fit = frames;
  const fc = $("vFace");
  const slot = $("vSlot");
  fc.style.fontSize = "";
  const room = slot.clientWidth - 2 * (parseFloat(getComputedStyle(slot).paddingLeft) || 0);
  const size = parseFloat(getComputedStyle(fc).fontSize) || 0;
  const chars = Math.max(...frames.map((f) => f.length));
  if (room > 0 && chars * 0.6 * size > room) fc.style.fontSize = `${Math.floor(room / (chars * 0.6))}px`;
}
new ResizeObserver(() => face.fit && faceFit(face.fit)).observe($("vSlot"));

function faceFx(name) {
  if (!name || faceReduced()) return;
  if (name === "glance") {
    const plot = $("plot");
    plot.classList.remove("glance");
    void plot.offsetWidth; // restart the ping
    plot.classList.add("glance");
    clearTimeout(face.glance);
    face.glance = setTimeout(() => plot.classList.remove("glance"), 1900);
    return;
  }
  if (name === "zz") {
    const z = node("span", "zz", Math.random() < 0.5 ? "z" : "Z");
    z.addEventListener("animationend", () => z.remove());
    $("vSlot").append(z);
    return;
  }
  const fc = $("vFace");
  fc.classList.remove("hop", "shake", "squash");
  void fc.offsetWidth;
  fc.classList.add(name);
}
$("vFace").addEventListener("animationend", (e) => e.animationName !== "face-tilt" && $("vFace").classList.remove("hop", "shake", "squash"));

// Plays steps [frame, ms, effect], then calls done
function facePlay(frames, seq, done) {
  const my = ++face.token;
  clearTimeout(face.timer);
  face.live = true;
  let i = 0;
  const step = () => {
    if (my !== face.token) return;
    if (i >= seq.length) return done();
    const [f, ms, fx] = seq[i++];
    faceShow(frames[f]);
    faceFx(fx);
    face.timer = setTimeout(step, ms);
  };
  step();
}

// The still face, then the next act after a pause (or the loop, for a reading)
function faceSettle() {
  const f = FACES[face.key];
  ++face.token;
  clearTimeout(face.timer);
  face.live = false;
  faceFit(f.frames);
  faceShow(f.frames[0]);
  if (!faceCanPlay()) return;
  if (f.loop) return facePlay(f.frames, f.loop, faceSettle);
  if (!f.acts) return;
  const [lo, hi] = f.gap || FACE_GAPS[face.zone ?? 1];
  face.live = true;
  face.timer = setTimeout(() => {
    let r = Math.random() * f.acts.reduce((s, a) => s + a.w, 0);
    const act = f.acts.find((a) => (r -= a.w) < 0) || f.acts[0];
    facePlay(f.frames, act.seq.map((s, i) => (i === 0 ? [s[0], s[1], act.fx] : s)), faceSettle);
  }, lo + Math.random() * (hi - lo));
}

function faceMoment(name) {
  if (!faceCanPlay()) {
    if (name === "reset" || name === "hello") face.pending = name;
    return faceSettle();
  }
  face.pending = null;
  if (name === "reset" || name === "hello") faceStore("hello", face.today); // a new week says hello too
  const mo = FACE_MOMENTS[name];
  faceFit(mo.frames);
  facePlay(mo.frames, mo.seq, faceSettle);
}

function faceStop() {
  ++face.token;
  clearTimeout(face.timer);
  face.live = false;
  $("vFace").style.translate = "";
  if (face.key) faceShow(FACES[face.key].frames[0]);
}
function faceResume() {
  if (!face.key || face.live || !faceCanPlay()) return;
  if (face.pending) return faceMoment(face.pending);
  faceSettle();
}
document.addEventListener("visibilitychange", () => (document.hidden ? faceStop() : faceResume()));

// The head turns a few pixels toward the pointer
let facePoint = null;
function faceLook() {
  const p = facePoint;
  facePoint = null;
  const r = $("vSlot").getBoundingClientRect();
  if (!p || !r.width) return;
  const dx = p.x - (r.left + r.width / 2);
  const dy = p.y - (r.top + r.height / 2);
  const d = Math.hypot(dx, dy) || 1;
  const k = Math.min(1, d / 260);
  $("vFace").style.translate = `${((dx / d) * k * 6).toFixed(1)}px ${((dy / d) * k * 3.5).toFixed(1)}px`;
}
document.addEventListener("pointermove", (e) => {
  if (!faceCanPlay()) return;
  if (!facePoint) requestAnimationFrame(faceLook);
  facePoint = { x: e.clientX, y: e.clientY };
});
document.addEventListener("mouseout", (e) => !e.relatedTarget && ($("vFace").style.translate = ""));
// A click on the face: it reacts
$("vSlot").addEventListener("click", () => {
  const f = FACES[face.key];
  if (f && f.poke && faceCanPlay()) facePlay([f.poke], [[0, 700, "squash"]], faceSettle);
});

// Picks what the face does after a render: a new week, a change of level, a new reading, the day's hello, or just carry on
function renderFace(m, mode, fresh) {
  const key = faceKey(m, mode);
  const prev = face.key;
  const ranked = (k) => FACE_RANK[k] !== undefined;
  face.key = key;
  face.zone = paceZone(m);
  face.today = dayKey(m.now);
  const f = FACES[key];
  $("vSlot").classList.toggle("muted", f.tone === "muted");
  $("vSlot").classList.toggle("dim", f.tone === "dim");
  $("vFace").classList.toggle("tilt", f.hold === "tilt" && !faceReduced());
  const delta = face.used === null ? null : m.w.used - face.used;
  face.used = m.w.used;

  // A new week: the reset moved on by days since the face last saw it (a few minutes either way is the same week)
  const seen = Number(faceStore("week")) || 0;
  const week = m.w.resetsAt || 0;
  if (week && week !== seen) faceStore("week", week);
  if (seen && week - seen > 2 * DAY) return faceMoment("reset");

  if (prev && key !== prev && ranked(key) && ranked(prev) && FACE_RANK[key] !== FACE_RANK[prev]) {
    const from = FACE_RANK[prev];
    const to = FACE_RANK[key];
    return faceMoment(to > from ? "worse" : from >= 3 && to <= 1 ? "relief" : "better");
  }
  if (fresh && ranked(key) && delta !== null && delta >= FACE_JUMP) return faceMoment("jump");
  if (key !== prev) {
    faceSettle();
    if (prev && f.enter && faceCanPlay()) faceFx(f.enter);
  }
  if (fresh && ranked(key) && delta !== null && Math.abs(delta) < 0.5 && faceCanPlay()) faceFx("squash"); // a nod: nothing new
  if (ranked(key) && faceStore("hello") !== face.today) return faceMoment("hello"); // waits for the Overview when it is not on screen
  faceResume();
}

function renderVerdict(m, fresh = false) {
  const level = verdictLevel(m);
  paintChips(m);

  const answer = verdictAnswer(m);
  $("vAns").textContent = answer.text;
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
  const vl = top.closest(".vl");
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

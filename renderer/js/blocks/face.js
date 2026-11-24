// 01 Verdict, the face. Decoration only (aria-hidden): the level is in the words, the ruler and the color.
//
// The face is built from parts, each with one meaning, so a new face stays readable:
//   eyes   how much you can relax: ^ happy, ' small (warming up), o watching, O alarmed, - closed, = tired, T crying,
//          ? lost, < > reading, > < squeezed shut
//   mouth  the tension: v grin, . relaxed, _ tense, o surprised, - relieved, w giggling
//   marks  ; sweat (the session is heavy), ! alarm (the session locks before its reset), ? the last reading failed
//   arms   only in the good moments: a new week, a hello on a calm day, the session back
// ASCII only, so the font never changes.
//
// Its mood has layers. The week's mode is the base. The session adds the tension (sweat, alarm, eyes closed while it
// is locked). The pace sets how fast it blinks and breathes. The hour: outside the active hours it sleeps when nothing is
// at risk, and stays up, tired, when the week is Tight or worse. The past: after a week that hit the limit, Free looks
// relieved. Errors never hide the mood: a failed reading adds a small ?, and offline the screen only dims.
//
// Every reaction has a cause (a new reading, a change of level, the session locking or coming back, a new week, the
// first hello of the day, a click). Left alone it only blinks and breathes, and now and then looks at what is wrong:
// the chart (the week is at risk), the session (it locks), or Refresh (the numbers are old). With nothing wrong it does
// not look anywhere. An alarm reacts once, on the way in, and then stays still and tense.

const FACE_BASE = {
  room: ["^", "v", "^"], // well under the plan
  free: ["^", ".", "^"],
  early: ["'", ".", "'"], // warming up: small, sleepy eyes
  moderate: ["o", ".", "o"],
  tight: ["o", "_", "o"],
  pause: ["O", "_", "O"],
  reserve: ["O", "_", "o"], // on the reserve: one eye wide
  locked: ["-", "_", "-"], // the limit is reached: after a cry on the way in it waits, eyes closed
};
// How bad each mode is, to tell worse from better (warming up sits with Free)
const FACE_RANK = { room: 0, free: 1, early: 1, moderate: 2, tight: 3, pause: 4, reserve: 4, locked: 5 };
// The worst mode it sleeps through outside the active hours: from Tight on it stays up
const FACE_SLEEPS_TO = FACE_RANK.moderate;
const FACE_JUMP = 5; // points of the week between two readings that make it flinch; under half a point it only blinks
// Seconds between blinks and the length of a breath, by the pace: slow, on pace, fast. From Tight on, quicker still.
const FACE_BLINK = [6.5, 4.2, 2.4];
const FACE_BREATH = [5, 3.6, 2.2];
const FACE_STRESS = (rank) => (rank >= 4 ? 0.6 : rank === 3 ? 0.8 : 1);
const FACE_GLANCE = [25000, 45000]; // ms between two looks at what is wrong
const FACE_ZZ = [1800, 3200]; // ms between two z's while it sleeps
// Every effect a step may play (overview.css has each one)
const FACE_EFFECTS = ["hop", "shake", "squash", "flinch", "gasp", "exhale", "stretch", "sob", "nudge", "zz"];

const facePart = (l, m, r, more = {}) => ({ pre: "", post: "", k: "", ...more, l, m, r });
const faceText = (p) => p.pre + p.l + p.m + p.r + p.post + p.k;

// The face at rest. ctx: { mode, night, sess: "calm" | "heavy" | "ahead" | "locked", fail, relief }
function faceRest(ctx) {
  const mode = FACE_BASE[ctx.mode] ? ctx.mode : "free";
  const rank = FACE_RANK[mode];
  const [l, m, r] = FACE_BASE[mode];
  const p = facePart(l, m, r);
  if (ctx.night && rank <= FACE_SLEEPS_TO && ctx.sess !== "ahead") return { ...facePart("-", ".", "-"), asleep: true };
  if (ctx.relief && (mode === "room" || mode === "free")) p.m = "-";
  if (ctx.night && mode !== "locked") p.l = p.r = "=";
  if (mode !== "locked") {
    if (ctx.sess === "heavy") p.k = ";";
    else if (ctx.sess === "ahead") p.k = "!";
    else if (ctx.sess === "locked") Object.assign(p, { l: "-", m: "_", r: "-" });
  }
  if (ctx.fail) p.k += "?";
  return p;
}

// The steps of a reaction: [{ f: parts (null: the face at rest), ms, fx, look, scr }]. r is the face it showed, n the face
// it is going to; rank is the mode's (the new one's, for a change); asleep says it was asleep.
const FACE_READING = [
  { f: facePart("<", ".", "<"), ms: 260 },
  { f: facePart("o", ".", "o"), ms: 200 },
  { f: facePart(">", ".", ">"), ms: 260 },
  { f: facePart("o", ".", "o"), ms: 200 },
];
const faceSob = (n) => {
  const a = { ...n, l: "T", m: "_", r: "T", k: "" };
  const b = { ...n, l: "T", m: ".", r: "T", k: "" };
  return [{ f: a, ms: 320, fx: "sob" }, { f: b, ms: 320, fx: "sob" }, { f: a, ms: 320, fx: "sob" }, { f: b, ms: 700 }];
};
const FACE_STEPS = {
  // A new reading with nothing new: one calm blink
  nod: ({ r }) => [{ f: { ...r, l: "-", r: "-" }, ms: 140 }],
  // A new reading that went up a lot: a flinch, then a look at the chart, where it went up
  jump: ({ r, n }) => [{ f: { ...n, l: "O", m: "o", r: "O" }, ms: 500, fx: "flinch" }, { f: n, ms: 1300, look: "chart" }],
  // The level got worse: a gasp, then the new face, eyes first and the mouth after. It shakes only on reaching Pause,
  // and cries on reaching the limit.
  worse: ({ r, n, rank }) => (rank >= FACE_RANK.locked ? faceSob(n) : [
    { f: { ...r, l: "O", m: "o", r: "O" }, ms: 380, fx: "gasp" },
    { f: { ...n, m: r.m }, ms: 220 },
    { f: n, ms: rank >= FACE_RANK.pause ? 600 : 10, fx: rank >= FACE_RANK.pause ? "shake" : undefined },
  ]),
  // The level got better: it lets the air out, then the new face. A hop only when back to Free or better.
  better: ({ r, n, rank }) => [
    { f: { ...r, l: "-", m: "o", r: "-" }, ms: 700, fx: "exhale" },
    { f: { ...n, m: r.m }, ms: 220 },
    { f: n, ms: rank <= FACE_RANK.free ? 450 : 10, fx: rank <= FACE_RANK.free ? "hop" : undefined },
  ],
  // The session will lock before its reset: it looks at the session, and the alarm stays
  ahead: ({ r, n }) => [{ f: r, ms: 500, look: "session" }, { f: n, ms: 900, look: "session", fx: "nudge" }],
  // The session locked: a start, then the eyes close and it waits
  locks: ({ r, n }) => [{ f: { ...r, l: "O", r: "O" }, ms: 400, look: "session" }, { f: n, ms: 900, fx: "exhale" }],
  // The session is back: a stretch
  back: () => [
    { f: facePart("-", "o", "-", { pre: "\\(", post: ")/" }), ms: 800, fx: "stretch" },
    { f: facePart("^", "o", "^", { pre: "\\(", post: ")/" }), ms: 500 },
  ],
  // A new week: a party
  reset: () => {
    const up = facePart("^", "o", "^", { pre: "\\(", post: ")/" });
    const down = facePart("^", "o", "^", { pre: "(", post: ")" });
    return [up, down, up, down, up, down].map((f, i) => ({ f, ms: 330, fx: i % 2 ? undefined : "hop" }));
  },
  // A reading failed: static on the screen and a lost look, then back to the mood with a small ?
  fail: ({ r }) => [{ f: { ...r, l: "?", m: ".", r: "?", k: "" }, ms: 1000, fx: "nudge", scr: "static" }],
  // The first time the Overview shows today: it waves the way it feels. From Pause on it only looks at you.
  hello: ({ r, rank, asleep }) => {
    if (asleep) return [{ f: { ...r, l: "o" }, ms: 700 }];
    if (rank <= FACE_RANK.free) {
      const a = { ...r, m: "o", post: "/" };
      const b = { ...r, m: "o", post: "-" };
      return [{ f: a, ms: 300, fx: "hop" }, { f: b, ms: 300 }, { f: a, ms: 300 }, { f: b, ms: 300 }, { f: a, ms: 500 }];
    }
    if (rank === FACE_RANK.moderate) return [{ f: { ...r, post: "/" }, ms: 900 }];
    if (rank === FACE_RANK.tight) return [{ f: { ...r, l: "-", r: "-", post: "/" }, ms: 500 }, { f: { ...r, post: "/" }, ms: 600 }];
    return [{ f: r, ms: 1100, look: "you" }];
  },
  // A click on it: it giggles when calm, starts when watching, squeezes its eyes when tense, and half wakes at night
  poke: ({ r, rank, asleep }) => {
    if (asleep) return [{ f: { ...r, l: "o", r: "O" }, ms: 800, fx: "gasp" }];
    if (rank <= FACE_RANK.free) return [{ f: { ...r, m: "w" }, ms: 650, fx: "hop" }];
    if (rank === FACE_RANK.moderate) return [{ f: { ...r, l: "O", r: "O" }, ms: 600, fx: "gasp" }];
    if (rank === FACE_RANK.tight) return [{ f: { ...r, l: ">", r: "<", k: ";" }, ms: 600, fx: "squash" }];
    return [{ f: { ...r, l: ">", r: "<", k: "!" }, ms: 500, fx: "nudge" }];
  },
};

// The face's moods from the model: the session's state, a failed reading, offline, old numbers, the hour, the past week
function faceContext(m, mode) {
  const f = m.five;
  const timed = Boolean(f && f.resetsAt && f.resetsAt > m.now);
  const p = m.pace;
  let sess = "calm";
  if (timed && f.used >= 100) sess = "locked";
  else if (timed && p && p.known && p.fullAt && p.fullAt > m.now && p.fullAt < f.resetsAt) sess = "ahead";
  else if (timed && f.used >= 75) sess = "heavy";
  const data = typeof dataState === "function" ? dataState() : "fresh";
  const offline = state.syncFail === "offline" || data === "offline";
  return {
    mode,
    sess,
    night: !inActiveHours(m.now),
    fail: Boolean(state.syncFail) && !offline,
    offline,
    stale: data === "stale",
    relief: faceStore("relief") === String(m.w.resetsAt),
  };
}
// What it looks at, now and then, when left alone: the problem, if there is one
function faceProblem(ctx, rest) {
  if (!ctx || ctx.offline || rest.asleep) return null;
  if (ctx.stale) return "refresh";
  if (ctx.sess === "ahead" || ctx.sess === "locked") return "session";
  const rank = FACE_RANK[ctx.mode];
  if (rank >= FACE_RANK.tight && rank < FACE_RANK.locked) return "chart";
  return null;
}

// ---- The player ----
// One timer at a time. It plays only while the Overview is on screen and motion is allowed; otherwise the face holds
// still. The new week and the hello wait until it can play.
const face = { key: null, ctx: null, rest: null, token: 0, timer: null, live: false, fit: null, pending: null, used: null, today: null, el: null, shown: "", glance: null, ping: null };
const faceReduced = () => motionLevel() === "off";
const faceCanPlay = () => !document.hidden && state.view === "panel" && !faceReduced();
const faceRand = ([lo, hi]) => lo + Math.random() * (hi - lo);
// The new week, the day of the last hello and the week's use live in this window's storage
function faceStore(k, v) {
  try {
    if (v === undefined) return localStorage.getItem(`face.${k}`);
    localStorage.setItem(`face.${k}`, String(v));
  } catch {
    return null;
  }
  return null;
}

// The face's spans: arms, an eye (a box that looks around, and the eye in it that blinks), the mouth, the other eye, the
// other arm, the marks
function faceBuild() {
  if (face.el) return face.el;
  const eye = () => {
    const box = node("span", "eye");
    box.append(node("i", ""));
    return box;
  };
  face.el = { pre: node("span", ""), l: eye(), m: node("span", ""), r: eye(), post: node("span", ""), k: node("span", "fk") };
  $("vFace").replaceChildren(face.el.pre, face.el.l, face.el.m, face.el.r, face.el.post, face.el.k);
  return face.el;
}
// ms: how long this frame stays. A quick frame leaves no afterglow, so a fast loop (the reading's) does not pile up
// frames behind the face.
const FACE_GHOST_MIN = 300;
function faceShow(p, ms) {
  const e = faceBuild();
  const text = faceText(p);
  if (face.shown && text !== face.shown) {
    if (ms !== undefined && ms < FACE_GHOST_MIN) faceGhostOff();
    else faceGhost();
  }
  face.shown = text;
  e.pre.textContent = p.pre;
  e.l.firstChild.textContent = p.l;
  e.m.textContent = p.m;
  e.r.firstChild.textContent = p.r;
  e.post.textContent = p.post;
  e.k.textContent = p.k;
  // Closed, tired or crying eyes do not blink
  $("vFace").classList.toggle("shut", "-=T><".includes(p.l));
}
// The frame before fades out behind the new one, as on a phosphor screen. It is a copy of the face as it is on screen
// (its parts, where it looks, where the head turned, its breath and effect right now), so the two layers line up.
function faceGhost() {
  if (faceReduced()) return;
  const fc = $("vFace");
  const g = $("vGhost");
  const cs = getComputedStyle(fc);
  g.replaceChildren(...[...fc.childNodes].map((n) => n.cloneNode(true)));
  g.dataset.look = fc.dataset.look || "";
  g.style.fontSize = fc.style.fontSize;
  g.style.translate = fc.style.translate;
  g.style.scale = cs.scale;
  g.style.transform = cs.transform;
  g.classList.remove("on");
  void g.offsetWidth; // restart the fade
  g.classList.add("on");
}
function faceGhostOff() {
  $("vGhost").classList.remove("on");
}
// The face's size comes from the CSS; a face too long for the screen gets a smaller one (Plex Mono is 0.6em a character)
function faceFit(texts) {
  face.fit = texts;
  const fc = $("vFace");
  const slot = $("vSlot");
  fc.style.fontSize = "";
  const room = slot.clientWidth - 2 * (parseFloat(getComputedStyle(slot).paddingLeft) || 0);
  const size = parseFloat(getComputedStyle(fc).fontSize) || 0;
  const chars = Math.max(...texts.map((t) => t.length));
  if (room > 0 && chars * 0.6 * size > room) fc.style.fontSize = `${Math.floor(room / (chars * 0.6))}px`;
}
new ResizeObserver(() => face.fit && faceFit(face.fit)).observe($("vSlot"));

function faceFx(name) {
  if (!name || faceReduced()) return;
  if (name === "zz") {
    const z = node("span", "zz", Math.random() < 0.5 ? "z" : "Z");
    z.addEventListener("animationend", () => z.remove());
    $("vSlot").append(z);
    return;
  }
  const fc = $("vFace");
  fc.classList.remove(...FACE_EFFECTS);
  void fc.offsetWidth;
  fc.classList.add(name);
}
$("vFace").addEventListener("animationend", (e) => FACE_EFFECTS.includes(e.animationName.replace(/^face-/, "")) && $("vFace").classList.remove(...FACE_EFFECTS));

// Where the eyes look, and the ping on what they look at: the chart's today point, the session's screen, Refresh
function faceLook(target) {
  const fc = $("vFace");
  fc.dataset.look = target || "";
  if (!target || target === "you" || faceReduced()) return;
  if (target === "chart") {
    const plot = $("plot");
    plot.classList.remove("glance");
    void plot.offsetWidth; // restart the ping
    plot.classList.add("glance");
    clearTimeout(face.glance);
    face.glance = setTimeout(() => plot.classList.remove("glance"), 1900);
    return;
  }
  const el = target === "session" ? $("sScr") : $("syncBtn");
  el.classList.remove("face-ping");
  void el.offsetWidth;
  el.classList.add("face-ping");
  clearTimeout(face.ping);
  face.ping = setTimeout(() => el.classList.remove("face-ping"), 1900);
}
function faceStatic(on) {
  $("vSlot").classList.toggle("static", Boolean(on) && !faceReduced());
}

// Plays steps, then calls done
function facePlay(steps, done = faceSettle) {
  const my = ++face.token;
  clearTimeout(face.timer);
  face.live = true;
  faceFit([faceText(face.rest), ...steps.map((s) => faceText(s.f || face.rest))]);
  let i = 0;
  const step = () => {
    if (my !== face.token) return;
    if (i >= steps.length) {
      faceLook(null);
      faceStatic(false);
      return done();
    }
    const s = steps[i++];
    faceShow(s.f || face.rest, s.ms);
    faceFx(s.fx);
    faceLook(s.look || null);
    faceStatic(s.scr === "static");
    face.timer = setTimeout(step, s.ms);
  };
  step();
}

// The face at rest, then what it does left alone: the reading's loop, the z's while it sleeps, or a look now and then
// at what is wrong
function faceSettle() {
  ++face.token;
  clearTimeout(face.timer);
  face.live = false;
  if (!face.rest) return;
  faceFit([faceText(face.rest)]);
  faceShow(face.rest);
  faceLook(null);
  faceStatic(false);
  if (!faceCanPlay()) return;
  if (face.key === "reading") return facePlay(FACE_READING, faceSettle);
  if (face.rest.asleep) {
    face.live = true;
    face.timer = setTimeout(() => {
      faceFx("zz");
      faceSettle();
    }, faceRand(FACE_ZZ));
    return;
  }
  const target = faceProblem(face.ctx, face.rest);
  if (!target) return;
  face.live = true;
  face.timer = setTimeout(() => facePlay([{ f: null, ms: 1400, look: target }], faceSettle), faceRand(FACE_GLANCE));
}

// A reaction by name, with what it needs to know
function faceSteps(name, more = {}) {
  const rank = FACE_RANK[face.ctx && face.ctx.mode] ?? FACE_RANK.free;
  return FACE_STEPS[name]({ r: face.rest, n: face.rest, rank, asleep: Boolean(face.rest && face.rest.asleep), ...more });
}
// The answer glitches when the level gets worse (Full motion only)
function verdictGlitch() {
  if (motionLevel() !== "full") return;
  const ans = $("vAns").parentElement;
  ans.classList.remove("glitch");
  void ans.offsetWidth;
  ans.classList.add("glitch");
  setTimeout(() => ans.classList.remove("glitch"), 800);
}
// A new week: pixel confetti over the verdict and the week bar drains (Full motion only)
function weekParty() {
  if (motionLevel() !== "full") return;
  const box = node("div", "confetti");
  box.setAttribute("aria-hidden", "true");
  const inks = ["var(--free)", "var(--moderate)", "var(--crt-accent)", "var(--tight)", "var(--st)"];
  for (let i = 0; i < 18; i++) {
    const p = node("i");
    p.style.setProperty("--x", `${((i * 37) % 96) + 2}%`);
    p.style.setProperty("--d", `${(i * 97) % 700}ms`);
    p.style.setProperty("--k", inks[i % inks.length]);
    box.append(p);
  }
  $("vCard").append(box);
  setTimeout(() => box.remove(), 2800);
  const bar = $("wBar");
  bar.classList.remove("drain");
  void bar.offsetWidth;
  bar.classList.add("drain");
  setTimeout(() => bar.classList.remove("drain"), 1300);
}
function faceMoment(name, more) {
  if (!faceCanPlay()) {
    if (name === "reset" || name === "hello") face.pending = name;
    return faceSettle();
  }
  face.pending = null;
  if (name === "reset") weekParty();
  if (name === "worse") verdictGlitch();
  if (name === "reset" || name === "hello") faceStore("hello", face.today); // a new week says hello too
  facePlay(faceSteps(name, more));
}

function faceStop() {
  ++face.token;
  clearTimeout(face.timer);
  face.live = false;
  $("vFace").style.translate = "";
  if (face.rest) {
    faceShow(face.rest);
    faceLook(null);
    faceStatic(false);
  }
}
function faceResume() {
  if (!face.rest || face.live || !faceCanPlay()) return;
  if (face.pending) return faceMoment(face.pending);
  faceSettle();
}
document.addEventListener("visibilitychange", () => (document.hidden ? faceStop() : faceResume()));

// The head turns a few pixels toward the pointer
let facePoint = null;
function faceFollow() {
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
  if (!facePoint) requestAnimationFrame(faceFollow);
  facePoint = { x: e.clientX, y: e.clientY };
});
document.addEventListener("mouseout", (e) => !e.relatedTarget && ($("vFace").style.translate = ""));
// A click on the face: it reacts, the way it feels
$("vSlot").addEventListener("click", () => {
  if (face.rest && face.key !== "reading" && faceCanPlay()) facePlay(faceSteps("poke"));
});

// After a render: works out the face at rest, and what to react to, most important first: a new week, a change of level,
// the session locking or coming back, a failed reading, a new reading, the day's hello. Then it carries on.
function renderFace(m, mode, fresh) {
  const reading = typeof syncBusy !== "undefined" && syncBusy;
  const ctx = faceContext(m, mode);
  const prev = { key: face.key, ctx: face.ctx, rest: face.rest };
  const rest = faceRest(ctx);
  face.key = reading ? "reading" : mode;
  face.ctx = ctx;
  face.rest = rest;
  face.today = dayKey(m.now);
  // Tone and tempo: muted while it reads, dimmed offline and asleep. The pace and the level set its blink and breath.
  const slot = $("vSlot");
  slot.classList.toggle("muted", reading);
  slot.classList.toggle("off", ctx.offline);
  slot.classList.toggle("dim", Boolean(rest.asleep));
  const zone = Math.min(2, Math.max(0, paceZone(m) ?? 1));
  const stress = FACE_STRESS(FACE_RANK[mode] ?? 1);
  slot.style.setProperty("--blink", `${(FACE_BLINK[zone] * stress).toFixed(2)}s`);
  slot.style.setProperty("--breath", `${(FACE_BREATH[zone] * stress).toFixed(2)}s`);
  const delta = face.used === null ? null : m.w.used - face.used;
  face.used = m.w.used;

  if (reading) {
    if (prev.key !== "reading") faceSettle(); // starts the reading's loop
    return;
  }

  // A new week: the reset moved on by days since the face last saw it (a few minutes either way is the same week).
  // A week that ended at the limit leaves relief for the new one.
  const seen = Number(faceStore("week")) || 0;
  const week = m.w.resetsAt || 0;
  const lastUsed = Number(faceStore("weekUsed"));
  if (week && week !== seen) faceStore("week", week);
  faceStore("weekUsed", m.w.used);
  if (seen && week - seen > 2 * DAY) {
    if (lastUsed >= 99.5) {
      faceStore("relief", week);
      face.ctx = { ...ctx, relief: true };
      face.rest = faceRest(face.ctx);
    }
    return faceMoment("reset");
  }

  const was = prev.rest || rest;
  const ranked = (k) => FACE_RANK[k] !== undefined;
  if (prev.ctx && ranked(prev.ctx.mode) && ranked(mode) && FACE_RANK[prev.ctx.mode] !== FACE_RANK[mode]) {
    const worse = FACE_RANK[mode] > FACE_RANK[prev.ctx.mode];
    return faceMoment(worse ? "worse" : "better", { r: was, n: rest, rank: FACE_RANK[mode] });
  }
  if (prev.ctx && prev.ctx.sess !== ctx.sess && mode !== "locked") {
    if (ctx.sess === "ahead") return faceMoment("ahead", { r: was, n: rest });
    if (ctx.sess === "locked") return faceMoment("locks", { r: was, n: rest });
    if (prev.ctx.sess === "locked") return faceMoment("back");
  }
  if (prev.ctx && ctx.fail && !prev.ctx.fail) return faceMoment("fail", { r: was });
  if (fresh && delta !== null && delta >= FACE_JUMP) return faceMoment("jump", { r: was, n: rest });
  if (faceStore("hello") !== face.today) return faceMoment("hello"); // waits for the Overview when it is not on screen
  if (fresh && delta !== null && Math.abs(delta) < 0.5) return faceMoment("nod");
  if (!face.live || faceText(rest) !== faceText(was)) return faceSettle();
  faceResume();
}

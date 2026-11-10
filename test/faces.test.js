// The verdict's faces (renderer/js/blocks/verdict.js): every mode and app state has one, all plain ASCII (so the font
// never changes) and short enough for the face's screen, every act points at frames that exist, the parts keep their
// meaning (arms only in the good moments) and the CSS has every effect and stops them with reduced motion.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..");

function load() {
  const stub = () => ({ parentElement: {}, addEventListener() {}, classList: { remove() {}, add() {}, toggle() {} }, dataset: {}, style: {} });
  const sandbox = {
    document: { getElementById: stub, addEventListener() {}, hidden: false },
    window: { quota: {} },
    ResizeObserver: class { observe() {} },
    I18N: { t: (k) => k, getLang: () => "en", locale: () => "en-US" },
  };
  vm.createContext(sandbox);
  for (const f of ["core.js", "compute.js", "ui.js", "blocks/verdict.js"]) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, "renderer", "js", f), "utf8"), sandbox);
  }
  return vm.runInContext("({ FACES, FACE_MOMENTS, FACE_RANK, FACE_GAPS, verdictMode })", sandbox);
}

const { FACES, FACE_MOMENTS, FACE_RANK, FACE_GAPS, verdictMode } = load();
const MODES = ["room", "free", "moderate", "tight", "pause", "locked", "early", "reserve"];
const STATES = ["reading", "error", "login", "asleep"];
const EFFECTS = ["hop", "shake", "squash", "glance", "zz"];
const everyFrame = () => [
  ...Object.entries(FACES).flatMap(([k, f]) => [...f.frames, ...(f.poke ? [f.poke] : [])].map((fr) => [k, fr])),
  ...Object.entries(FACE_MOMENTS).flatMap(([k, mo]) => mo.frames.map((fr) => [k, fr])),
];

test("every verdict mode and app state has a face, and every mode has a rank", () => {
  for (const k of [...MODES, ...STATES]) assert.ok(FACES[k] && FACES[k].frames.length >= 1, k);
  for (const k of MODES) {
    assert.ok(Number.isFinite(FACE_RANK[k]), `${k} has no rank`);
    assert.ok(FACES[k].frames.length >= 2 && FACES[k].acts.length >= 1, `${k} does nothing`);
  }
});

test("the frames are plain printable ASCII and fit the face's screen", () => {
  for (const [k, fr] of everyFrame()) {
    assert.ok(/^[\x20-\x7E]+$/.test(fr), `${k}: "${fr}"`);
    assert.ok(fr.trim().length > 0 && fr.length <= 7, `${k}: "${fr}" is empty or too long`);
  }
});

test("acts and moments point at frames that exist, with a known effect", () => {
  const steps = (k, frames, seq) => {
    for (const [f, ms, fx] of seq) {
      assert.ok(Number.isInteger(f) && f >= 0 && f < frames.length, `${k}: frame ${f}`);
      assert.ok(Number.isFinite(ms) && ms >= 0, `${k}: ${ms} ms`);
      if (fx !== undefined) assert.ok(EFFECTS.includes(fx), `${k}: effect ${fx}`);
    }
  };
  for (const [k, f] of Object.entries(FACES)) {
    for (const a of f.acts || []) {
      assert.ok(a.w > 0, `${k}: weight`);
      if (a.fx) assert.ok(EFFECTS.includes(a.fx), `${k}: effect ${a.fx}`);
      steps(k, f.frames, a.seq);
    }
    if (f.loop) steps(k, f.frames, f.loop);
  }
  for (const [k, mo] of Object.entries(FACE_MOMENTS)) steps(k, mo.frames, mo.seq);
  for (const [lo, hi] of FACE_GAPS) assert.ok(lo > 0 && hi >= lo);
});

test("the levels read from the eyes, and arms only show in the good moments", () => {
  const eyes = (k) => FACES[k].frames[0][0];
  assert.deepEqual(["free", "moderate", "tight", "pause"].map(eyes), ["^", "o", "o", "O"]);
  assert.ok(FACES.tight.frames[0].includes(";") && FACES.pause.frames[0].includes("!"), "Tight sweats, Pause is alarmed");
  for (const [k, f] of Object.entries(FACES)) for (const fr of [...f.frames, f.poke || ""]) assert.ok(!/[\\/]/.test(fr), `${k}: "${fr}" has arms`);
  for (const k of ["reset", "hello"]) assert.ok(FACE_MOMENTS[k].frames.some((fr) => /[\\/]/.test(fr)), `${k} has arms`);
});

test("the verdict's mode: limit reached first, then the reserve, warming up, room, the level", () => {
  const m = (o) => ({ forecast: { kind: "ok" }, reserveMode: false, head: { room: false, level: 1 }, ...o });
  assert.equal(verdictMode(m({ forecast: { kind: "out" }, reserveMode: true })), "locked");
  assert.equal(verdictMode(m({ reserveMode: true })), "reserve");
  assert.equal(verdictMode(m({ forecast: { kind: "early" } })), "early");
  assert.equal(verdictMode(m({ head: { room: true, level: 0 } })), "room");
  assert.equal(verdictMode(m({})), "moderate");
});

test("the CSS has every effect and stops them with reduced motion", () => {
  const css = fs.readFileSync(path.join(ROOT, "renderer", "css", "overview.css"), "utf8");
  for (const fx of ["hop", "shake", "squash", "tilt"]) assert.ok(css.includes(`.band .fc.${fx} {`), fx);
  assert.ok(css.includes(".band .vface .zz {") && css.includes(".plot.glance .nowping {"), "zz and the chart's ping");
  assert.ok(/prefers-reduced-motion: reduce\)\s*\{\s*\.band \.fc, \.band \.vface \.zz, \.plot \.nowping \{ animation: none/.test(css), "no motion when reduced");
});

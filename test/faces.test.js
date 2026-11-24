// The verdict's face (renderer/js/blocks/face.js): a face at rest for every mode, built from parts that keep their
// meaning, with the mood's layers on top (the session, the hour, a failed reading, the past week); reactions that are all
// plain ASCII, short enough for the face's screen and made of known effects, with arms only in the good moments; looks
// only at what is wrong; and CSS that has every effect and stops them with reduced motion.
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
  for (const f of ["core.js", "learn.js", "compute.js", "ui.js", "blocks/verdict.js", "blocks/face.js"]) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, "renderer", "js", f), "utf8"), sandbox);
  }
  return vm.runInContext("({ FACE_BASE, FACE_RANK, FACE_STEPS, FACE_EFFECTS, FACE_READING, faceRest, faceText, faceProblem, verdictMode })", sandbox);
}

const { FACE_BASE, FACE_RANK, FACE_STEPS, FACE_EFFECTS, FACE_READING, faceRest, faceText, faceProblem, verdictMode } = load();
const MODES = ["room", "free", "moderate", "tight", "pause", "locked", "early", "reserve"];
const SESSIONS = ["calm", "heavy", "ahead", "locked"];
const LOOKS = [undefined, "chart", "session", "refresh", "you"];
const rest = (mode, more = {}) => faceRest({ mode, sess: "calm", ...more });
const text = (mode, more) => faceText(rest(mode, more));
const ok = (fr, what) => {
  assert.ok(/^[\x20-\x7E]+$/.test(fr), `${what}: "${fr}"`);
  assert.ok(fr.trim().length > 0 && fr.length <= 7, `${what}: "${fr}" is empty or too long`);
};

test("every mode has a face at rest and a rank", () => {
  for (const k of MODES) {
    assert.ok(Array.isArray(FACE_BASE[k]) && FACE_BASE[k].length === 3, k);
    assert.ok(Number.isFinite(FACE_RANK[k]), `${k} has no rank`);
  }
});

test("every face at rest, with every layer, is plain ASCII and fits the face's screen", () => {
  for (const mode of MODES) {
    for (const sess of SESSIONS) {
      for (const night of [false, true]) for (const fail of [false, true]) for (const relief of [false, true]) {
        ok(faceText(faceRest({ mode, sess, night, fail, relief })), `${mode} ${sess} night=${night} fail=${fail} relief=${relief}`);
      }
    }
  }
});

test("the levels read from the eyes, and the tension from the mouth", () => {
  assert.deepEqual(["free", "moderate", "tight", "pause"].map((k) => rest(k).l), ["^", "o", "o", "O"]);
  assert.deepEqual(["free", "moderate", "tight", "pause"].map((k) => rest(k).m), [".", ".", "_", "_"]);
  assert.equal(rest("locked").l, "-", "the limit reached: it waits with its eyes closed");
});

test("the session adds the tension: sweat, then the alarm, then eyes closed while it is locked", () => {
  assert.equal(text("free", { sess: "heavy" }), "^.^;");
  assert.equal(text("free", { sess: "ahead" }), "^.^!");
  assert.equal(text("moderate", { sess: "locked" }), "-_-");
  assert.equal(text("locked", { sess: "ahead" }), text("locked"), "the week's limit says it all");
});

test("the hour: it sleeps when nothing is at risk, and stays up, tired, from Tight on", () => {
  for (const k of ["room", "free", "early", "moderate"]) assert.equal(rest(k, { night: true }).asleep, true, k);
  for (const k of ["tight", "pause", "reserve"]) {
    const r = rest(k, { night: true });
    assert.ok(!r.asleep && r.l === "=", `${k} stays up, tired`);
  }
  assert.ok(!rest("free", { night: true, sess: "ahead" }).asleep, "a session about to lock keeps it awake");
});

test("a failed reading adds a small ? and keeps the mood; after a week at the limit Free looks relieved", () => {
  assert.equal(text("tight", { fail: true }), "o_o?");
  assert.equal(text("free", { relief: true }), "^-^");
  assert.equal(text("tight", { relief: true }), text("tight"), "relief only shows when the week is calm");
});

test("every reaction is plain ASCII, short, made of known effects and looks only at known places", () => {
  const steps = (name, list) => {
    assert.ok(Array.isArray(list) && list.length > 0, name);
    for (const s of list) {
      if (s.f) ok(faceText(s.f), name);
      assert.ok(Number.isFinite(s.ms) && s.ms >= 0, `${name}: ${s.ms} ms`);
      if (s.fx !== undefined) assert.ok(FACE_EFFECTS.includes(s.fx), `${name}: effect ${s.fx}`);
      assert.ok(LOOKS.includes(s.look), `${name}: look ${s.look}`);
    }
  };
  for (const mode of MODES) {
    for (const asleep of [false, true]) {
      const r = rest(mode);
      const n = rest(mode, { sess: "heavy" });
      for (const [name, fn] of Object.entries(FACE_STEPS)) steps(`${name} ${mode}`, fn({ r, n, rank: FACE_RANK[mode], asleep }));
    }
  }
  steps("reading", FACE_READING);
});

test("arms only show in the good moments", () => {
  const arms = (list) => list.some((s) => s.f && /[\\/]/.test(faceText(s.f)));
  const at = (mode, name) => FACE_STEPS[name]({ r: rest(mode), n: rest(mode), rank: FACE_RANK[mode], asleep: false });
  assert.ok(arms(at("free", "reset")) && arms(at("free", "back")), "a new week and the session back");
  assert.ok(arms(at("free", "hello")), "a hello on a calm day");
  for (const k of ["pause", "reserve", "locked"]) assert.ok(!arms(at(k, "hello")), `no wave in ${k}`);
  for (const name of ["nod", "jump", "worse", "better", "ahead", "locks", "fail", "poke"]) {
    for (const k of MODES) assert.ok(!arms(at(k, name)), `${name} ${k} has arms`);
  }
});

test("an alarm reacts once on the way in: Pause shakes, the limit cries, a better level hops only back to Free", () => {
  const fxs = (name, mode) => FACE_STEPS[name]({ r: rest("moderate"), n: rest(mode), rank: FACE_RANK[mode] }).map((s) => s.fx);
  assert.ok(fxs("worse", "pause").includes("shake"));
  assert.ok(!fxs("worse", "tight").includes("shake"), "Tight does not shake");
  assert.ok(fxs("worse", "locked").includes("sob"));
  assert.ok(!fxs("better", "tight").includes("hop"), "Pause to Tight is no party");
  assert.ok(fxs("better", "free").includes("hop"));
});

test("left alone it looks only at what is wrong", () => {
  const ctx = (o) => ({ mode: "free", sess: "calm", stale: false, offline: false, ...o });
  assert.equal(faceProblem(ctx({}), rest("free")), null, "nothing wrong: it looks nowhere");
  assert.equal(faceProblem(ctx({ mode: "tight" }), rest("tight")), "chart");
  assert.equal(faceProblem(ctx({ sess: "ahead" }), rest("free")), "session");
  assert.equal(faceProblem(ctx({ mode: "tight", stale: true }), rest("tight")), "refresh", "old numbers first");
  assert.equal(faceProblem(ctx({ mode: "tight", offline: true }), rest("tight")), null, "offline it waits");
  assert.equal(faceProblem(ctx({ mode: "tight" }), rest("free", { night: true })), null, "asleep it does not look");
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
  for (const fx of FACE_EFFECTS.filter((f) => f !== "zz")) assert.ok(css.includes(`.band .fc.${fx} {`) && css.includes(`@keyframes face-${fx} `), fx);
  assert.ok(css.includes(".band .vface .zz {") && css.includes(".plot.glance .nowping {"), "zz and the chart's ping");
  assert.ok(/prefers-reduced-motion: reduce\)\s*\{\s*\.band \.fc, \.band \.fc \.eye i, \.band \.fcg, \.band \.vface \.zz/.test(css), "no motion when reduced");
});

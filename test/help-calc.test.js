// "How we calculate" in Help is built from the constants the numbers use. These tests run the real
// renderer scripts against a tiny fake DOM and check that the page follows the code, in both languages.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const i18n = require("../renderer/i18n.js");

class El {
  constructor(tag) {
    this.tag = tag;
    this.children = [];
    this.classes = new Set();
    this._text = "";
    this.style = {};
    this.classList = {
      add: (...c) => c.forEach((x) => this.classes.add(x)),
      remove: (...c) => c.forEach((x) => this.classes.delete(x)),
      toggle: (c, force) => (force === undefined ? !this.classes.delete(c) && this.classes.add(c) : force ? this.classes.add(c) : this.classes.delete(c)),
      contains: (c) => this.classes.has(c),
    };
  }
  set className(v) { this.classes = new Set(String(v).split(/\s+/).filter(Boolean)); }
  get className() { return [...this.classes].join(" "); }
  set textContent(v) { this._text = String(v); this.children = []; }
  get textContent() { return this._text + this.children.map((c) => c.textContent).join(" "); }
  append(...nodes) { nodes.forEach((n) => this.children.push(typeof n === "string" ? Object.assign(new El("#text"), { _text: n }) : n)); }
  appendChild(n) { this.children.push(n); return n; }
  addEventListener() {}
  setAttribute() {}
  find(tag, out = []) { if (this.tag === tag) out.push(this); this.children.forEach((c) => c.find && c.find(tag, out)); return out; }
  querySelector(sel) {
    const cls = sel.slice(1);
    const walk = (n) => (n.classes && n.classes.has(cls) ? n : n.children.map(walk).find(Boolean));
    return this.children.map(walk).find(Boolean) || null;
  }
}

function render(lang) {
  const body = new El("div");
  const sandbox = {
    document: { getElementById: (id) => (id === "helpCalcBody" ? body : new El("x")), createElement: (tag) => new El(tag) },
    window: { quota: {} },
    I18N: i18n,
  };
  vm.createContext(sandbox);
  i18n.setLang(lang);
  for (const f of ["core.js", "compute.js", "ui.js", "help-calc.js"]) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "renderer", "js", f), "utf8"), sandbox);
  }
  vm.runInContext("let lastM = null;", sandbox); // declared in overview.js in the app
  return { body, run: (code) => vm.runInContext(code, sandbox), draw: () => { vm.runInContext("renderHelpCalc()", sandbox); return body.textContent; } };
}

test.afterEach(() => i18n.setLang("en"));

test("English: the table and the rules show the real cutoffs, weights and the 95% rule", () => {
  const { draw, body } = render("en");
  const text = draw();
  for (const s of ["up to 50%", "up to 75%", "up to 90%", "above 90%", "up to 0.7", "up to 1.0", "up to 1.4", "above 1.4"]) assert.ok(text.includes(s), s);
  assert.ok(text.includes("Off 0; Light 0.5; Normal 1; Heavy 2"), "plan weights");
  assert.ok(text.includes("95%"), "a week at 95% reads Pause");
  assert.ok(text.includes("first 1.5 plan days"), "no projection before 1.5 plan days");
  for (const s of ["0 h", "5 h", "24 h"]) assert.ok(text.includes(s), `hours tick ${s}`);
  assert.ok(text.includes("The level counts how many hours you would be without Claude before the reset if you keep the pace of now: 0 h is Free, up to 5 h is Moderate, up to 24 h is Tight and above 24 h is Pause"), "hours rule");
  assert.ok(text.includes("5 h is one session"));
  assert.ok(text.includes("counts up to 100% of the limit, where Claude stops"));
  assert.ok(text.includes("Cut pace ~N% says how much the pace of the days left has to drop for the week to end at 100% at the reset"), "cut pace");
  assert.ok(text.includes("the verdict reads Warming up"));
  assert.ok(text.includes("Today and days (used ÷ budget)"), "the ratio scale is only for Today and the days");
  assert.ok(text.includes("Week (hours without Claude before the reset)"), "the week is on the hours scale");
  assert.ok(text.includes("The week is rated on this same scale"));
  assert.equal(body.find("tr").length, 5, "a header row and the four levels");
  assert.equal(body.find("dt").length, 6);
});

test("Portuguese: same page, with decimal commas and the Portuguese names", () => {
  const { draw } = render("pt-BR");
  const text = draw();
  for (const s of ["até 50%", "até 90%", "acima de 90%", "até 0,7", "até 1,0", "acima de 1,4"]) assert.ok(text.includes(s), s);
  assert.ok(text.includes("Folga 0; Leve 0,5; Normal 1; Pesado 2"), "plan weights");
  assert.ok(text.includes("primeiros 1,5 dias do plano"));
  assert.ok(text.includes("Pare"), "the Pause level is called Pare");
  assert.ok(text.includes("O nível conta quantas horas você ficaria sem Claude antes do reset se mantiver o ritmo de agora: 0 h é Livre, até 5 h é Moderado, até 24 h é Apertado e acima de 24 h é Pare"), "hours rule");
  assert.ok(text.includes("5 h é uma sessão"));
  assert.ok(text.includes("conta até 100% do limite, onde o Claude para"));
  assert.ok(text.includes("Reduza o ritmo ~N% diz quanto o ritmo dos dias que faltam precisa cair"));
  assert.ok(text.includes("o veredito fica Acordando"));
  assert.ok(text.includes("Hoje e dias (usado ÷ orçamento)"));
  assert.ok(text.includes("A semana usa essa mesma escala"));
});

test("the page follows the code: change a cutoff and Help changes with it", () => {
  const { run, draw } = render("en");
  run("RATIO_CUTS[0] = 0.5; SESSION_CUTS[2] = 85; LOCK_CUTS[1] = 4;");
  const text = draw();
  assert.ok(text.includes("up to 4 h is Moderate"));
  assert.ok(text.includes("4 h is one session"));
  assert.ok(text.includes("up to 0.5"));
  assert.ok(text.includes("above 85%"));
  assert.ok(!text.includes("up to 0.7"));
});

test("no text in Help or the Math rows still cites the old 80% cutoff or quota left over as waste", () => {
  for (const lang of ["en", "pt-BR"]) {
    const { draw } = render(lang);
    const text = draw();
    assert.ok(!/\b80%/.test(text), `${lang}: no 80%`);
    assert.ok(!/\b20%/.test(text), `${lang}: no 20% left over`);
    assert.ok(!/waste|desperdi/i.test(text), `${lang}: nothing about waste`);
  }
  for (const lang of ["en", "pt-BR"]) {
    const bad = Object.entries(i18n.DICT[lang]).filter(([k, v]) => (k.startsWith("calc.") || k.startsWith("math.")) && (/\b80%|\b20%|waste|desperdi/i.test(v)));
    assert.deepEqual(bad, [], lang);
  }
});

test("drawing it twice does not pile up content", () => {
  const { draw, body } = render("en");
  draw();
  const rows = body.find("tr").length;
  draw();
  assert.equal(body.find("tr").length, rows);
});

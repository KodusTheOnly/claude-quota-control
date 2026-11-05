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
  for (const s of ["80%", "100%", "140%"]) assert.ok(text.includes(s), `projection tick ${s}`);
  assert.ok(text.includes("below 80% of the limit is Free, 80% to 100% is Moderate, up to 140% is Tight and above 140% is Pause"), "projection rule");
  assert.ok(text.includes("scale of its own"), "says the projection is rated differently");
  assert.ok(text.includes("exactly 80% is already Moderate"), "the edge exception");
  assert.ok(text.includes("Free is the band where quota would go to waste, and 20% or less left at the reset already asks you to ease up"), "and why");
  assert.ok(text.includes("Today and days (used ÷ budget)"), "the ratio scale is only for Today and the days");
  assert.ok(text.includes("Projection and week"), "the week is on the projection scale");
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
  assert.ok(text.includes("abaixo de 80% do limite é Livre"), "projection rule");
  assert.ok(text.includes("exatamente 80% já é Moderado"));
  assert.ok(text.includes("sobrar 20% ou menos no reset já pede para segurar"), "and why");
  assert.ok(text.includes("Hoje e dias (usado ÷ orçamento)"));
  assert.ok(text.includes("A semana usa essa mesma escala"));
});

test("the page follows the code: change a cutoff and Help changes with it", () => {
  const { run, draw } = render("en");
  run("RATIO_CUTS[0] = 0.5; SESSION_CUTS[2] = 85; PROJECTION_CUTS[0] = 0.75;");
  const text = draw();
  assert.ok(text.includes("below 75% of the limit is Free"));
  assert.ok(text.includes("exactly 75% is already Moderate"));
  assert.ok(text.includes("25% or less left"), "the reason follows the cutoff too");
  assert.ok(text.includes("up to 0.5"));
  assert.ok(text.includes("above 85%"));
  assert.ok(!text.includes("up to 0.7"));
});

test("drawing it twice does not pile up content", () => {
  const { draw, body } = render("en");
  draw();
  const rows = body.find("tr").length;
  draw();
  assert.equal(body.find("tr").length, rows);
});

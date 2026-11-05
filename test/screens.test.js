// The screens are plain HTML wired to plain scripts, so a renamed or removed id fails quietly in the app.
// These tests read index.html and the renderer scripts and check that they still agree.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const listJs = (dir) => fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? listJs(path.join(dir, e.name)) : e.name.endsWith(".js") ? [path.join(dir, e.name)] : []));

const html = read("renderer/index.html");
const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));

test("every id the scripts look up with $() is in index.html", () => {
  const missing = [];
  for (const file of listJs("renderer/js")) {
    for (const m of read(file).matchAll(/\$\(\s*"([\w-]+)"\s*\)/g)) if (!ids.has(m[1])) missing.push(`${file}: ${m[1]}`);
  }
  assert.deepEqual(missing, []);
});

test("ids are unique", () => {
  const all = [...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
  const dupes = all.filter((id, i) => all.indexOf(id) !== i);
  assert.deepEqual(dupes, []);
});

test("every contents key in Settings and Help points at a section", () => {
  const bad = [...html.matchAll(/class="key toc-k[^"]*"[^>]*\bdata-target="([^"]+)"/g)].map((m) => m[1]).filter((id) => !ids.has(id));
  assert.deepEqual(bad, []);
});

test("every section of Settings has a contents key", () => {
  const part = html.slice(html.indexOf('id="view-settings"'));
  const section = part.slice(0, part.indexOf("</section>"));
  const keys = [...section.matchAll(/data-target="([^"]+)"/g)].map((m) => m[1]);
  const numbered = [...section.matchAll(/<article class="blk" id="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(numbered, keys, "sections and keys are in the same order");
});

test("every topic of Help has a tile, in the same order", () => {
  const part = html.slice(html.indexOf('id="view-help"'));
  const section = part.slice(0, part.indexOf("</section>"));
  const topics = [...section.matchAll(/<article class="blk" id="([^"]+)"/g)].map((m) => m[1]);
  const tiles = [...read("renderer/js/help-tiles.js").matchAll(/\{ id: "(\w+)"/g)].map((m) => m[1]);
  assert.deepEqual(tiles, topics);
});

test("every label points at a field that exists", () => {
  const bad = [...html.matchAll(/<label[^>]*\bfor="([^"]+)"/g)].map((m) => m[1]).filter((id) => !ids.has(id));
  assert.deepEqual(bad, []);
});

test("the switches are real checkboxes with a visible ON and OFF word", () => {
  const switches = [...html.matchAll(/<label class="set tgl[^"]*">[\s\S]*?<\/label>/g)].map((m) => m[0]);
  assert.ok(switches.length >= 9, "all the switches are there");
  for (const s of switches) {
    assert.match(s, /<input type="checkbox" id="\w+">/);
    assert.match(s, /data-i18n="set\.on"/);
    assert.match(s, /data-i18n="set\.off"/);
  }
});

// The tray card and the taskbar strip are separate windows: each looks up ids in its own page and reads the summary
// that js/tray.js builds. A rename on either side would only show up on a real taskbar.
for (const [name, page, script] of [["tray card", "renderer/popup.html", "renderer/popup.js"], ["taskbar strip", "renderer/strip.html", "renderer/strip.js"]]) {
  test(`every id the ${name} looks up is in its page`, () => {
    const own = new Set([...read(page).matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
    const missing = [...read(script).matchAll(/\$\(\s*"([\w-]+)"\s*\)/g)].map((m) => m[1]).filter((id) => !own.has(id));
    assert.deepEqual(missing, []);
  });
}

test("the tray card and the strip only read summary fields that tray.js builds", () => {
  const builder = read("renderer/js/tray.js");
  const fields = new Set();
  for (const script of ["renderer/popup.js", "renderer/strip.js"]) {
    for (const m of read(script).matchAll(/\b(?:s|row|today|r)((?:\.\w+)+)/g)) for (const part of m[1].slice(1).split(".")) fields.add(part);
  }
  for (const method of ["forEach", "find", "map"]) fields.delete(method); // array methods, not fields
  assert.ok(fields.size >= 20, "the windows read the summary");
  // A field is built when tray.js writes it as `field:`, `field,` or `.field =`
  const missing = [...fields].filter((field) => !new RegExp(`\\b${field}\\s*[:,=]|\\.${field}\\s*=`).test(builder));
  assert.deepEqual(missing, []);
});

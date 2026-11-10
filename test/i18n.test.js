const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { DICT } = require("../renderer/i18n.js");

const ROOT = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const listJs = (dir) => fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? listJs(path.join(dir, e.name)) : e.name.endsWith(".js") ? [path.join(dir, e.name)] : []));

const placeholders = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");

test("English and Portuguese have exactly the same keys", () => {
  const en = Object.keys(DICT.en);
  const pt = new Set(Object.keys(DICT["pt-BR"]));
  const missingPt = en.filter((k) => !pt.has(k));
  const extraPt = [...pt].filter((k) => !(k in DICT.en));
  assert.deepEqual(missingPt, [], "keys without a Portuguese text");
  assert.deepEqual(extraPt, [], "Portuguese keys without an English text");
});

test("both languages use the same {placeholders} in every text", () => {
  const bad = Object.keys(DICT.en).filter((k) => k in DICT["pt-BR"] && placeholders(DICT.en[k]) !== placeholders(DICT["pt-BR"][k]));
  assert.deepEqual(bad, []);
});

test("no text is empty", () => {
  for (const lang of Object.keys(DICT)) {
    const empty = Object.entries(DICT[lang]).filter(([, v]) => typeof v !== "string" || !v.trim()).map(([k]) => k);
    assert.deepEqual(empty, [], lang);
  }
});

test("every key the HTML asks for exists", () => {
  const missing = [];
  for (const file of ["renderer/index.html", "renderer/popup.html", "renderer/strip.html"]) {
    for (const m of read(file).matchAll(/data-i18n(?:-title|-aria)?="([^"]+)"/g)) if (!(m[1] in DICT.en)) missing.push(`${file}: ${m[1]}`);
  }
  assert.deepEqual(missing, []);
});

test("every fixed key the scripts ask for exists", () => {
  const files = [...listJs("renderer"), "main.js", "claude-sync.js", "updater.js"];
  const missing = [];
  for (const file of files) {
    if (file.endsWith("i18n.js")) continue;
    // t("a.b") and I18N.t("a.b"); keys built with ${...} are skipped
    for (const m of read(file).matchAll(/\bt\(\s*(["'])([\w.]+)\1/g)) if (!(m[2] in DICT.en)) missing.push(`${file}: ${m[2]}`);
  }
  assert.deepEqual(missing, []);
});

test("every text is used somewhere (no dead texts left behind)", () => {
  const files = [...listJs("renderer").filter((f) => !f.endsWith("i18n.js")), "main.js", "claude-sync.js", "updater.js", "preload.js", "renderer/index.html", "renderer/popup.html", "renderer/strip.html"];
  const code = files.map(read).join("\n");
  // Keys built at run time, like t(`state.${name}`), count as using everything under that prefix
  const prefixes = [...code.matchAll(/[`"']([\w.]+\.)\$\{/g)].map((m) => m[1]);
  const dead = Object.keys(DICT.en).filter((k) => !code.includes(`"${k}"`) && !code.includes(`'${k}'`) && !code.includes(`\`${k}\``) && !prefixes.some((p) => k.startsWith(p)));
  assert.deepEqual(dead, []);
});

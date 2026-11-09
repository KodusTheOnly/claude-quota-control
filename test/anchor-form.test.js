const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// Settings > Sources: the "Next reset" form shows only in manual mode, or when the connected account
// has not given a reset time. saveManual records where the reset time came from.

function load(settings) {
  const sandbox = {
    document: { getElementById: () => ({}) },
    window: { quota: { setSettings: async (patch) => ({ ...sandbox.state.settings, ...patch }) } },
    I18N: { t: (k) => k, getLang: () => "en", locale: () => "en-US" },
  };
  vm.createContext(sandbox);
  for (const f of ["core.js", "compute.js"]) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "renderer", "js", f), "utf8"), sandbox);
  }
  vm.runInContext(`state.settings = ${JSON.stringify(settings)}; logReading = async () => {}; render = () => {}; this.state = state;`, sandbox);
  return sandbox;
}

const RESET = Date.UTC(2026, 10, 16, 15);

test("the form shows when the account is not connected", () => {
  const s = load({});
  assert.equal(s.needsAnchorForm({ claudeConnected: false, manual: { anchor: RESET, anchorVia: "sync" } }), true);
  assert.equal(s.needsAnchorForm({ claudeConnected: false }), true);
});

test("the form hides when the connected account gave the reset time", () => {
  const s = load({});
  assert.equal(s.needsAnchorForm({ claudeConnected: true, manual: { anchor: RESET, anchorVia: "sync" } }), false);
});

test("connected account without a reset time: the form shows", () => {
  const s = load({});
  assert.equal(s.needsAnchorForm({ claudeConnected: true }), true);
  assert.equal(s.needsAnchorForm({ claudeConnected: true, manual: { weekly: { used: 20 } } }), true);
  // the reset time was typed by hand because the account did not give one: it stays editable
  assert.equal(s.needsAnchorForm({ claudeConnected: true, manual: { anchor: RESET, anchorVia: "manual" } }), true);
  // data saved before the app recorded where the reset came from
  assert.equal(s.needsAnchorForm({ claudeConnected: true, manual: { anchor: RESET } }), true);
});

test("saveManual records where the reset time came from", async () => {
  const s = load({ claudeConnected: true });
  await s.saveManual({ weekly: 20, anchor: RESET, via: "sync" });
  assert.equal(s.state.settings.manual.anchorVia, "sync");
  assert.equal(s.needsAnchorForm(s.state.settings), false);
  // a later reading without a reset time keeps the one the account gave before
  await s.saveManual({ weekly: 22, via: "sync" });
  assert.equal(s.state.settings.manual.anchorVia, "sync");
  assert.equal(s.state.settings.manual.anchor, RESET);
});

test("a reset time typed by hand is marked manual", async () => {
  const s = load({ claudeConnected: true });
  await s.saveManual({ weekly: 20, anchor: RESET });
  assert.equal(s.state.settings.manual.anchorVia, "manual");
  assert.equal(s.needsAnchorForm(s.state.settings), true);
});

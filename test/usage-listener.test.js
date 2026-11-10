const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { listenForUsage, usageUrlPattern } = require("../usage-listener");

const ORIGIN = "https://claude.ai";
const API = `${ORIGIN}/api/organizations/org-1/usage`;

// A stand-in for Electron's webContents.debugger
function fakeWebContents(bodies = {}) {
  const dbg = new EventEmitter();
  dbg.attached = false;
  dbg.attach = () => { dbg.attached = true; };
  dbg.calls = [];
  dbg.sendCommand = async (name, args) => {
    dbg.calls.push(name);
    if (name === "Network.getResponseBody") {
      if (!(args.requestId in bodies)) throw new Error("no body");
      return bodies[args.requestId];
    }
    return {};
  };
  const emit = (method, params) => dbg.emit("message", {}, method, params);
  return { wc: { debugger: dbg }, dbg, emit };
}
const tick = () => new Promise((r) => setImmediate(r));

test("only the usage request of the page's own origin matches", () => {
  const re = usageUrlPattern(ORIGIN);
  assert.equal(re.test(API), true);
  assert.equal(re.test(`${API}?x=1`), true);
  assert.equal(re.test(`${ORIGIN}/api/organizations/org-1/usage/extra`), false);
  assert.equal(re.test(`${ORIGIN}/api/organizations/org-1/prepaid/credits`), false);
  assert.equal(re.test("https://other.example/api/organizations/org-1/usage"), false);
  assert.equal(re.test("https://claude.ai.evil.example/api/organizations/org-1/usage"), false);
});

test("collects the status and the body of the usage answer", async () => {
  const { wc, dbg, emit } = fakeWebContents({ r1: { body: '{"a":1}', base64Encoded: false } });
  const got = await listenForUsage(wc, ORIGIN);
  assert.equal(dbg.attached, true);
  assert.ok(dbg.calls.includes("Network.enable"));
  emit("Network.responseReceived", { requestId: "r1", response: { url: API, status: 200 } });
  emit("Network.loadingFinished", { requestId: "r1" });
  await tick();
  assert.equal(got.status, 200);
  assert.equal(got.body, '{"a":1}');
});

test("reads a base64 body", async () => {
  const { wc, emit } = fakeWebContents({ r1: { body: Buffer.from('{"b":2}').toString("base64"), base64Encoded: true } });
  const got = await listenForUsage(wc, ORIGIN);
  emit("Network.responseReceived", { requestId: "r1", response: { url: API, status: 200 } });
  emit("Network.loadingFinished", { requestId: "r1" });
  await tick();
  assert.equal(got.body, '{"b":2}');
});

test("ignores every other request", async () => {
  const { wc, dbg, emit } = fakeWebContents({ r2: { body: "nope", base64Encoded: false } });
  const got = await listenForUsage(wc, ORIGIN);
  emit("Network.responseReceived", { requestId: "r2", response: { url: `${ORIGIN}/api/organizations/org-1/prepaid/credits`, status: 200 } });
  emit("Network.loadingFinished", { requestId: "r2" });
  await tick();
  assert.equal(got.status, null);
  assert.equal(got.body, null);
  assert.ok(!dbg.calls.includes("Network.getResponseBody"));
});

test("notes that the page sent its usage request, before any answer", async () => {
  const { wc, emit } = fakeWebContents({});
  const got = await listenForUsage(wc, ORIGIN);
  emit("Network.requestWillBeSent", { requestId: "r0", request: { url: `${ORIGIN}/api/organizations/org-1/prepaid/credits` } });
  assert.equal(got.requested, false);
  emit("Network.requestWillBeSent", { requestId: "r1", request: { url: API } });
  assert.equal(got.requested, true);
  assert.equal(got.status, null);
});

test("keeps the status when the body cannot be read", async () => {
  const { wc, emit } = fakeWebContents({});
  const got = await listenForUsage(wc, ORIGIN);
  emit("Network.responseReceived", { requestId: "r3", response: { url: API, status: 200 } });
  emit("Network.loadingFinished", { requestId: "r3" });
  await tick();
  assert.equal(got.status, 200);
  assert.equal(got.body, null);
});

test("the trace names the page's API paths with ids masked, and no values", async () => {
  const lines = [];
  const { wc, emit } = fakeWebContents({ r1: { body: '{"seven_day":{"utilization":42}}', base64Encoded: false } });
  const got = await listenForUsage(wc, ORIGIN, (l) => lines.push(l));
  const id = "00000000-0000-4000-8000-000000000000";
  emit("Network.responseReceived", { requestId: "r0", response: { url: `${ORIGIN}/api/organizations/${id}/memory/settings`, status: 200 } });
  emit("Network.responseReceived", { requestId: "r1", response: { url: `${ORIGIN}/api/organizations/${id}/usage`, status: 200 } });
  emit("Network.loadingFinished", { requestId: "r1" });
  await tick();
  assert.ok(lines.includes("page request 200 /api/organizations/<id>/memory/settings"));
  assert.ok(lines.includes("page request 200 /api/organizations/<id>/usage"));
  assert.ok(lines.some((l) => /usage answer read \(\d+ characters\)/.test(l)));
  emit("Network.responseReceived", { requestId: "r9", response: { url: `${ORIGIN}/api/account_avatar/${id}/0123456789abcdef.webp`, status: 200 } });
  assert.ok(lines.includes("page request 200 /api/account_avatar/<id>/<hash>.webp"));
  assert.ok(!lines.join("\n").includes(id));
  assert.ok(!lines.join("\n").includes("01234567"));
  assert.ok(!lines.join("\n").includes("42"));
  assert.equal(got.status, 200);
});

test("gives up when the debugger never answers Network.enable", async () => {
  const dbg = new EventEmitter();
  dbg.attach = () => {};
  dbg.sendCommand = () => new Promise(() => {}); // never answers
  const started = Date.now();
  await assert.rejects(listenForUsage({ debugger: dbg }, ORIGIN), /did not answer/);
  assert.ok(Date.now() - started < 8000);
});

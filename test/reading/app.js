// The Electron side of the reading test (see run.js): the real claude-sync.js reads a fake usage page served from
// this machine. Nothing here touches Claude or a real account.
//
// Each case is one reading: what the fake page does, and what the reading must answer. After every one, no window
// may be left behind.
const fs = require("fs");
const http = require("http");
const path = require("path");
const { app, BrowserWindow } = require("electron");

const ROOT = path.join(__dirname, "..", "..");
const withSlow = process.argv.includes("--slow");
app.setPath("userData", process.env.READING_TEST_DATA); // a temporary folder, made and removed by run.js

const GOOD = JSON.stringify({
  five_hour: { utilization: 12, resets_at: new Date(Date.now() + 3600000).toISOString() },
  seven_day: { utilization: 40, resets_at: new Date(Date.now() + 3 * 86400000).toISOString() },
});
let mode = "normal";
let apiHits = 0;

// The usage page: it asks for its own data, as Claude's does
const page = (extra = "") => `<!doctype html><html><body><h1>Usage</h1>${extra}<script>
  const ask = () => fetch("/api/organizations/11111111-2222-4333-8444-555555555555/usage").then((r) => r.text()).catch(() => {});
  ask();
  if (location.search.includes("twice")) setTimeout(ask, 600);
  if (location.search.includes("unload")) window.addEventListener("beforeunload", (e) => { e.preventDefault(); e.returnValue = "stay"; });
</script></body></html>`;

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  const json = (status, body) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(body);
  };
  if (url.pathname === "/settings/usage") {
    if (mode === "redirect") {
      res.writeHead(302, { Location: "/login" });
      return res.end();
    }
    res.writeHead(200, { "Content-Type": "text/html" });
    // slow: an image that never arrives, so the page never finishes loading
    return res.end(page(mode === "slow" ? '<img src="/never.png">' : ""));
  }
  if (url.pathname === "/login") {
    res.writeHead(200, { "Content-Type": "text/html" });
    return res.end("<h1>Login</h1>");
  }
  if (url.pathname === "/never.png") return undefined; // never answers
  if (url.pathname.endsWith("/usage")) {
    apiHits++;
    if (mode === "hang") return undefined; // never answers
    if (mode === "401") return json(401, "{}");
    if (mode === "twice" && apiHits > 1) return json(500, "{}");
    if (mode === "badjson") return json(200, '{"seven_day":{"utilization":"x"}}');
    return json(200, GOOD);
  }
  res.writeHead(404);
  return res.end();
});

app.on("window-all-closed", (e) => e.preventDefault());

app.whenReady().then(() => {
  server.listen(0, "127.0.0.1", async () => {
    const base = `http://127.0.0.1:${server.address().port}`;
    process.env.CLAUDE_QUOTA_LOGIN_URL = `${base}/login`;
    const lines = [];
    let failed = 0;
    const run = async (name, pageMode, query, want, { pair = false } = {}) => {
      mode = pageMode;
      apiHits = 0;
      // Each case loads the module again, so its URL and its one-minute gap start over
      for (const k of Object.keys(require.cache)) if (k.endsWith("claude-sync.js")) delete require.cache[k];
      process.env.CLAUDE_QUOTA_USAGE_URL = `${base}/settings/usage${query}`;
      const claude = require(path.join(ROOT, "claude-sync.js"));
      const t0 = Date.now();
      let res;
      let shared = true;
      if (pair) {
        const [a, b] = await Promise.all([claude.sync({}), claude.sync({})]);
        res = a;
        shared = a === b && apiHits === 1; // one reading, one answer for both
      } else res = await claude.sync({});
      await new Promise((r) => setTimeout(r, 300));
      const left = BrowserWindow.getAllWindows().length;
      const got = res.ok ? `ok week ${res.weekly.used} session ${res.session && res.session.used}` : `error ${res.error}`;
      const ok = got === want && left === 0 && shared;
      if (!ok) failed++;
      lines.push(`${ok ? "pass" : "FAIL"}  ${name}: ${got}${got === want ? "" : ` (wanted ${want})`}, ${Date.now() - t0} ms${left ? `, ${left} window(s) left behind` : ""}${shared ? "" : ", the two requests did not share one reading"}`);
    };
    try {
      await run("a plain reading", "normal", "", "ok week 40 session 12");
      // A good reading leaves the field names of the answer, without its numbers
      const shapeFile = path.join(process.env.READING_TEST_DATA, "last-read-shape.txt");
      const shape = fs.existsSync(shapeFile) ? fs.readFileSync(shapeFile, "utf8") : "";
      const shapeOk = /"seven_day"/.test(shape) && /"utilization": "number"/.test(shape) && !/\b40\b|\b12\b/.test(shape.split("\n").slice(2).join("\n"));
      if (!shapeOk) failed++;
      lines.push(`${shapeOk ? "pass" : "FAIL"}  a good reading saves the field names only${shape ? "" : " (no file)"}`);
      await run("the page never finishes loading", "slow", "", "ok week 40 session 12");
      await run("two readings asked at once", "normal", "", "ok week 40 session 12", { pair: true });
      await run("the page asks twice and the second answer fails", "twice", "?twice", "ok week 40 session 12");
      await run("the page refuses to close", "normal", "?unload", "ok week 40 session 12");
      await run("the session expired (401)", "401", "", "error need-login");
      await run("the page sends to the login", "redirect", "", "error need-login");
      await run("data in an unknown shape", "badjson", "", "error format");
      if (withSlow) await run("the answer never comes (25 s)", "hang", "", "error fail");
    } catch (e) {
      failed++;
      lines.push(`FAIL  the test itself: ${e && e.stack}`);
    }
    console.log(lines.join("\n"));
    console.log(failed ? `${failed} failed` : `${lines.length} of ${lines.length} cases passed`);
    server.close();
    app.exit(failed ? 1 : 0);
  });
});

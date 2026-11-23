// Reading test: runs the real claude-sync.js in Electron against a fake usage page served from this machine, and
// checks what a reading answers when the page is slow, asks twice, refuses to close, lost its session or never
// answers, and that no window is ever left behind. It never opens Claude and needs no account.
//
//   npm run test:reading             the quick cases (about 40 s)
//   npm run test:reading -- --slow   also the reading whose answer never comes (25 s more)
//
// It is not part of `npm test`: it needs a desktop to start Electron on.

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const electron = require("electron"); // from Node this is the path of the Electron binary
const data = fs.mkdtempSync(path.join(os.tmpdir(), "cqc-reading-"));
const env = { ...process.env, READING_TEST_DATA: data };
delete env.ELECTRON_RUN_AS_NODE; // set by some editors' terminals: Electron would then run as plain Node
let status = 1;
try {
  const run = spawnSync(electron, [path.join(__dirname, "app.js"), ...process.argv.slice(2)], { env, stdio: "inherit", timeout: 5 * 60 * 1000 });
  status = run.status === null ? 1 : run.status;
} finally {
  fs.rmSync(data, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
process.exit(status);

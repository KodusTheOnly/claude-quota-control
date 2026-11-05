const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { readActivity, hourStart } = require("../claude-activity");

const line = (obj) => JSON.stringify(obj) + "\n";

test("counts each answer once per hour, from timestamps and token counts only", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cqc-logs-"));
  try {
    const proj = path.join(dir, "some-project");
    fs.mkdirSync(path.join(proj, "sub"), { recursive: true });
    const at = new Date(2026, 10, 4, 14, 20).getTime();
    const usage = { input_tokens: 10, output_tokens: 90, cache_creation_input_tokens: 100, cache_read_input_tokens: 99999 };
    fs.writeFileSync(
      path.join(proj, "a.jsonl"),
      // the same answer written as two lines, a user line, and a broken line
      line({ type: "assistant", timestamp: new Date(at).toISOString(), message: { id: "m1", usage: { ...usage, output_tokens: 5 }, content: "secret words" } }) +
        line({ type: "assistant", timestamp: new Date(at + 1000).toISOString(), message: { id: "m1", usage } }) +
        line({ type: "user", timestamp: new Date(at).toISOString(), message: { content: "hello", usage: {} } }) +
        '{"broken": "usage" "timestamp"\n'
    );
    fs.writeFileSync(path.join(proj, "sub", "b.jsonl"), line({ type: "assistant", timestamp: new Date(at + 3600000).toISOString(), message: { id: "m2", usage: { input_tokens: 1, output_tokens: 1 } } }));
    const hours = await readActivity({ dir, sinceMs: at - 3600000, untilMs: at + 5 * 3600000 });
    assert.equal(hours.get(hourStart(at)), 200); // cache reads are not counted
    assert.equal(hours.get(hourStart(at + 3600000)), 2);
    assert.equal(hours.size, 2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a missing folder is not an error", async () => {
  const hours = await readActivity({ dir: path.join(os.tmpdir(), "cqc-does-not-exist"), sinceMs: 0 });
  assert.equal(hours.size, 0);
});

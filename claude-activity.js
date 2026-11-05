// Claude Code keeps a log of every session on this computer (~/.claude/projects/**/*.jsonl).
// This reads only two things from it: when each answer was written and how many tokens it used.
// It never keeps or sends what was said, it never calls Claude, and it uses none of your quota.
// The result is the shape of a week (which hours had Claude Code activity); the weekly percentage
// from the readings gives that shape its size.

const fs = require("fs");
const path = require("path");
const readline = require("readline");

const HOUR = 3600000;

// Local hour a timestamp falls in, as the start of that hour in ms
function hourStart(ms) {
  const d = new Date(ms);
  d.setMinutes(0, 0, 0);
  return d.getTime();
}

// How much one answer counts. Cache reads are left out: they are cheap and repeat the whole
// conversation on every answer, so they would drown out the work that was actually done.
function weightOf(usage) {
  const n = (v) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);
  return n(usage.input_tokens) + n(usage.output_tokens) + n(usage.cache_creation_input_tokens);
}

function listLogFiles(dir, sinceMs, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) listLogFiles(full, sinceMs, out);
    else if (e.isFile() && e.name.endsWith(".jsonl")) {
      try {
        const st = fs.statSync(full);
        if (st.mtimeMs >= sinceMs) out.push({ file: full, mtimeMs: st.mtimeMs, size: st.size });
      } catch {
        // a file that vanished is not a problem
      }
    }
  }
  return out;
}

// One answer can be written as several lines that repeat the same message id and usage: counted once.
async function scanFile(file, sinceMs, untilMs) {
  const seen = new Map(); // message id -> { at, weight }
  const rl = readline.createInterface({ input: fs.createReadStream(file, { encoding: "utf8" }), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.includes('"usage"') || !line.includes('"timestamp"')) continue;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    const msg = obj && obj.message;
    if (!msg || obj.type !== "assistant" || !msg.usage || typeof msg.id !== "string") continue;
    const at = Date.parse(obj.timestamp);
    if (!Number.isFinite(at) || at < sinceMs || at > untilMs) continue;
    const weight = weightOf(msg.usage);
    const prev = seen.get(msg.id);
    // The last line of a streamed answer has the final counts
    if (!prev || weight >= prev.weight) seen.set(msg.id, { at, weight });
  }
  return [...seen.values()];
}

// Returns Map(hour start ms -> weight) for the answers written between sinceMs and untilMs.
// `cache` (a Map the caller keeps) lets unchanged files be skipped on the next call.
async function readActivity({ dir, sinceMs, untilMs = Date.now(), cache = new Map() }) {
  const hours = new Map();
  for (const f of listLogFiles(dir, sinceMs)) {
    const key = `${sinceMs}|${untilMs - (untilMs % HOUR)}`;
    let rows;
    const hit = cache.get(f.file);
    if (hit && hit.mtimeMs === f.mtimeMs && hit.size === f.size && hit.key === key) {
      rows = hit.rows;
    } else {
      try {
        rows = await scanFile(f.file, sinceMs, untilMs);
      } catch {
        continue;
      }
      cache.set(f.file, { mtimeMs: f.mtimeMs, size: f.size, key, rows });
    }
    for (const r of rows) {
      const h = hourStart(r.at);
      hours.set(h, (hours.get(h) || 0) + r.weight);
    }
  }
  return hours;
}

module.exports = { readActivity, hourStart, weightOf, listLogFiles };

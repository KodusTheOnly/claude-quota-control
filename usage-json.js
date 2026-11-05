// Reads the usage data that Claude's usage page asks for by itself (JSON, not the text on screen).
// The shape is strict on purpose: anything unexpected is a "format" error, never a guess.
// Expected shape (only these fields are used, the rest is ignored):
//   { five_hour: null | { utilization: 0..100, resets_at: string | null },
//     seven_day: { utilization: 0..100, resets_at: ISO date string } }

const isPercent = (v) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 100;
const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

function toTime(v) {
  if (typeof v !== "string") return null;
  const ms = Date.parse(v);
  return Number.isFinite(ms) ? ms : null;
}

// Returns { ok: true, weekly, session } or { ok: false, problem }.
// `problem` names the field that is wrong. It never contains values, so it is safe to log.
function parseUsageJson(data) {
  if (!isObject(data)) return { ok: false, problem: "response is not an object" };

  const week = data.seven_day;
  if (!isObject(week)) return { ok: false, problem: "seven_day is missing" };
  if (!isPercent(week.utilization)) return { ok: false, problem: "seven_day.utilization is not a number from 0 to 100" };
  const weekReset = toTime(week.resets_at);
  if (weekReset === null) return { ok: false, problem: "seven_day.resets_at is not a date" };
  const weekly = { used: week.utilization, resetsAt: weekReset };

  // No session running right now is a normal state: five_hour can be null
  if (!("five_hour" in data)) return { ok: false, problem: "five_hour is missing" };
  let session = null;
  const five = data.five_hour;
  if (five !== null) {
    if (!isObject(five)) return { ok: false, problem: "five_hour is not an object" };
    if (!isPercent(five.utilization)) return { ok: false, problem: "five_hour.utilization is not a number from 0 to 100" };
    let sessionReset = null;
    if (five.resets_at !== null && five.resets_at !== undefined) {
      sessionReset = toTime(five.resets_at);
      if (sessionReset === null) return { ok: false, problem: "five_hour.resets_at is not a date" };
    }
    session = { used: five.utilization, resetsAt: sessionReset };
  }
  return { ok: true, weekly, session };
}

// Field names and types of a response, without any value. Saved when a reading fails, so the
// reader can be adjusted without keeping anyone's numbers.
function describeShape(v, depth = 0) {
  if (v === null) return "null";
  if (Array.isArray(v)) return v.length && depth < 4 ? [describeShape(v[0], depth + 1)] : "array";
  if (typeof v === "object") {
    if (depth >= 4) return "object";
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, describeShape(x, depth + 1)]));
  }
  return typeof v;
}

module.exports = { parseUsageJson, describeShape };

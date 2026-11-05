// Numbers behind the overview

function compute(src) {
  const now = Date.now();
  const today = dayKey(now);
  let { weekly: w, fiveHour: f, dayStart: ds } = src.data;
  let rolled = false;

  // The week rolled over after the last reading: assume 0% since the reset
  if (w.resetsAt <= now) {
    const resetsAt = nextReset(w.resetsAt, now);
    const lastReset = resetsAt - WEEK;
    w = { used: 0, resetsAt };
    ds = { day: today, at: Math.max(lastReset, startOfDay(now)), used: 0 };
    f = null;
    rolled = lastReset;
  }

  const days = mergedDays();
  const entry = !rolled && days[today];
  let budget;
  let spent;
  if (ds && ds.day === today) {
    // The budget uses the current weights; spend comes from the day record
    budget = dayBudget(100 - ds.used, w.resetsAt, now);
    spent = entry ? entry.spent : Math.max(w.used - ds.used, 0);
  } else {
    // No reading yet today: the budget starts from what is left
    budget = dayBudget(100 - w.used, w.resetsAt, now);
    spent = 0;
  }
  const leftAtDayStart = 100 - (ds && ds.day === today ? ds.used : w.used);
  const todayRatio = budget > 0 ? spent / budget : spent > 0 ? 2 : 0;
  const perDay = perNormalDay(100 - w.used, w.resetsAt, now);

  let five = null;
  if (f) {
    const valid = f.resetsAt ? f.resetsAt > now : now - (f.at || src.data.updatedAt) < 5 * HOUR;
    if (valid) five = f;
  }
  const pace = sessionPace(five, now);
  const forecast = forecastWeek(w, now);
  const m = { now, today, budget, spent, todayRatio, leftAtDayStart, w, perDay, five, pace, days, rolled, forecast };
  m.lv = computeLevels(m);
  m.head = headroom(m);
  m.math = mathRows(m);
  m.week = weekPlan(m);
  return m;
}

// Forecast from the average pace per weighted day since the last weekly reset
function forecastWeek(w, now) {
  if (w.used >= 100) return { kind: "out" };
  const p = projectWeek(w.used, w.resetsAt, now);
  if (!p) return { kind: "early" };
  // Judged on the projection as shown (whole percent), the same number the levels rate
  if (asShownPct(p.projected) <= 100) return { kind: "fits", spare: Math.max(100 - p.projected, 0), perDay: p.rate };
  // The walk can run past the reset when the last day is short; fall back to the reset itself
  return { kind: "short", eta: p.eta || w.resetsAt, perDay: p.rate };
}

// Status level

const LEVEL_KEYS = ["free", "moderate", "tight", "pause"];
const levelName = (i) => t(`level.${LEVEL_KEYS[i]}.name`);
const levelGuide = (i) => t(`level.${LEVEL_KEYS[i]}.guide`);

function warnAt() {
  return Number(state.settings && state.settings.fiveHourThreshold) || 75;
}

// Where the week ends at the pace so far. Unlike projectWeek this still answers when almost
// nothing was used, and it stays null only while the week is too young to project.
function projection(w, now) {
  const elapsed = weightedDays(w.resetsAt - WEEK, now);
  if (elapsed < MIN_WEIGHTED_DAYS) return null;
  const rate = w.used / elapsed; // % per weighted day
  return { elapsed, left: weightedDays(now, w.resetsAt), rate, projected: w.used + rate * weightedDays(now, w.resetsAt) };
}

// One level per module, from the cutoffs in core.js, plus the numbers behind them
function computeLevels(m) {
  const expected = expectedUsed(m.w.resetsAt, m.now);
  const weekRatio = expected > 0 ? m.w.used / expected : null;
  const proj = projection(m.w, m.now);
  // As shown: the projection appears as a whole percent, and its level rates that number
  const projRatio = proj ? asShownPct(proj.projected) / 100 : null;
  const lv = {
    session: m.five ? levelFromSession(m.five.used) : null,
    week: weekLevel(m.w.used, projRatio, weekRatio), // the projection's scale, see core.js
    today: m.budget > 0 || m.spent > 0 ? levelFromRatio(m.todayRatio) : null,
    projection: m.w.used >= 100 ? 3 : levelFromProjection(projRatio),
  };
  return { ...lv, expected, weekRatio, proj, projRatio };
}

// The answer to "can I use Claude until the reset?" follows the projection (the week's level while
// there is none yet). Only one thing can raise it: a week already at WEEK_PAUSE_AT or more.
function headroom(m) {
  const signals = [];
  const add = (level, reason, until) => signals.push({ level, reason, until });

  const base = m.lv.projection ?? m.lv.week ?? 0;
  if (weekAtPause(m.w.used)) add(3, t("reason.weekAt", { pct: pct(m.w.used) }), m.w.resetsAt);
  else if (base > 0 && m.forecast.kind === "short") add(base, t("reason.weekRunsOut", { when: fmtWhen(m.forecast.eta, m.now) }), m.w.resetsAt);
  else if (base > 0 && m.forecast.kind === "fits") add(base, t("reason.weekFits", { pct: pct(m.forecast.spare) }), m.w.resetsAt);
  else if (base > 0) add(base, t("reason.weekRatio", { ratio: m.lv.weekRatio === null ? "–" : fmtNum(m.lv.weekRatio, 2, 2) }), m.w.resetsAt);

  const level = Math.max(base, ...signals.map((s) => s.level));
  const top = signals.filter((s) => s.level === level);
  // When the current level eases (its last signal fades) and which level it drops to
  const topUntils = top.filter((s) => s.until).map((s) => s.until);
  const nextLevel = signals.filter((s) => s.level < level).reduce((a, s) => Math.max(a, s.level), 0);
  const extra = state.settings && state.settings.extra;
  const credits = level === 3 && extra && extra.balance > 0
    ? ` ${t("reason.credits", { amount: fmtMoney(extra.balance, extra.currency, extra.symbol) })}`
    : "";
  return {
    level,
    name: levelName(level),
    guide: levelGuide(level),
    reason: (level === 0 ? freeReason(m) : top.map((s) => s.reason).join(" ")) + credits,
    until: level > 0 && topUntils.length ? Math.max(...topUntils) : null,
    next: nextLevel,
  };
}

function freeReason(m) {
  const parts = [];
  if (m.five) parts.push(t("reason.free.session", { pct: pct(m.five.used) }));
  parts.push(t("reason.free.week", { pct: pct(m.w.used) }));
  if (m.budget > 0) parts.push(t("reason.free.today", { pct: pct(m.todayRatio * 100) }));
  const text = parts.join(", ");
  const sentence = text.charAt(0).toUpperCase() + text.slice(1) + ".";
  // Free because more than 20% would be left at the reset: say how much, as a plain fact. Not while the
  // verdict still reads "still early" (forecastWeek waits for 1% used), so the two never disagree.
  const L = m.lv;
  if (m.forecast.kind !== "early" && L.proj && L.projRatio !== null && L.projRatio < PROJECTION_CUTS[0]) {
    return `${sentence} ${t("reason.free.leftAtReset", { pct: pct(100 - L.proj.projected) })}`;
  }
  return sentence;
}

// The projection cutoffs as % of the weekly limit ({ a: "80%", b: "100%", c: "140%" }), read from
// PROJECTION_CUTS so the Math drawer and Help say what the code does
function projectionCutoffs() {
  const [a, b, c] = PROJECTION_CUTS.map((x) => pct(x * 100));
  return { a, b, c };
}

// "Show the math": for each module, the rows that explain its number and its level.
// Each row is [label key, value]; the screens translate the label.
function mathRows(m) {
  const f2 = (x) => (x === null || x === undefined ? "–" : fmtNum(x, 2, 2));
  const lvName = (i) => (i === null || i === undefined ? t("level.none.name") : levelName(i));
  const L = m.lv;
  const rows = {};
  rows.session = m.five
    ? [
        ["math.used", pct(m.five.used)],
        ["math.cutoffsSession", t("math.cutoffsSessionValue")],
        ["math.level", lvName(L.session)],
        ...(m.five.resetsAt ? [["math.resetsIn", fmtDur(m.five.resetsAt - m.now)]] : []),
      ]
    : [["math.noReading", "–"]];
  const elapsed = weightedDays(m.w.resetsAt - WEEK, m.now);
  const total = weightedDays(m.w.resetsAt - WEEK, m.w.resetsAt);
  rows.week = [
    ["math.used", pct(m.w.used)],
    ["math.expected", `${pct(L.expected)} (${fmtNum(elapsed)} / ${fmtNum(total)})`],
    ["math.usedOverExpected", f2(L.weekRatio)],
    // The level: the projection's scale once there is one, used / expected before that (see weekLevel)
    ...(L.proj
      ? [
          ["math.weekScale", t("math.weekScaleProj")],
          ["math.projectedOverLimit", f2(L.projRatio)],
          ["math.cutoffsProjection", t("math.cutoffsProjectionValue", projectionCutoffs())],
        ]
      : [
          ["math.weekScale", t("math.weekScaleRatio")],
          ["math.cutoffsRatio", t("math.cutoffsRatioValue")],
        ]),
    ...(weekAtPause(m.w.used) ? [["math.weekPause", t("math.weekPauseValue", { pct: `${WEEK_PAUSE_AT}%` })]] : []),
    ["math.level", lvName(L.week)],
  ];
  rows.today = [
    ["math.spentToday", pct(m.spent)],
    ["math.budgetToday", pct(m.budget)],
    ["math.usedOverBudget", f2(m.budget > 0 ? m.todayRatio : null)],
    ["math.cutoffsRatio", t("math.cutoffsRatioValue")],
    ["math.level", lvName(L.today)],
  ];
  rows.projection = L.proj
    ? [
        ["math.pace", t("math.paceValue", { rate: fmtNum(L.proj.rate) })],
        ["math.daysLeft", fmtNum(L.proj.left)],
        ["math.projected", pct(L.proj.projected)],
        ["math.projectedOverLimit", f2(L.projRatio)],
        ["math.cutoffsProjection", t("math.cutoffsProjectionValue", projectionCutoffs())],
        ["math.level", lvName(L.projection)],
      ]
    : [["math.tooEarly", t("forecast.early")]];
  return rows;
}

// The seven days of the plan, starting on the weekday of the weekly reset.
// Past days use what was recorded; today uses the live budget; days ahead split what was
// left at the start of today in proportion to their weights (the same rule as dayBudget).
function weekPlan(m, w = weights()) {
  const first = startOfDay(m.w.resetsAt - WEEK);
  const todayIdx = Math.round((startOfDay(m.now) - first) / DAY);
  const f = new Date(first);
  const from = Math.max(startOfDay(m.now), m.w.resetsAt - WEEK);
  const totalW = weightedDays(from, m.w.resetsAt, w);
  const out = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(f.getFullYear(), f.getMonth(), f.getDate() + i);
    const ms = d.getTime();
    const dow = d.getDay();
    const wt = w[dow];
    const isToday = i === todayIdx;
    let when = i < todayIdx ? "past" : isToday ? "today" : "future";
    let budget = null;
    let spent = null;
    if (when === "today") {
      budget = m.budget;
      spent = m.spent;
    } else if (when === "past") {
      const rec = m.days[dayKey(ms)];
      if (rec) {
        budget = rec.budget;
        spent = rec.spent;
      }
    } else {
      // A day's share is its weight inside the week (the last day may end at the reset)
      const share = dayShare(ms, m.w.resetsAt, w);
      budget = share > 0 ? (m.leftAtDayStart * share) / Math.max(totalW, share) : 0;
    }
    const known = spent !== null && budget !== null;
    const ratio = known ? (budget > 0 ? spent / budget : spent > 0 ? 2 : 0) : null;
    // A day off with nothing spent reads as off, whatever came before
    const off = wt === 0 && !(spent > 0);
    const kind = off ? "off" : when;
    out.push({
      i, ms, dow, weight: wt, name: WEIGHT_NAME[wt] || "normal", kind, when, isToday,
      budget, spent, ratio,
      level: kind === "past" || kind === "today" ? levelFromRatio(ratio) : null,
      fill: ratio === null ? 0 : Math.min(ratio / 1.5, 1) * 100,
    });
  }
  return out;
}

// The budget a day would have if its weight were wt, with every other day as it is now. Today's budget and the
// days ahead are worked out by the same functions compute() and weekPlan() use, so the plan menu's preview
// equals what the day shows once the option is chosen.
function previewBudget(m, i, wt) {
  const day = m.week[i];
  const w = weights();
  w[day.dow] = wt;
  return day.when === "today" ? dayBudget(m.leftAtDayStart, m.w.resetsAt, m.now, w) : weekPlan(m, w)[i].budget;
}

// The hard limit that would block you first, before the reset: { kind: "session" | "week", ms } or null.
// The session counts when its pace fills it before its own reset; the week when the projection runs past 100%.
// Today's budget is a goal, not a block, so it is not a candidate. While the week has no projection yet, only the session counts.
function limitsFirst(m) {
  const found = [];
  const p = m.pace;
  if (m.five && m.five.resetsAt && p && p.known && p.fullAt && p.fullAt > m.now && p.fullAt < m.five.resetsAt) found.push({ kind: "session", ms: p.fullAt });
  const f = m.forecast;
  if (f && f.kind === "short" && f.eta > m.now && f.eta < m.w.resetsAt) found.push({ kind: "week", ms: f.eta });
  found.sort((a, b) => a.ms - b.ms);
  return found[0] || null;
}

// The lines of the week's pace chart. x is measured in days from the midnight that starts the plan's
// first day, so the seven day columns are [0,1], [1,2] ... [6,7]. The week itself runs from s0 (the time of
// the reset, as a fraction of that first day) to span (the next reset, a week later). y is % of the weekly limit.
//   expected  the plan's pace: how much should be used at every midnight, ending at 100% at the reset
//   used      what was used: the end of each past day (recorded), then now. With the hours' cells (hourly.js) each day is a
//             set of steps instead of a straight piece; a point with est: true ends a piece placed by estimated cells
//   starts    when 5-hour sessions started so far this week: [{ ms, x }]
//   over      the parts of the used line that went past the day's budget (that spend is "borrowed" from other days)
//   proj      where the pace so far leads, until the reset or until it reaches 100%
//   end       what the projection says at its end: { kind: "reset", pct } or { kind: "limit", ms }
function paceSeries(m, cells = null, starts = []) {
  const w = weights();
  const first = startOfDay(m.w.resetsAt - WEEK);
  const dayIdx = (ms) => Math.round((startOfDay(ms) - first) / DAY);
  const toX = (ms) => dayIdx(ms) + (ms - startOfDay(ms)) / DAY;
  const midnight = (k) => {
    const d = new Date(first);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() + k).getTime();
  };
  const weekStart = m.w.resetsAt - WEEK;
  const s0 = toX(weekStart);
  const span = toX(m.w.resetsAt);
  const nowX = Math.min(toX(m.now), span);

  const expected = [{ x: s0, y: 0 }];
  for (let k = 1; k <= 8; k++) {
    const ms = midnight(k);
    if (ms >= m.w.resetsAt) break;
    if (ms > weekStart) expected.push({ x: toX(ms), y: expectedUsed(m.w.resetsAt, ms, w) });
  }
  expected.push({ x: span, y: 100 });

  // Past days, from what was recorded. A day without a record keeps the line flat.
  const todayIdx = dayIdx(m.now);
  const used = [{ x: s0, y: 0 }];
  const over = [];
  const addOver = (x0, x1, y0, spent, budget, steps = null) => {
    if (budget === null || spent === null || spent <= budget + 1e-6 || spent <= 0) return;
    if (steps) {
      const above = lineAbove(steps, y0 + budget);
      if (above) over.push(above);
      return;
    }
    const f = budget / spent;
    over.push([{ x: x0 + f * (x1 - x0), y: y0 + budget }, { x: x1, y: y0 + spent }]);
  };
  // The day's piece of the line as steps, or null when the hours cannot place it (then it stays straight)
  const stepsFor = (fromMs, toMs, y0, y1) => {
    const steps = cells ? hourlySteps({ cells, from: fromMs, to: toMs, y0, y1 }) : null;
    return steps && steps.map((p) => (p.est ? { x: toX(p.ms), y: p.y, est: true } : { x: toX(p.ms), y: p.y }));
  };
  let end = 0;
  for (let i = 0; i < Math.min(todayIdx, 7); i++) {
    const rec = m.days[dayKey(midnight(i))];
    const x0 = Math.max(i, s0);
    const y0 = end;
    if (rec) end = typeof rec.endUsed === "number" ? Math.max(rec.endUsed, end) : end + rec.spent;
    const steps = stepsFor(Math.max(midnight(i), weekStart), midnight(i + 1), y0, end);
    if (steps) used.push(...steps.slice(1));
    else used.push({ x: i + 1, y: end });
    if (rec) addOver(x0, i + 1, y0, rec.spent, rec.budget, steps);
  }
  // Today: from what was used when the day started to what is used now
  const startToday = 100 - m.leftAtDayStart;
  if (todayIdx >= 0 && nowX >= s0) {
    if (startToday > end || used.length === 1) used.push({ x: Math.max(todayIdx, s0), y: Math.max(startToday, end) });
    const y0 = Math.max(startToday, end);
    const steps = stepsFor(Math.max(midnight(todayIdx), weekStart), m.now, y0, m.w.used);
    if (steps) {
      steps[steps.length - 1].x = nowX; // the line ends at the NOW marker, exactly
      used.push(...steps.slice(1));
    } else {
      used.push({ x: nowX, y: m.w.used });
    }
    addOver(Math.max(todayIdx, s0), nowX, y0, m.spent, m.budget, steps);
  }

  // Where the pace so far leads: walk forward day by day, since weights change the slope at every midnight
  let proj = null;
  let endLabel = null;
  if (m.w.used >= 100) {
    endLabel = { kind: "out" };
  } else if (m.lv.proj) {
    const rate = m.lv.proj.rate;
    proj = [{ x: nowX, y: m.w.used }];
    let cur = m.now;
    let y = m.w.used;
    while (cur < m.w.resetsAt) {
      const next = Math.min(midnight(dayIdx(cur) + 1), m.w.resetsAt);
      const dy = rate * weightedDays(cur, next, w);
      if (dy > 0 && y + dy >= 100) {
        const ms = cur + ((100 - y) / dy) * (next - cur);
        proj.push({ x: toX(ms), y: 100 });
        endLabel = { kind: "limit", ms };
        break;
      }
      y += dy;
      proj.push({ x: next === m.w.resetsAt ? span : toX(next), y });
      cur = next;
    }
    if (!endLabel) endLabel = { kind: "reset", pct: y };
  }
  const startsOut = starts.filter((ms) => ms >= weekStart && ms <= m.now && toX(ms) < 7).map((ms) => ({ ms, x: toX(ms) }));
  return { s0, span, nowX, todayIdx, expected, used, over, proj, end: endLabel, usedNow: m.w.used, starts: startsOut };
}

// Saving a reading (typed in or read from Claude)

async function saveManual({ weekly, session, sessionReset, sessionResetAt, anchor, via = "manual" }) {
  const now = Date.now();
  const today = dayKey(now);
  const prev = state.settings.manual || {};
  const anchorMs = anchor || prev.anchor;
  const resetsAt = nextReset(anchorMs, now);

  const prevW = prev.weekly;
  const sameWeek = prevW && Math.abs(nextReset(prevW.resetsAt, prevW.resetsAt - 1) - resetsAt) < HOUR;
  const delta = prevW ? (sameWeek ? Math.max(weekly - prevW.used, 0) : weekly) : 0;

  let dayStart = prev.dayStart;
  if (!prevW) {
    dayStart = { day: today, at: now, used: weekly };
  } else if (!sameWeek) {
    dayStart = { day: today, at: Math.max(resetsAt - WEEK, startOfDay(now)), used: 0 };
  } else if (!dayStart || dayStart.day !== today) {
    // First record of the day: whatever rose since the last reading counts for today
    dayStart = { day: today, at: now, used: prevW.used };
  }

  const days = { ...(prev.days || {}) };
  // New week mid-day: today's spend restarts along with the limit
  const entry = (sameWeek && days[today]) || {};
  days[today] = {
    spent: round2((entry.spent || 0) + delta),
    budget: round2(dayBudget(100 - dayStart.used, resetsAt, now)),
    endUsed: weekly,
  };
  const cutoff = dayKey(now - 120 * DAY);
  for (const k of Object.keys(days)) if (k < cutoff) delete days[k];

  let fiveHour = prev.fiveHour || null;
  if (session !== null && session !== undefined) {
    let sr = sessionResetAt || null;
    if (!sr && sessionReset) {
      const [h, mi] = sessionReset.split(":").map(Number);
      const d = new Date(now);
      d.setHours(h, mi, 0, 0);
      sr = d.getTime();
      if (sr <= now) sr += DAY;
    }
    fiveHour = { used: session, resetsAt: sr, at: now };
  }

  const manual = { anchor: anchorMs, updatedAt: now, via, weekly: { used: weekly, resetsAt }, fiveHour, dayStart, days };
  state.settings = await api.setSettings({ manual });
  await logReading({
    at: now,
    weekly,
    session: session ?? null,
    sessionResetsAt: fiveHour && session !== null && session !== undefined ? fiveHour.resetsAt : null,
  });
  render({ fresh: true });
}

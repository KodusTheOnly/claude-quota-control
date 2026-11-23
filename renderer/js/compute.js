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
  } else if (w.resetsAt - now > WEEK) {
    // A reset more than a week away cannot be this week's: it is the same weekly cycle, some weeks ahead
    w = { ...w, resetsAt: nextReset(w.resetsAt, now) };
  }

  const days = mergedDays();
  const entry = !rolled && days[today];
  const g = goalSettings();
  // Where the week stood when today began. Without a reading yet today, the budget starts from what is left now.
  const dsToday = Boolean(ds && ds.day === today);
  let usedStart = dsToday ? ds.used : w.used;
  const spent = dsToday ? (entry ? entry.spent : Math.max(w.used - ds.used, 0)) : 0;
  // The week went down without a reset (Claude gave part of it back): today's use counts from the lower number,
  // as if the give-back came first. saveManual keeps dayStart that way; this covers a record saved before it did.
  if (dsToday && w.used + 0.5 < usedStart) usedStart = Math.max(w.used - spent, 0);
  // The budget uses the current weights, goal and reserve; spend comes from the day record
  const budget = planBudget(usedStart, w.resetsAt, now, g);
  const leftAtDayStart = 100 - usedStart;
  // Above the plan's ceiling the use comes from the emergency reserve: the reserve mode, until the goal
  const ceiling = planCeiling(now, w.resetsAt, g);
  const reserveMode = g.reserve > 0 && asShownPct(w.used) > asShownPct(ceiling) && asShownPct(w.used) < g.goal;
  // An Off day has no budget, so no ratio: it is not rated, whatever was used. Nor is a day on the reserve:
  // its plan is spent, so it shows what came from the reserve instead.
  // Nor are the hours after a reset that falls past the end of the active hours (dayIdle): no plan time today
  const idle = dayIdle(now, w.resetsAt);
  const dayOff = isDayOff(now) || idle;
  const todayRatio = dayOff || reserveMode ? 0 : budget > 0 ? spent / budget : spent > 0 ? 2 : 0;
  const perDay = perNormalDay(100 - w.used, w.resetsAt, now);

  let five = null;
  if (f) {
    const valid = f.resetsAt ? f.resetsAt > now : now - (f.at || src.data.updatedAt) < 5 * HOUR;
    if (valid) five = f;
  }
  const pace = sessionPace(five, now);
  // What the past weeks taught (learn.js) and where this week ends with it
  const learn = learnProfile(days, w.resetsAt);
  const drops = rolled ? [] : weekDrops((state.settings && state.settings.readings) || [], w.resetsAt - WEEK, now);
  // What Claude gave back this week: it still counts toward the pace, since it was used
  const given = drops.reduce((s, d) => s + d.from - d.to, 0);
  const proj = learnedProjection(w.used, w.resetsAt, now, weights(), learn, given);
  const forecast = forecastWeek(w, now, proj);
  const m = { now, today, g, usedStart, ceiling, reserveMode, budget, spent, dayOff, idle, todayRatio, leftAtDayStart, w, perDay, five, pace, days, rolled, forecast, learn, proj, drops, given };
  m.lv = computeLevels(m);
  m.head = headroom(m);
  // The last day with room to spend: the risk is leaving it unused, not running out, so the week takes the accent
  m.endRoom = Boolean(m.head.room) && w.resetsAt - now <= DAY;
  // Today's own share of the plan; the rest of today's budget was carried over from earlier days
  m.planToday = planDayShare(now, w.resetsAt, weights(), g);
  m.math = mathRows(m);
  m.week = weekPlan(m);
  return m;
}

// Forecast from the projection p (learnedProjection in learn.js). With no past week to learn from it waits for
// 1% used, since a pace of nothing says nothing; with past weeks the usual pace answers from the start.
// Where the week's use went down without a reset (Claude gave part of the week back), from the readings log
// (core.js): [{ at, from, to }], at being the reading that first showed the lower number. A drop under one point is noise.
function weekDrops(readings, weekStart, now) {
  const out = [];
  let last = null;
  const list = (readings || []).filter((r) => r && Number.isFinite(r.at) && Number.isFinite(r.w) && r.at >= weekStart && r.at <= now);
  for (const r of list.sort((a, b) => a.at - b.at)) {
    if (last && r.w < last.w - 0.5) out.push({ at: r.at, from: last.w, to: r.w });
    last = r;
  }
  return out;
}

function forecastWeek(w, now, p) {
  if (w.used >= 100) return { kind: "out" };
  if (!p || (!p.weeks && w.used < 1)) return { kind: "early" };
  // Judged on the projection as shown (whole percent), the same number the levels rate
  if (asShownPct(p.projected) <= 100) return { kind: "fits", spare: Math.max(100 - p.projected, 0), perDay: p.rate };
  // The walk can run past the reset when the last day is short; fall back to the reset itself
  return { kind: "short", eta: paceReaches(100, w.used, p.rate, now, w.resetsAt, p.w) || w.resetsAt, perDay: p.rate };
}

// Status level

const LEVEL_KEYS = ["free", "moderate", "tight", "pause"];
const levelName = (i) => t(`level.${LEVEL_KEYS[i]}.name`);
const levelGuide = (i) => t(`level.${LEVEL_KEYS[i]}.guide`);

function warnAt() {
  return Number(state.settings && state.settings.fiveHourThreshold) || 75;
}

// Hours from now to the week's reset
const hoursToReset = (m) => (m.w.resetsAt - m.now) / HOUR;

// The plan's expected line, ms -> % of the week. After a give-back it starts again from where the week fell to and
// walks to the goal at the reset with the plan's own shape, so "expected" keeps meaning "on plan from here".
// Without a give-back it is expectedUsed (core.js).
function expectedLine(m, w = weights()) {
  let f = (ms) => expectedUsed(m.w.resetsAt, ms, w, m.g);
  for (const d of [...(m.drops || [])].sort((x, y) => x.at - y.at)) {
    const prev = f;
    const e0 = prev(d.at);
    const room = m.g.goal - e0;
    if (!(room > 0.5)) continue; // at the very end of the plan there is nothing left to start again
    const scale = (m.g.goal - d.to) / room;
    f = (ms) => (ms < d.at ? prev(ms) : d.to + (prev(ms) - e0) * scale);
  }
  return f;
}

// One level per module, from the cutoffs in core.js, plus the numbers behind them
function computeLevels(m) {
  const expected = expectedLine(m)(m.now);
  const weekRatio = expected > 0 ? m.w.used / expected : null;
  // Where the week ends (m.proj, from compute): null only while the week is too young and there is no past week
  const proj = m.proj;
  // As shown: the projection appears as a whole percent
  const projRatio = proj ? asShownPct(proj.projected) / 100 : null;
  // The same pace as the projection and the dashed line: when it reaches LOCK_AT and how long before the reset
  const lock = proj ? weekLockout(m.w.used, proj.rate, m.now, m.w.resetsAt, proj.w, m.g.goal) : null;
  const lockLevel = lock ? levelFromLockout(lock.hours) : null;
  const lv = {
    session: m.five ? levelFromSession(m.five.used) : null,
    week: weekLevel(m.w.used, lock ? lock.hours : null, weekRatio, hoursToReset(m)), // the hours locked out, see core.js
    today: m.dayOff || m.reserveMode ? null : m.budget > 0 || m.spent > 0 ? levelFromRatio(m.todayRatio) : null,
    projection: m.w.used >= 100 ? 3 : lockLevel,
  };
  // How much to slow down: only once the hours locked out reach Moderate
  const slow = lockLevel >= 1 ? slowDownPct(m.w.used, proj.projected, m.g.goal) : null;
  // The pace the plan asks for (to end at the ceiling at the reset) and the pace so far, both in % per weighted day
  const need = proj && proj.left > 0.05 ? Math.max(m.ceiling - m.w.used, 0) / proj.left : null;
  const doing = proj ? proj.rate : null;
  // Room to spend: no lockout ahead, but the pace ends well under the plan's ceiling (more than ROOM_GAP points)
  const room = !m.reserveMode && lockLevel === 0 && m.w.used < 100 && m.forecast.kind !== "early"
    && asShownPct(proj.projected) < asShownPct(m.ceiling) - ROOM_GAP;
  return { ...lv, expected, weekRatio, proj, projRatio, lock, slow, need, doing, room };
}

// The answer to "can I use Claude until the reset?" follows the projection (the week's level while
// there is none yet). Only one thing can raise it: a week already at WEEK_PAUSE_AT or more (see weekAtPause).
function headroom(m) {
  const signals = [];
  const add = (level, reason, until) => signals.push({ level, reason, until });

  const base = m.lv.projection ?? m.lv.week ?? 0;
  if (weekAtPause(m.w.used, hoursToReset(m))) add(3, t("reason.weekAt", { pct: pct(m.w.used) }), m.w.resetsAt);
  else if (base > 0 && m.lv.lock && m.lv.lock.at !== null) add(base, t("reason.weekLocked", { goal: m.g.goal, when: fmtWhen(m.lv.lock.at, m.now), dur: lockDur(m.lv.lock.hours) }), m.w.resetsAt);
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
    room: level === 0 && m.lv.room,
    reserve: m.reserveMode,
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
  // With a projection, say how much would be left at the reset, as a plain fact. Not while the verdict
  // still reads "warming up" (forecastWeek waits for 1% used), so the two never disagree.
  const L = m.lv;
  if (m.forecast.kind !== "early" && L.proj && L.projection === 0 && L.proj.projected < m.ceiling) {
    return `${sentence} ${t("reason.free.leftAtReset", { pct: pct(m.ceiling - L.proj.projected) })}`;
  }
  return sentence;
}

// The hours locked out as the screen writes them: "12 h", or "2 d" above 48 h (see lockShown)
function lockDur(hours) {
  const s = lockShown(hours);
  return t(s.unit === "d" ? "dur.lockDays" : "dur.lockHours", { n: s.n });
}
// The cutoffs of the hours locked out ({ a: "0 h", b: "5 h", c: "24 h" }), read from LOCK_CUTS so the
// Math drawer and Help say what the code does
function lockCutoffs() {
  const [a, b, c] = LOCK_CUTS.map((h) => t("dur.lockHours", { n: h }));
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
  // When the pace reaches LOCK_AT, the hours that leaves without Claude, and how much to slow down
  const lockRows = L.lock
    ? [
        ["math.hitsLock", L.lock.at === null ? t("math.notBeforeReset") : fmtWhen(L.lock.at, m.now)],
        ["math.hoursLocked", lockDur(L.lock.hours)],
        ["math.slowNeeded", L.slow === null ? "–" : `~${L.slow}%`],
      ]
    : [];
  const elapsed = weightedDays(m.w.resetsAt - WEEK, m.now);
  const total = weightedDays(m.w.resetsAt - WEEK, m.w.resetsAt);
  rows.week = [
    ["math.used", pct(m.w.used)],
    // After a give-back the line starts again from the drop, so the share of plan days no longer explains it
    ["math.expected", m.drops && m.drops.length ? pct(L.expected) : `${pct(L.expected)} (${fmtNum(elapsed)} / ${fmtNum(total)})`],
    ["math.usedOverExpected", f2(L.weekRatio)],
    // The reserve and the plan's ceiling now (100% minus the reserve still held)
    ...(m.g.reserve
      ? [
          ["math.reserve", t("math.reserveValue", { left: pct(reserveLeft(m.w.used, m.g)), size: pct(m.g.reserve) })],
          ["math.ceiling", pct(m.ceiling)],
        ]
      : []),
    ...(L.need !== null ? [["math.need", t("math.perDayValue", { pct: fmtNum(L.need, 0, 1) })], ["math.doing", t("math.perDayValue", { pct: fmtNum(L.doing, 0, 1) })]] : []),
    // The level: the hours locked out once there is a projection, used / expected before that (see weekLevel)
    ...(L.proj
      ? [
          ...lockRows,
          ["math.cutoffsProjection", t("math.cutoffsProjectionValue", lockCutoffs())],
        ]
      : [
          ["math.weekScale", t("math.weekScaleRatio")],
          ["math.cutoffsRatio", t("math.cutoffsRatioValue")],
        ]),
    ...(weekAtPause(m.w.used, hoursToReset(m)) ? [["math.weekPause", t("math.weekPauseValue", { pct: `${WEEK_PAUSE_AT}%` })]] : []),
    ["math.level", lvName(L.week)],
  ];
  // Past today's budget: what the days ahead give up for it, split by their weights (see weekPlan)
  const overBy = m.reserveMode ? 0 : m.w.used - (m.usedStart + m.budget);
  rows.today = [
    ["math.spentToday", pct(m.spent)],
    ["math.budgetToday", pct(m.budget)],
    ...(asShownPct(overBy) >= 1 ? [["math.overToday", t("math.overTodayValue", { pct: pct(overBy) })]] : []),
    ["math.usedOverBudget", f2(m.budget > 0 ? m.todayRatio : null)],
    ["math.cutoffsRatio", t("math.cutoffsRatioValue")],
    ["math.level", lvName(L.today)],
  ];
  rows.projection = L.proj
    ? [
        // With past weeks: this week's pace, the usual one, and the mix of the two the projection walks at
        ...(L.proj.weeks
          ? [
              ["math.paceOwn", L.proj.own === null ? "–" : t("math.paceValue", { rate: fmtNum(L.proj.own) })],
              ["math.paceUsual", t("math.paceUsualValue", { rate: fmtNum(L.proj.usual), n: L.proj.weeks })],
            ]
          : []),
        [L.proj.weeks ? "math.paceMixed" : "math.pace", t("math.paceValue", { rate: fmtNum(L.proj.rate) })],
        ["math.daysLeft", fmtNum(L.proj.left)],
        ["math.projected", pct(L.proj.projected)],
        ["math.range", rangeShown(L.proj).text],
        ...lockRows,
        ["math.cutoffsProjection", t("math.cutoffsProjectionValue", lockCutoffs())],
        ["math.level", lvName(L.projection)],
      ]
    : [["math.tooEarly", t("hero.ans.early")]];
  return rows;
}

// The seven days of the plan, starting on the weekday of the weekly reset.
// Past days use what was recorded; today uses the live budget; days ahead split what was
// left at the start of today in proportion to their weights (the same rule as dayBudget).
// Once today goes past its budget the days ahead pay for it: they split what is really left now among
// themselves (what tomorrow's budget will be if nothing more is used today). planned keeps the morning's
// number, so the screen can say how much today took from each day (planned - budget).
function weekPlan(m, w = weights()) {
  const first = startOfDay(m.w.resetsAt - WEEK);
  const todayIdx = Math.round((startOfDay(m.now) - first) / DAY);
  const f = new Date(first);
  const from = Math.max(startOfDay(m.now), m.w.resetsAt - WEEK);
  const totalW = weightedDays(from, m.w.resetsAt, w);
  // Today's budget with these weights (m.budget, unless the plan menu is trying another plan)
  const overToday = m.w.used > m.usedStart + planBudget(m.usedStart, m.w.resetsAt, m.now, m.g, w) + 1e-9;
  const now = new Date(m.now);
  const tomorrow = Math.min(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime(), m.w.resetsAt);
  const totalAhead = weightedDays(tomorrow, m.w.resetsAt, w);
  const out = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(f.getFullYear(), f.getMonth(), f.getDate() + i);
    const ms = d.getTime();
    const dow = d.getDay();
    const wt = w[dow];
    const isToday = i === todayIdx;
    let when = i < todayIdx ? "past" : isToday ? "today" : "future";
    let budget = null;
    let planned = null;
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
      // A day's share is its weight inside the week (the last day may end at the reset), of the plan left at the
      // start of today, plus the part of the reserve its hours release (see planBudget)
      const share = dayShare(ms, m.w.resetsAt, w);
      const planLeft = Math.max(m.g.goal - m.g.reserve - m.usedStart, 0);
      const end = Math.min(new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime(), m.w.resetsAt);
      planned = share > 0
        ? (planLeft * share) / Math.max(totalW, share) + reserveReleased(reserveLeft(m.usedStart, m.g), Math.max(ms, from), end, from, m.w.resetsAt, m.g, w)
        : 0;
      budget = planned;
      if (overToday && share > 0) {
        const leftNow = Math.max(m.g.goal - m.g.reserve - m.w.used, 0);
        const live = (leftNow * share) / Math.max(totalAhead, share) + reserveReleased(reserveLeft(m.w.used, m.g), Math.max(ms, tomorrow), end, tomorrow, m.w.resetsAt, m.g, w);
        budget = Math.min(planned, live);
      }
    }
    const known = spent !== null && budget !== null;
    const ratio = known ? (budget > 0 ? spent / budget : spent > 0 ? 2 : 0) : null;
    // A day off with nothing spent reads as off, whatever came before. Today off is always off, even
    // with use: it has no budget to rate it against (it shows what was used instead, see week.js)
    const off = (wt === 0 && (isToday || !(spent > 0))) || (isToday && Boolean(m.idle));
    const kind = off ? "off" : when;
    // Today on the reserve is not rated either: its plan is spent (see compute)
    const rated = (off && isToday) || (isToday && m.reserveMode) ? null : ratio;
    out.push({
      i, ms, dow, weight: wt, name: WEIGHT_NAME[wt] || "normal", kind, when, isToday, idle: isToday && Boolean(m.idle),
      budget, planned, spent, ratio: rated,
      level: kind === "past" || kind === "today" ? levelFromRatio(rated) : null,
      fill: rated === null ? 0 : Math.min(rated / 1.5, 1) * 100,
    });
  }
  return out;
}

// What a past day shows on its last line, "used / budget%": both as % of the weekly limit, whole numbers as on screen.
// Used is the recorded spend; when the record has none it is worked out from the day's ratio and its budget.
// The budget is the one recorded with the day (the rolling budget of its last reading), null when none was recorded.
// Returns null for a day with no reading at all. d is an entry of weekPlan().
function pastDayFigures(d) {
  const budget = Number.isFinite(d.budget) && d.budget > 0 ? d.budget : null;
  const spent = Number.isFinite(d.spent) ? d.spent : budget !== null && Number.isFinite(d.ratio) ? d.ratio * budget : null;
  if (spent === null) return null;
  return { used: Math.round(spent) || 0, budget: budget === null ? null : Math.round(budget) };
}

// The budget a day would have if its weight were wt, with every other day as it is now. Today's budget and the
// days ahead are worked out by the same functions compute() and weekPlan() use, so the plan menu's preview
// equals what the day shows once the option is chosen.
function previewBudget(m, i, wt) {
  const day = m.week[i];
  const w = weights();
  w[day.dow] = wt;
  return day.when === "today" ? planBudget(m.usedStart, m.w.resetsAt, m.now, m.g, w) : weekPlan(m, w)[i].budget;
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
// the reset, as a fraction of that first day) to span (the next reset, a week later). The chart's axis starts at a0
// (chartAxisStart: the reset, or earlier when it is late in the day). y is % of the weekly limit.
//   expected  the plan's pace: how much should be used at every midnight, ending at 100% at the reset
//   used      what was used: the end of each past day (recorded), then now. With the hours' cells (hourly.js) each day is a
//             set of steps instead of a straight piece; a point with est: true ends a piece placed by estimated cells
//   starts    when 5-hour sessions started so far this week: [{ ms, x }]
//   over      the parts of the used line that went past the day's budget (that spend is "borrowed" from other days)
//   proj      where the pace so far leads: until the reset, or until T when the level counts hours locked out (it reaches 100%)
//   lock      from T to the reset along the 100% line, the time without Claude (null when there is none)
//   band      the likely range at the reset, a fan from now (null when there is none)
//   end       what the projection says at its end: { kind: "reset", pct }, { kind: "lock", ms } (T) or { kind: "limit", ms }
//   room      what is still free before the reset: a box from now to the reset, from what is used to the plan's
//             ceiling at the reset ({ x0, x1, y0, y1 }), null when nothing is left or on the reserve. With a projection that
//             ends inside it, mid is where it ends (the pace so far uses the box up to there) and spend is what is left
//             above it, the same number as the band's "to spend" chip; otherwise (no projection yet, or a pace that reaches the
//             goal) mid is null and spend is 0: nothing extra to spend
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

  // A point wherever the slope changes: every midnight and, with active hours, every edge of the window.
  // A give-back drops the line straight down where it happened (expectedLine).
  const expAt = expectedLine(m, w);
  const expected = [{ x: s0, y: 0 }];
  const bends = new Set();
  for (const p of weightPieces(weekStart, m.w.resetsAt, w)) bends.add(p.from).add(p.to);
  for (let k = 1; k <= 8; k++) bends.add(midnight(k));
  for (const ms of [...bends].sort((a, b) => a - b)) {
    if (ms > weekStart && ms < m.w.resetsAt) expected.push({ x: toX(ms), y: expAt(ms) });
  }
  for (const d of m.drops || []) {
    if (d.at <= weekStart || d.at >= m.w.resetsAt) continue;
    expected.push({ x: toX(d.at), y: expAt(d.at - 1) }, { x: toX(d.at), y: expAt(d.at) });
  }
  // The hours outside the active window (none without one), inside the week: [{ x0, x1 }]
  const rest = [];
  const a = activeHours();
  for (let k = 0; a && k <= 7; k++) {
    let cur = Math.max(midnight(k), weekStart);
    const dayEnd = Math.min(midnight(k + 1), m.w.resetsAt);
    for (const [x, y] of [...activeSpans(midnight(k), a), [dayEnd, dayEnd]]) {
      const to = Math.min(x, dayEnd);
      if (to > cur) rest.push({ x0: toX(cur), x1: to >= m.w.resetsAt ? span : toX(to) });
      cur = Math.max(cur, y);
    }
  }
  // The released reserve bends the line in its last hours: a point where the release starts
  const rw = reserveWindow(m.w.resetsAt, m.g, w);
  const relStart = rw ? rw.from : null;
  if (relStart !== null && relStart > weekStart) {
    expected.push({ x: toX(relStart), y: expAt(relStart) });
  }
  expected.sort((a, b) => a.x - b.x); // stable: the two points of a drop keep their order
  expected.push({ x: span, y: m.g.goal });
  // The reserve, between the plan's ceiling and the goal: its lower edge rises while it is released, following the
  // plan (a point wherever the slope changes)
  const relBends = relStart === null ? [] : [...bends].filter((ms) => ms > relStart && ms < m.w.resetsAt).sort((x, y) => x - y);
  const reserve = m.g.reserve
    ? [
        { x: s0, y: m.g.goal - m.g.reserve },
        ...(relStart !== null && relStart > weekStart ? [{ x: toX(relStart), y: m.g.goal - m.g.reserve }] : []),
        ...relBends.map((ms) => ({ x: toX(ms), y: planCeiling(ms, m.w.resetsAt, m.g, w) })),
        { x: span, y: planCeiling(m.w.resetsAt, m.w.resetsAt, m.g, w) },
      ]
    : null;

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
  // A stretch with drops in it (m.drops): it rises to the number before each drop, falls straight down to the one
  // after, and goes on from there to y1. Returns its points after the first, and pre: the line up to the first drop
  // (the part that can go over the day's budget; after a give-back the day is judged from the lower number).
  const dropsIn = (fromMs, toMs) => (m.drops || []).filter((d) => d.at > fromMs && d.at <= toMs);
  const withDrops = (fromMs, toMs, x0, y0, y1, ds) => {
    const pts = [];
    let y = y0;
    let a = fromMs;
    let pre = null;
    const piece = (b, ya, yb) => {
      const st = stepsFor(a, b, ya, yb);
      return st ? st.slice(1) : [{ x: toX(b), y: yb }];
    };
    for (const d of ds) {
      const top = Math.max(y, d.from);
      pts.push(...piece(d.at, y, top));
      if (!pre) pre = [{ x: x0, y: y0 }, ...pts];
      y = Math.min(d.to, top);
      a = d.at;
      pts.push({ x: toX(a), y });
    }
    pts.push(...piece(toMs, y, Math.max(y, y1)));
    return { pts, pre };
  };
  let end = 0;
  for (let i = 0; i < Math.min(todayIdx, 7); i++) {
    const rec = m.days[dayKey(midnight(i))];
    const x0 = Math.max(i, s0);
    const y0 = end;
    const ds = rec && typeof rec.endUsed === "number" ? dropsIn(Math.max(midnight(i), weekStart), midnight(i + 1)) : [];
    if (ds.length) {
      end = Math.max(rec.endUsed, 0);
      const d = withDrops(Math.max(midnight(i), weekStart), midnight(i + 1), x0, y0, end, ds);
      d.pts[d.pts.length - 1].x = i + 1;
      used.push(...d.pts);
      addOver(x0, i + 1, y0, rec.spent, rec.budget, d.pre);
      continue;
    }
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
    const todayFrom = Math.max(midnight(todayIdx), weekStart);
    const ds = dropsIn(todayFrom, m.now);
    const dropped = ds.length ? withDrops(todayFrom, m.now, Math.max(todayIdx, s0), y0, m.w.used, ds) : null;
    const steps = dropped ? null : stepsFor(todayFrom, m.now, y0, m.w.used);
    if (dropped) {
      dropped.pts[dropped.pts.length - 1].x = nowX;
      used.push(...dropped.pts);
    } else if (steps) {
      steps[steps.length - 1].x = nowX; // the line ends at the NOW marker, exactly
      used.push(...steps.slice(1));
    } else {
      used.push({ x: nowX, y: m.w.used });
    }
    // An Off day has no budget, so nothing it uses is "over" it
    if (!m.dayOff && !m.reserveMode) addOver(Math.max(todayIdx, s0), nowX, y0, m.spent, m.budget, dropped ? dropped.pre : steps);
  }

  // Where the pace so far leads: walk forward piece by piece (weightPieces), since the slope changes at every
  // midnight and at the edges of the active hours. Between two pieces (outside the window) the line stays flat.
  let proj = null;
  let lock = null;
  let endLabel = null;
  // T, the same one the level counts (core.js weekLockout), once it leaves hours locked out
  const lockAt = m.lv.lock && m.lv.lock.at !== null && m.lv.projection >= 1 ? m.lv.lock.at : null;
  if (m.w.used >= 100) {
    endLabel = { kind: "out" };
  } else if (m.lv.proj) {
    const rate = m.lv.proj.rate;
    proj = [{ x: nowX, y: m.w.used }];
    let y = m.w.used;
    const xOf = (ms) => (ms >= m.w.resetsAt ? span : toX(ms));
    // The projection walks on its own weights (the plan's, pulled toward the past weeks: learn.js)
    const pieces = m.now < m.w.resetsAt ? weightPieces(m.now, m.w.resetsAt, m.lv.proj.w) : [];
    // Lockout at or before the first piece starts (it sits at its start, or now)
    if (lockAt !== null && (!pieces.length || lockAt <= pieces[0].from)) {
      if (lockAt > m.now) proj.push({ x: toX(lockAt), y: m.g.goal });
      lock = [{ x: lockAt > m.now ? toX(lockAt) : nowX, y: m.g.goal }, { x: span, y: m.g.goal }];
      endLabel = { kind: "lock", ms: lockAt };
    }
    for (const p of endLabel ? [] : pieces) {
      if (p.from > m.now && xOf(p.from) > proj[proj.length - 1].x) proj.push({ x: xOf(p.from), y });
      if (lockAt !== null && p.to >= lockAt) {
        if (lockAt > m.now) proj.push({ x: toX(lockAt), y: m.g.goal });
        lock = [{ x: lockAt > m.now ? toX(lockAt) : nowX, y: m.g.goal }, { x: span, y: m.g.goal }];
        endLabel = { kind: "lock", ms: lockAt };
        break;
      }
      const dy = rate * pieceDays(p);
      if (dy > 0 && y + dy >= 100) {
        const ms = p.from + ((100 - y) / dy) * (p.to - p.from);
        proj.push({ x: toX(ms), y: 100 });
        endLabel = { kind: "limit", ms };
        break;
      }
      y += dy;
      proj.push({ x: xOf(p.to), y });
    }
    if (!endLabel) {
      // Flat to the reset when the window closes before it
      if (proj[proj.length - 1].x < span) proj.push({ x: span, y });
      endLabel = { kind: "reset", pct: y };
    }
  }
  const startsOut = starts.filter((ms) => ms >= weekStart && ms <= m.now && toX(ms) <= span).map((ms) => ({ ms, x: toX(ms) }));
  if (proj && proj.length < 2) proj = null; // already past 100%: nothing left to project
  const top = planCeiling(m.w.resetsAt, m.w.resetsAt, m.g);
  let room = null;
  if (!m.reserveMode && m.w.used < top && nowX < span) {
    const pEnd = endLabel && endLabel.kind === "reset" ? endLabel.pct : null;
    const mid = pEnd !== null && pEnd > m.w.used && pEnd < top ? pEnd : null;
    const spend = mid !== null ? asShownPct(m.ceiling) - asShownPct(m.lv.proj.projected) : 0;
    room = { x0: nowX, x1: span, y0: m.w.used, y1: top, mid, spend: Math.max(spend, 0) };
  }
  // The likely range at the reset, as a fan from now: { x0, x1, y0, low, high } (null with no projection or no width)
  let band = null;
  if (m.lv.proj && m.w.used < 100 && nowX < span) {
    const low = Math.min(m.lv.proj.low, 100);
    const high = Math.min(m.lv.proj.high, 100);
    if (high - low >= 1) band = { x0: nowX, x1: span, y0: m.w.used, low, high };
  }
  return { a0: toX(chartAxisStart(weekStart)), s0, span, nowX, todayIdx, rest, expected, used, over, proj, lock, band, reserve, room, goal: m.g.goal, end: endLabel, usedNow: m.w.used, starts: startsOut };
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
    endUsed: weekly,
  };
  // The week went down without a reset (Claude gave part of it back): the day's start moves down by as much, so
  // what today used counts from the lower number. Normally weekly - spent is exactly where the day started.
  if (sameWeek && dayStart.used > weekly - days[today].spent + 0.5) dayStart = { ...dayStart, used: Math.max(round2(weekly - days[today].spent), 0) };
  days[today].budget = round2(planBudget(dayStart.used, resetsAt, now, goalSettings()));
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

  // Where the reset time came from: "sync" when the account's reading brought it. Settings hides its own form then.
  const anchorVia = anchor ? via : prev.anchorVia;
  const manual = { anchor: anchorMs, anchorVia, updatedAt: now, via, weekly: { used: weekly, resetsAt }, fiveHour, dayStart, days };
  state.settings = await api.setSettings({ manual });
  await logReading({
    at: now,
    weekly,
    session: session ?? null,
    sessionResetsAt: fiveHour && session !== null && session !== undefined ? fiveHour.resetsAt : null,
  });
  render({ fresh: true });
}

// Past weeks (the "4 wk" key on the chart)
// The last n weeks before this one, as the history keeps them: where each week stood at the end of each of its days.
// x is in days from the midnight that starts that week's first day, as in paceSeries, so the weeks line up with this one.
// The reset day belongs to the new week, so a week's points are its first seven days. A first day that only has a
// reading from before its reset still holds the week before's number: when it is higher than the next day's, it is dropped.
// A week with no day recorded is left out. end is where the week finished, fullDay the day it reached 100% (or null).
// gross is what the week really used, give-backs included, and gpts its line on the same axis (it can pass 100%):
// a day adds the rise of its end, or its own use when that is more (a day Claude gave part of the week back ends
// lower, but what it used still counts). A day at 100% only adds its rise, since nothing more can be used there.
function pastWeeks(days, resetsAt, n = 4) {
  const out = [];
  for (let k = 1; k <= n; k++) {
    const start = resetsAt - (k + 1) * WEEK;
    const first = startOfDay(start);
    const d0 = new Date(first);
    const raw = [];
    for (let i = 0; i < 7; i++) {
      const ms = new Date(d0.getFullYear(), d0.getMonth(), d0.getDate() + i).getTime();
      const rec = days && days[dayKey(ms)];
      if (rec && typeof rec.endUsed === "number") raw.push({ i, ms, y: Math.min(Math.max(rec.endUsed, 0), 100), spent: Number.isFinite(rec.spent) ? rec.spent : 0 });
    }
    if (raw.length > 1 && raw[0].i === 0 && raw[0].y > raw[1].y) raw.shift();
    if (!raw.length) continue;
    const pts = [{ x: (start - first) / DAY, y: 0 }];
    const gpts = [{ ...pts[0] }];
    let end = 0;
    let fullDay = null;
    let gross = 0;
    let prev = 0;
    for (const [j, r] of raw.entries()) {
      end = Math.max(end, r.y);
      pts.push({ x: r.i + 1, y: end });
      if (fullDay === null && end >= 100) fullDay = r.ms;
      // The first day's own use can hold hours from before the reset: it only adds its rise from 0
      const rise = r.y - prev;
      gross += j === 0 || r.y >= 100 ? Math.max(rise, 0) : Math.max(rise, r.spent, 0);
      prev = r.y;
      gpts.push({ x: r.i + 1, y: gross });
    }
    out.push({ start, end, fullDay, pts, gross, gpts });
  }
  return out;
}

// Where a past week stood at x (same axis as pastWeeks): along its line, or its last point after it
function pastWeekAt(week, x) {
  const p = week.pts;
  if (x <= p[0].x) return 0;
  for (let i = 1; i < p.length; i++) {
    if (x <= p[i].x) return p[i - 1].y + ((p[i].y - p[i - 1].y) * (x - p[i - 1].x)) / (p[i].x - p[i - 1].x);
  }
  return p[p.length - 1].y;
}

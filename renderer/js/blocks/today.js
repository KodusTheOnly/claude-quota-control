// 02 Today: "how much can I use today?"
// A tank: the number is what is left of today's budget, so it starts at 100% and empties as the day is used. Past the
// budget the number is how far over it went, in red, and the bar fills red from the left.

function renderToday(m) {
  const lv = m.lv.today;
  const res = m.reserveMode; // the plan is spent: today shows what came from the reserve, not rated
  const off = m.dayOff || res; // a day off is not rated either: no budget, no level
  const ratio = off ? 0 : m.todayRatio;
  const over = !off && isOverBudget(ratio);

  // An Off day (and a day on the reserve) shows what was used today as a share of the week (a dash when nothing was)
  setNum($("tUsed"), off ? offDayNumber(m.spent) : over ? `+${r0((ratio - 1) * 100)}%` : pct(Math.max(1 - ratio, 0) * 100));
  // A dash is not a share of anything: an Off day with nothing used says so in words
  const nothing = off && !(Math.round(m.spent) > 0);
  $("tUsedWord").textContent = t(res ? "today.fromReserveWord" : nothing ? "today.nothingWord" : off ? "today.ofWeekWord" : over ? "today.overWord" : "today.leftWord");
  $("tBar").closest(".crt").classList.toggle("over", over);
  // The note under the tank, only for the days that are not rated, longest first; fitTodayHead() takes the first one that fits
  // On the reserve it says when the budget comes back, or how much of the reserve is left
  const rw = reserveWindow(m.w.resetsAt, m.g);
  const relStart = rw ? rw.from : null;
  const resNote = relStart !== null && relStart > m.now
    ? t("today.budgetReturns", { when: fmtWhen(relStart, m.now) })
    : t("today.reserveLeft", { pct: asShownPct(reserveLeft(m.w.used, m.g)) });
  todayLeftTexts = res ? [resNote, t("today.onReserve"), ""] : m.idle ? [t("today.idle"), t("day.idle"), ""] : off ? [t("today.dayOff"), t("day.off"), ""] : [""];
  // Today is a target, not a risk: the level only shows when the day runs past its budget (Tight or Pause)
  const showLevel = !off && lv !== null && lv >= 2;
  paintLevel($("tLevel"), showLevel ? lv : null);
  $("tLevel").classList.toggle("hidden", !showLevel);
  fitTodayHead();

  const bar = $("tBar");
  setLevelClass(bar, off ? null : lv);
  const past = Math.min(Math.max(ratio - 1, 0), 1) * 100;
  setBar(bar, off ? { fill: 0 } : over ? { fill: past, over: past } : { fill: Math.max(1 - ratio, 0) * 100 });
  bar.setAttribute("aria-label", t("today.barAria", { used: r0(m.spent), budget: r0(m.budget) }));
}

// The note under the tank gives way when the tile is narrow, and is gone on a normal day
let todayLeftTexts = [""];
function fitTodayHead() {
  const el = $("tLeft");
  el.classList.toggle("hidden", !todayLeftTexts[0]);
  for (const text of todayLeftTexts) {
    el.textContent = text;
    if (el.scrollWidth <= el.clientWidth + 1) return;
  }
}
new ResizeObserver(() => fitTodayHead()).observe($("tLeft"));

// 02 Today: "how much can I use today?"
// The number is the share of today's budget used, so 100% always means "the day is spent".
// The budget itself is a share of the week; it goes under the title ("budget 16% of week").

function renderToday(m) {
  const lv = m.lv.today;
  const res = m.reserveMode; // the plan is spent: today shows what came from the reserve, not rated
  const off = m.dayOff || res; // a day off is not rated either: no budget, no level
  const ratio = off ? 0 : m.todayRatio;

  // An Off day (and a day on the reserve) shows what was used today as a share of the week (a dash when nothing was)
  setNum($("tUsed"), off ? offDayNumber(m.spent) : `${r0(ratio * 100)}%`);
  $("tUsedWord").textContent = t(res ? "today.fromReserveWord" : off ? "today.ofWeekWord" : "today.usedWord");
  // The note under the title, longest first; fitTodayHead() takes the first one that fits
  // On the reserve it says when the budget comes back, or how much of the reserve is left
  const bud = t("today.budgetAt", { pct: pct(m.budget) });
  const relStart = m.g.release ? m.w.resetsAt - m.g.release * HOUR : null;
  const resNote = relStart !== null && relStart > m.now
    ? t("today.budgetReturns", { when: fmtWhen(relStart, m.now) })
    : t("today.reserveLeft", { pct: asShownPct(reserveLeft(m.w.used, m.g)) });
  todayLeftTexts = res ? [resNote, t("today.onReserve"), ""] : off ? [t("today.dayOff"), t("day.off"), ""] : [`${bud}${t("today.budgetWord")}`, bud, ""];
  // Today is a target, not a risk: the level only shows when the day runs past its budget (Tight or Pause)
  const showLevel = !off && lv !== null && lv >= 2;
  paintLevel($("tLevel"), showLevel ? lv : null);
  $("tLevel").classList.toggle("hidden", !showLevel);
  fitTodayHead();

  const bar = $("tBar");
  setLevelClass(bar, off ? null : lv);
  budgetBar(bar, ratio);
  // The part of the budget that earlier days left behind, hatched: from the plan's own share of today to the budget mark
  const carried = off || !(m.budget > 0) ? 0 : Math.max(m.budget - m.planToday, 0);
  const scale = 100 / OVER_SCALE; // where the budget mark sits on the bar
  bar.style.setProperty("--cf-l", `${((m.budget - carried) / (m.budget || 1)) * scale}%`);
  bar.style.setProperty("--cf-w", `${carried > 0.5 ? (carried / m.budget) * scale : 0}%`);
  bar.setAttribute("aria-label", t("today.barAria", { used: r0(m.spent), budget: r0(m.budget) }));
}

// The note under the title gives way when the tile is narrow: "budget 14% of week", then "budget 14%", then nothing
let todayLeftTexts = [""];
function fitTodayHead() {
  const el = $("tLeft");
  for (const text of todayLeftTexts) {
    el.textContent = text;
    if (el.scrollWidth <= el.clientWidth + 1) return;
  }
}
new ResizeObserver(() => fitTodayHead()).observe($("tLeft"));


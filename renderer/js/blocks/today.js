// 02 Today: "how much can I use today?"
// Numbers are shares of today's budget (25% left, 75% used), so 100% always means "the day is spent".
// The budget itself is a share of the week; it shows up as detail ("16% of the week").

function renderToday(m) {
  const lv = m.lv.today;
  const off = m.budget <= 0 && m.spent <= 0; // a day off with nothing used
  const ratio = off ? 0 : m.todayRatio;
  const left = Math.max(1 - ratio, 0) * 100;

  $("tUsed").textContent = off ? "–" : `${r0(ratio * 100)}%`;
  $("tUsedWord").classList.toggle("hidden", off);
  // Longest first; fitTodayHead() takes the first one that leaves the level whole
  todayLeftTexts = off ? [t("day.off"), ""] : [t("today.left", { pct: r0(left) }), `${r0(left)}%`, ""];
  paintLevel($("tLevel"), off ? null : lv);
  $("tWo").textContent = off || lv === null || !isOverBudget(ratio) ? "" : t("day.over"); // only said when it matters; the level and the bar already show "within"
  fitTodayHead();

  const bar = $("tBar");
  setLevelClass(bar, off ? null : lv);
  budgetBar(bar, ratio);
  bar.setAttribute("aria-label", t("today.barAria", { used: r0(m.spent), budget: r0(m.budget) }));
  // The budget, written under the white mark: "▲ 14% of week" (the words go when the block is narrow)
  const bl = $("tBl");
  setBarLabel(bl, off ? "" : t("today.budgetAt", { pct: pct(m.budget) }), t("today.budgetWord"));

  // The line under the bar: what is left of today's budget as a share of the week, and where the week's use would stand then
  const weekLeft = Math.max(1 - ratio, 0) * m.budget;
  const showStop = !off && m.budget > 0 && ratio < 1 && asShownPct(weekLeft) > 0;
  todayStopText = showStop ? t("today.stopNear", { left: asShownPct(weekLeft), stop: asShownPct(m.w.used + weekLeft) }) : "";
  fitTodayStop();
}

// The header line must keep the level badge whole. When the line is too long, "51% left" gives way first:
// it becomes "51%", then goes (the big number and the bar still say it). The level word is never cut.
let todayLeftTexts = [""];
function fitTodayHead() {
  const th = $("tLevel").parentElement;
  for (const text of todayLeftTexts) {
    $("tLeft").textContent = text;
    if (th.scrollWidth <= th.clientWidth + 1) return;
  }
}
new ResizeObserver(() => fitTodayHead()).observe($("tLevel").parentElement);

// The line under the bar is dropped whole when the tile is too narrow for it
let todayStopText = "";
function fitTodayStop() {
  const el = $("tStop");
  setText(el, todayStopText);
  if (el.scrollWidth > el.clientWidth + 1) setText(el, "");
}
new ResizeObserver(() => fitTodayStop()).observe($("tStop"));

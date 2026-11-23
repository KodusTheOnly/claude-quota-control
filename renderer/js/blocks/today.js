// 02 Today: "how much can I use today?"
// Not a block of its own: today lives on the week. The week bar is dimmer up to where the week stood when the day began,
// and a white mark stands where the week can go today (that point plus today's budget). The chart draws the same limit
// across today's column. Under the bar, a line says it in words ("up to 45% · 5% left"), how far past it the week
// went, or why the day is not rated (a day off, no active hours left, the plan spent and the reserve in use).

// Where the week can go today, in % of the week, or null on a day that is not rated
function todayLimit(m) {
  if (m.dayOff || m.reserveMode) return null;
  return Math.min(m.usedStart + m.budget, m.g.goal);
}

// A sentence with its values in bold: the template's {name} parts become <b>
function boldLine(el, key, values) {
  const marks = Object.fromEntries(Object.keys(values).map((k, i) => [k, `\u0001${i}\u0001`]));
  const list = Object.values(values);
  el.replaceChildren(...t(key, marks).split("\u0001").map((part, i) => (i % 2 ? node("b", "", list[Number(part)]) : part)));
}

function renderToday(m) {
  const lv = m.lv.today;
  const limit = todayLimit(m);
  const over = limit !== null && isOverBudget(m.todayRatio);
  const line = $("tLine");
  const text = $("tText");
  line.classList.toggle("over", over);

  if (limit === null) {
    // On the reserve it says when the budget comes back, or how much of the reserve is left
    const rw = reserveWindow(m.w.resetsAt, m.g);
    const relStart = rw ? rw.from : null;
    text.textContent = m.reserveMode
      ? relStart !== null && relStart > m.now
        ? t("today.budgetReturns", { when: fmtWhen(relStart, m.now) })
        : t("today.reserveLeft", { pct: asShownPct(reserveLeft(m.w.used, m.g)) })
      : m.idle ? t("today.idle") : t("today.dayOff");
  } else if (over) boldLine(text, "today.lineOver", { over: `${r0(m.w.used - limit)}%`, to: `${r0(limit)}%` });
  else boldLine(text, "today.line", { to: `${r0(limit)}%`, left: `${r0(Math.max(limit - m.w.used, 0))}%` });

  // Today is a target, not a risk: the level only shows when the day runs past its budget (Tight or Pause)
  const showLevel = limit !== null && lv !== null && lv >= 2;
  paintLevel($("tLevel"), showLevel ? lv : null);
  $("tLevel").classList.toggle("hidden", !showLevel);
  const detail = limit === null ? text.textContent : t("today.barAria", { used: r0(m.spent), budget: r0(m.budget) });
  setTip(line, limit === null ? "plain" : over ? "todayover" : "today", detail, over);
}

// The week bar's part: the use before today dimmer, and the white mark at today's limit
function paintTodayMark(bar, m) {
  bar.style.setProperty("--pd", `${clamp100(Math.min(m.usedStart, m.w.used))}%`);
  const limit = todayLimit(m);
  const tick = bar.querySelector(".tick");
  tick.classList.toggle("hidden", limit === null);
  if (limit !== null) bar.style.setProperty("--tx", `${clamp100(limit)}%`);
}

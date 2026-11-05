// Week: "how is the week going, and what is the plan?"
// The pace chart with the hours and the seven days under it (each day is a button: click it to plan that day),
// and the week's total with its bar, up in the band.

const DAYS = []; // one entry per day button, built once
const PLAN_ORDER = [1, 0.5, 2, 0]; // Normal, Light, Heavy, Off

function dayLabel(ms) {
  const date = new Date(ms);
  return { nm: shortWeekday(date), date: date.toLocaleDateString(I18N.locale(), { month: "short", day: "numeric" }) };
}

// The footer of the graph: seven equal columns, one per calendar day, each exactly under its part of the chart.
// A column has four rows: name and date, the day's % and its tag, the level (or why there is none), the budget bar.
// The week starts mid-day (at the reset) and ends a little after the seventh day: the chart and the hours show the seven
// calendar days only; the rest of the last day still counts in the week's total.
function buildDays() {
  const box = $("days");
  if (box.firstChild) return;
  for (let i = 0; i < 7; i++) {
    const b = node("button", "day");
    b.type = "button";
    const nm = node("span", "nm");
    const nameB = node("b");
    const date = node("i", "dt");
    nm.append(nameB, date);
    const pr = node("span", "pr");
    const num = node("span", "nu");
    const tag = node("i", "tg");
    pr.append(num, tag);
    const lv = node("span", "lv lv-none");
    lv.append(node("span", "shp"), node("span", "lvn"));
    const sx = node("span", "sx");
    const bg = node("span", "bg");
    const bar = node("span", "sbar");
    const tr = node("div", "tr");
    tr.append(node("i", "fill"), node("i", "ov"));
    bar.append(tr, node("b", "tick"));
    const bud = node("span", "bd");
    bg.append(bar, bud);
    b.append(nm, pr, lv, sx, bg);
    // Days that already passed are a record, not a plan: only today and the days ahead open the plan menu
    b.addEventListener("click", () => {
      if (lastM && lastM.week[i].when !== "past") openPlanMenu(i, b);
    });
    box.appendChild(b);
    DAYS.push({ b, nameB, date, num, tag, lv, sx, bg, bar, bud });
  }
}

// The plan in one line: "Normal ×5 · Light ×2"
function planSummary(m) {
  const counts = {};
  for (const d of m.week) counts[d.name] = (counts[d.name] || 0) + 1;
  return PLAN_ORDER.map((wt) => WEIGHT_NAME[wt]).filter((n) => counts[n]).map((n) => `${t(`plan.${n}`)} ×${counts[n]}`);
}

function renderWeek(m) {
  buildDays();
  const level = verdictLevel(m);
  $("wUsed").textContent = `${r0(m.w.used)}%`;
  $("wUsedWord").textContent = t("week.usedLong");
  paintLevel($("wLevel"), level);
  const wBar = $("wBar");
  setLevelClass(wBar, level);
  setBar(wBar, { fill: m.w.used, tick: clamp100(m.lv.expected) });
  wBar.setAttribute("aria-label", t("week.barAria", { used: r0(m.w.used), expected: r0(m.lv.expected) }));
  // The white mark, labeled as in Session and Today: "▲ 37% expected" (the word goes when the half is narrow)
  setBarLabel($("wBl"), pct(m.lv.expected), t("week.expectedWord"));

  renderPaceChart(m);
  $("paceLeg").replaceChildren(
    ...[["chart.legUsed", "var(--free)", ""], ["chart.legExpected", CHART_WHITE, ""], ["chart.legOver", CHART_RED, ""], ["chart.legProj", "var(--free)", "dashed"], ["chart.legEst", "var(--free)", "dotted"], ["chart.legStart", CHART_MUTED, "tick"]].map(([key, color, style]) => {
      const item = node("span");
      const line = node("i");
      line.style.borderTopColor = key === "chart.legUsed" || key === "chart.legProj" || key === "chart.legEst" ? cssVar(`--${["free", "moderate", "tight", "pause"][m.lv.week ?? 0]}`) : color;
      if (style === "tick") Object.assign(line.style, { width: "0", height: "1em", borderTop: "0", borderLeft: `2px solid ${CHART_MUTED}`, marginRight: ".7em" }); // a short vertical tick, as on the chart
      else if (style) line.style.borderTopStyle = style;
      item.append(line, t(key));
      return item;
    })
  );
  $("planSum").textContent = planSummary(m).join(" · ");
  $("planSum").title = t("plan.label");
  $("wResets").textContent = t("chart.resets", { when: `${shortWeekday(new Date(m.w.resetsAt))} ${fmtTime(m.w.resetsAt)}` });

  m.week.forEach((d, i) => {
    const r = DAYS[i];
    const { nm, date } = dayLabel(d.ms);
    const known = d.ratio !== null && (d.kind === "past" || d.kind === "today");
    // A day with a reading shows its level color; a planned or off day is dimmer
    r.b.className = `day ${known ? "live" : "idle"}${d.isToday ? " today" : ""}${d.when === "past" ? " locked" : ""}`;
    setLevelClass(r.b, known ? d.level : null);
    r.nameB.textContent = nm;
    r.date.textContent = date;
    r.tag.textContent = d.isToday ? t("day.today") : i === 0 ? t("day.reset") : "";
    r.tag.classList.toggle("hidden", !r.tag.textContent);
    r.num.textContent = known ? `${r0(d.ratio * 100)}%` : "–";
    // Row three: the level, or why there is none
    const stateKey = d.kind === "off" ? "day.off" : d.kind === "future" ? `plan.${d.name}` : "day.noData";
    r.lv.classList.toggle("hidden", !known);
    if (known) paintLevel(r.lv, d.level);
    r.sx.textContent = known ? "" : t(stateKey);
    r.sx.classList.toggle("hidden", known);
    // Row four: the day's budget bar (the white mark is the budget) and the budget itself
    r.bg.classList.toggle("hidden", !d.budget);
    setLevelClass(r.bar, known ? d.level : null);
    budgetBar(r.bar, known ? d.ratio : 0);
    r.bud.textContent = d.budget ? `▲${r0(d.budget)}%` : "";
    if (d.when === "past") {
      r.b.setAttribute("aria-disabled", "true");
      r.b.removeAttribute("aria-haspopup");
    } else {
      r.b.removeAttribute("aria-disabled");
      r.b.setAttribute("aria-haspopup", "dialog");
    }
    const status = known ? `${lvName(d.level)}, ${t(isOverBudget(d.ratio) ? "day.over" : "day.within")}` : d.kind === "off" ? t("day.off") : d.kind === "future" ? t(`plan.${d.name}`) : t("day.noData");
    r.b.title = i === 0 ? `${t("day.reset")} ${fmtTime(m.w.resetsAt)}` : "";
    r.b.setAttribute("aria-label", `${nm} ${date}, ${t(`plan.${d.name}`)}, ${known ? `${r0(d.ratio * 100)}%` : "–"}, ${status}${i === 0 ? `, ${t("day.reset")} ${fmtTime(m.w.resetsAt)}` : ""}${d.budget ? `, ${t("day.budgetAria", { pct: r0(d.budget) })}` : ""}${d.isToday ? `, ${t("day.today")}` : ""}`);
    r.b.title = r.b.getAttribute("aria-label"); // the narrow columns hide the date and the level word; hover shows them
  });

  // The frame around today runs from the top of the chart down through the hours and the day column
  const todayIdx = m.week.findIndex((d) => d.isToday);
  $("todayBox").classList.toggle("hidden", todayIdx < 0);
  if (todayIdx >= 0) $("todayBox").style.setProperty("--ti", todayIdx);
}

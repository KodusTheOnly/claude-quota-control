// Week: "how is the week going, and what is the plan?"
// The pace chart with the hours and the seven days under it (each day is a button: click it to plan that day),
// and the week's total with its bar, up in the band.

const DAYS = []; // one entry per day button, built once
const PLAN_ORDER = [1, 0.5, 2, 0]; // Normal, Light, Heavy, Off

function dayLabel(ms) {
  const date = new Date(ms);
  const locale = I18N.locale();
  return { nm: shortWeekday(date), date: date.toLocaleDateString(locale, { month: "short", day: "numeric" }), dayNum: date.toLocaleDateString(locale, { day: "numeric" }) };
}

// The footer of the graph: seven columns, one per calendar day (the first one narrower: it starts at the reset), each exactly under its part of the chart.
// A column has three rows: name and date, the day's % with its level shape and its tag, the budget bar.
// A day with no reading says why (no data, off, a plan other than Normal) between the % and the bar.
// A day ahead has nothing to measure yet: no %, no bar. It shows its budget and where the week should stand at its end.
// The week starts mid-day (at the reset) and ends a little after the seventh day: the chart and the hours run on to the
// reset, and the days leave that last stretch empty.
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
    const lv = node("span", "lv lv-none");
    lv.append(node("span", "shp"), node("span", "lvn"));
    pr.append(num, lv, tag);
    const sx = node("span", "sx");
    const bg = node("span", "bg");
    const bar = node("span", "sbar");
    const tr = node("div", "tr");
    tr.append(node("i", "fill"), node("i", "ov"));
    bar.append(tr, node("b", "tick"));
    const bud = node("span", "bd");
    bg.append(bar, bud);
    const wt = node("span", "wt");
    b.append(nm, pr, sx, bg, wt);
    // Days that already passed are a record, not a plan: only today and the days ahead open the plan menu
    b.addEventListener("click", () => {
      if (lastM && lastM.week[i].when !== "past") openPlanMenu(i, b);
    });
    box.appendChild(b);
    DAYS.push({ b, nameB, date, num, tag, lv, sx, bg, bar, bud, wt });
  }
}

// The plan in one line: "Normal ×5 · Light ×2"
function planSummary(m) {
  const counts = {};
  for (const d of m.week) counts[d.name] = (counts[d.name] || 0) + 1;
  return PLAN_ORDER.map((wt) => WEIGHT_NAME[wt]).filter((n) => counts[n]).map((n) => `${t(`plan.${n}`)} ×${counts[n]}`);
}

// The zones on the week bar: the reserve still held (from the plan's ceiling to the goal) and the part of the use
// that came from the reserve. A bar with no reserve has none.
function paintWeekZones(bar, m) {
  const goal = m.g.goal;
  const ceiling = Math.min(m.ceiling, goal);
  const fromReserve = m.g.reserve ? Math.max(Math.min(m.w.used, goal) - Math.max(ceiling, goal - m.g.reserve, 0), 0) : 0;
  const rfFrom = Math.min(m.w.used, goal) - fromReserve;
  bar.style.setProperty("--rz-l", `${clamp100(ceiling)}%`);
  bar.style.setProperty("--rz-w", `${clamp100(goal - ceiling)}%`);
  bar.style.setProperty("--rf-l", `${clamp100(rfFrom)}%`);
  bar.style.setProperty("--rf-w", `${clamp100(fromReserve)}%`);
}

function renderWeek(m) {
  buildDays();
  const level = verdictLevel(m);
  setNum($("wUsed"), `${r0(m.w.used)}%`);
  $("wUsedWord").textContent = t("week.usedLong");
  paintLevel($("wLevel"), level);
  const wBar = $("wBar");
  // The bar and the chart's projection take the week's level, or the accent on the last day with room (the used line
  // takes each day's level)
  if (m.endRoom) {
    wBar.classList.remove(...LEVEL_CLASSES);
    wBar.classList.add("lv-room");
  } else setLevelClass(wBar, m.lv.week);
  paintWeekZones(wBar, m);
  if (m.reserveMode) {
    // On the reserve the white mark is the plan's ceiling: "▲ 87% plan"
    setBar(wBar, { fill: m.w.used, tick: clamp100(m.ceiling) });
    wBar.setAttribute("aria-label", t("week.barAriaReserve", { used: r0(m.w.used), left: r0(reserveLeft(m.w.used, m.g)) }));
    setBarLabel($("wBl"), pct(m.ceiling), t("week.planWord"));
  } else {
    setBar(wBar, { fill: m.w.used, tick: clamp100(m.lv.expected) });
    wBar.setAttribute("aria-label", t("week.barAria", { used: r0(m.w.used), expected: r0(m.lv.expected) }));
    // The white mark, labeled as in Session and Today: "▲ 37% expected" (the word goes when the half is narrow)
    setBarLabel($("wBl"), pct(m.lv.expected), t("week.expectedWord"));
  }

  // The projection, hatched like the chart's dashed line: from what is used to where the week ends (at most the goal)
  const projTo = m.lv.proj && !m.reserveMode ? Math.min(clamp100(m.lv.proj.projected), m.g.goal) : null;
  wBar.style.setProperty("--pj-l", `${clamp100(m.w.used)}%`);
  wBar.style.setProperty("--pj-w", projTo === null ? "0%" : `${Math.max(projTo - clamp100(m.w.used), 0)}%`);
  renderPaceGauge(m);

  renderPaceChart(m);
  const s = chartInput.series;
  // The room left before the reset, outlined on the bar too: from what is used to the plan's ceiling at the reset
  wBar.style.setProperty("--rm-l", `${clamp100(m.w.used)}%`);
  wBar.style.setProperty("--rm-w", s.room ? `${clamp100(s.room.y1) - clamp100(s.room.y0)}%` : "0%");
  // The axis runs from a0 (the reset, or earlier when it is late in the day) to the next reset, in days. The first day's
  // column holds only its part on the axis, and the days leave the stretch after the seventh midnight empty, as the chart does.
  const gridBox = $("days").parentElement;
  gridBox.style.setProperty("--ax", Math.max(s.span - s.a0, 1).toFixed(3));
  gridBox.style.setProperty("--dw", (Math.min(s.span, 7) - s.a0).toFixed(3));
  $("days").style.gridTemplateColumns = `minmax(0, ${(1 - s.a0).toFixed(3)}fr) repeat(6, minmax(0, 1fr))`;
  // The legend only explains what the chart shows this week and does not name on its own: the used, expected and
  // projection lines carry their names, and the goal is the top of the scale (100%)
  const weekColor = m.endRoom ? cssVar("--crt-accent") : cssVar(`--${["free", "moderate", "tight", "pause"][m.lv.week ?? 0]}`);
  const legMuted = cssVar("--sm") || CHART_MUTED;
  const legRed = cssVar("--pause") || CHART_RED;
  const legend = [
    ...(s.over.length ? [["chart.legOver", legRed, ""]] : []),
    ...(s.used.some((p) => p.est) ? [["chart.legEst", weekColor, "dotted"]] : []),
    ...(s.reserve ? [["chart.legReserve", cssVar("--crt-accent"), ""]] : []),
    ...(s.starts.length ? [["chart.legStart", legMuted, "tick"]] : []),
    ...(activeHours() ? [["chart.legActive", cssVar("--crt-accent"), "active"]] : []),
  ];
  $("paceLeg").replaceChildren(
    ...legend.map(([key, color, style]) => {
      const item = node("span");
      const line = node("i");
      line.style.borderTopColor = color;
      if (style === "tick") Object.assign(line.style, { width: "0", height: "1em", borderTop: "0", borderLeft: `2px solid ${legMuted}`, marginRight: ".7em" }); // a short vertical tick, as on the chart
      else if (style === "active") Object.assign(line.style, { borderTopWidth: "3px", opacity: ".75" }); // the bar under the HRS strip
      else if (style) line.style.borderTopStyle = style;
      item.append(line, t(key));
      return item;
    })
  );
  $("planSum").textContent = planSummary(m).join(" · ");
  $("planSum").title = t("plan.label");
  $("wResets").textContent = t("chart.resets", { when: `${shortWeekday(new Date(m.w.resetsAt))} ${fmtTime(m.w.resetsAt)}` });

  // Where the week should stand at the end of each day ahead: today ending on its budget (or where it already is, when
  // that is more), then each day ahead spending its own budget
  let weekTo = Math.max(m.w.used, m.usedStart + (m.budget || 0));
  m.week.forEach((d, i) => {
    const r = DAYS[i];
    const { nm, date, dayNum } = dayLabel(d.ms);
    const ahead = d.when === "future";
    const known = d.ratio !== null && (d.kind === "past" || d.kind === "today");
    // A day with a reading shows its level color; a planned or off day is dimmer
    // A day ahead on the Normal plan shows only its bar: the footer already says "Normal ×N"
    const plain = !known && !d.isToday && d.kind === "future" && d.name === "normal";
    r.b.className = `day ${known ? "live" : "idle"}${d.isToday ? " today" : ""}${d.when === "past" ? " locked" : ""}${plain ? " plain" : ""}${ahead ? " ahead" : ""}`;
    setLevelClass(r.b, known ? d.level : null);
    r.nameB.textContent = nm;
    r.date.textContent = ahead ? dayNum : date; // the month is already on the days before it
    // The reset is the chart's left edge now, so the first day needs no tag for it (its title and label still say it)
    r.tag.textContent = d.isToday ? t("day.today") : "";
    r.tag.classList.toggle("hidden", !r.tag.textContent);
    // Today off: no ratio, so the number is what was used (a share of the week); other days off keep the dash
    const onReserve = d.isToday && m.reserveMode; // today on the reserve: what was used, as on an Off day
    const shownNum = known ? `${r0(d.ratio * 100)}%` : (d.kind === "off" || onReserve) && d.isToday ? offDayNumber(d.spent) : "–";
    r.num.textContent = shownNum;
    // The level shape next to the %, or why there is none
    const stateKey = onReserve ? "day.reserve" : d.kind === "off" ? "day.off" : d.kind === "future" ? `plan.${d.name}` : "day.noData";
    r.lv.classList.toggle("hidden", !known);
    if (known) paintLevel(r.lv, d.level);
    r.sx.textContent = known || plain ? "" : t(stateKey);
    r.sx.classList.toggle("hidden", known || plain);
    // The day's budget bar (the white mark is the budget). A past day's figures, "9% of 17%", are only in its title and
    // label: the % and the bar already show them. Today and a planned day say the budget they have, "▲14%" (the wide
    // week adds the word "budget"); a plain Normal day ahead says nothing. All are % of the week.
    const fig = d.when === "past" ? pastDayFigures(d) : null;
    let figPhrase = "";
    r.bg.classList.toggle("hidden", fig ? false : !d.budget);
    r.bar.classList.toggle("hidden", Boolean(fig) && fig.budget === null); // no budget recorded: nothing to measure the bar against
    setLevelClass(r.bar, known ? d.level : null);
    budgetBar(r.bar, known ? d.ratio : 0);
    if (fig) {
      figPhrase = fig.budget === null ? t("day.usedOnlyAria", { used: fig.used }) : t("day.budgetUsedAria", { budget: fig.budget, used: fig.used });
      r.bud.replaceChildren();
    } else {
      r.bud.replaceChildren();
      if (d.budget) r.bud.append("▲", node("i", "bdw", ` ${t("day.budgetWord")} `), `${r0(d.budget)}%`);
    }
    let weekPhrase = "";
    if (ahead && d.budget > 0) {
      weekTo = Math.min(weekTo + d.budget, 100);
      r.wt.replaceChildren(node("i", "wtw", `${t("day.weekWord")} `), `→ ${r0(weekTo)}%`);
      weekPhrase = `, ${t("day.weekToAria", { pct: r0(weekTo) })}`;
    } else r.wt.replaceChildren();
    r.wt.classList.toggle("hidden", !weekPhrase);
    if (d.when === "past") {
      r.b.setAttribute("aria-disabled", "true");
      r.b.removeAttribute("aria-haspopup");
    } else {
      r.b.removeAttribute("aria-disabled");
      r.b.setAttribute("aria-haspopup", "dialog");
    }
    const status = known ? `${lvName(d.level)}, ${t(isOverBudget(d.ratio) ? "day.over" : "day.within")}` : d.kind === "off" ? t("day.off") : d.kind === "future" ? t(`plan.${d.name}`) : t("day.noData");
    r.b.title = i === 0 ? `${t("day.reset")} ${fmtTime(m.w.resetsAt)}` : "";
    r.b.setAttribute("aria-label", `${nm} ${date}, ${t(`plan.${d.name}`)}, ${shownNum}, ${status}${i === 0 ? `, ${t("day.reset")} ${fmtTime(m.w.resetsAt)}` : ""}${fig ? `, ${figPhrase}` : d.budget ? `, ${t("day.budgetAria", { pct: r0(d.budget) })}` : ""}${weekPhrase}${d.isToday ? `, ${t("day.today")}` : ""}`);
    r.b.title = r.b.getAttribute("aria-label"); // the narrow columns hide the date and the level word; hover shows them
  });

  // The frame around today runs from the top of the chart down through the hours and the day column
  const todayIdx = m.week.findIndex((d) => d.isToday);
  $("todayBox").classList.toggle("hidden", todayIdx < 0);
  if (todayIdx >= 0) {
    // Where today's column starts on the axis and how wide it is, in days (the first day starts where the axis does)
    $("todayBox").style.setProperty("--tl", (Math.max(todayIdx, s.a0) - s.a0).toFixed(3));
    $("todayBox").style.setProperty("--tw", (Math.min(todayIdx + 1, s.span) - Math.max(todayIdx, s.a0)).toFixed(3));
  }
}

// The pace: what the week is doing per day against what still fits, in three named zones. Slow under 85% of what fits,
// on pace up to 110%, fast above. The lit zone says where the pace is, the needle where in that zone; the numbers are in the title.
const PACE_ZONES = ["pace.slow", "pace.ok", "pace.fast"];
// The zone the pace is in (0 slow, 1 on pace, 2 fast), or null when there is no pace to show. The verdict's face takes
// its energy from it.
function paceZone(m) {
  const need = m.lv.need;
  const doing = m.lv.doing;
  if (!(need !== null && need > 0 && doing !== null && !m.reserveMode)) return null;
  const r = doing / need;
  return r < 0.85 ? 0 : r < 1.1 ? 1 : 2;
}
function renderPaceGauge(m) {
  const g = $("pGauge");
  const zone = paceZone(m);
  const show = zone !== null;
  g.classList.toggle("hidden", !show);
  g.classList.toggle("end", Boolean(m.endRoom));
  $("pLab").classList.toggle("hidden", !show);
  if (!show) return;
  const need = m.lv.need;
  const doing = m.lv.doing;
  const r = doing / need;
  const f = zone === 0 ? r / 0.85 : zone === 1 ? (r - 0.85) / 0.25 : Math.min((r - 1.1) / 0.9, 1);
  const zones = [...g.querySelectorAll(".z")];
  zones.forEach((z, i) => z.classList.toggle("on", i === zone));
  zones[zone].append(g.querySelector(".ndl")); // the needle sits inside its zone, so the zones can be of any width
  g.style.setProperty("--nx", `${Math.min(Math.max(f * 100, 4), 96)}%`);
  g.title = t("pace.title", { doing: r0(doing), need: r0(need) });
  g.setAttribute("aria-label", `${t("pace.label")}: ${t(PACE_ZONES[zone])}. ${g.title}`);
  fitGauge();
}

// The zone names give way when the week half is narrow: all three, then only the lit one (its zone grows to hold it), then none
function fitGauge() {
  const g = $("pGauge");
  if (g.classList.contains("hidden")) return;
  const over = () => g.scrollWidth > g.clientWidth + 1 || [...g.querySelectorAll(".z")].some((z) => z.scrollWidth > z.clientWidth + 1);
  g.classList.remove("solo", "mute");
  if (!over()) return;
  g.classList.add("solo");
  if (over()) g.classList.replace("solo", "mute");
}
new ResizeObserver(() => fitGauge()).observe($("wScr"));

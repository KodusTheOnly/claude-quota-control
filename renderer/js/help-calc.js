// Help: "How we calculate". The cutoffs, the plan weights and the 95% rule are read from the same
// constants the numbers use (core.js), so this page cannot say one thing while the app does another.

// How far past the last week cutoff the ruler goes, so the Pause stretch has some room
const RATIO_RULER_PAST = 0.2;

// A ruler on the CRT: one stretch per level, sized by its cutoffs, with the cutoffs written under it.
// It repeats what the table says, so assistive technology skips it.
function levelScale(parent, label, cuts, end, fmt) {
  const name = node("div", "scale-name", label);
  const bar = node("div", "scale");
  const ticks = node("div", "scale-ticks");
  for (const part of [name, bar, ticks]) part.setAttribute("aria-hidden", "true");
  for (let lv = 0; lv < LEVEL_KEYS.length; lv++) {
    const from = lv === 0 ? 0 : cuts[lv - 1];
    const to = lv < cuts.length ? cuts[lv] : end;
    const stretch = node("i");
    stretch.style.flex = String(to - from);
    setLevelClass(stretch, lv);
    stretch.appendChild(node("span", "shp"));
    bar.appendChild(stretch);
  }
  for (const cut of cuts) {
    const tick = node("span", "", fmt(cut));
    tick.style.left = `${(cut / end) * 100}%`;
    ticks.appendChild(tick);
  }
  parent.append(name, bar, ticks);
}

function renderHelpCalc() {
  const body = $("helpCalcBody");
  if (!body) return;
  body.textContent = "";
  body.appendChild(node("p", "intro", t("calc.intro")));

  const fmtRatio = (n) => fmtNum(n, 1, 1);
  const fmtPct = (n) => `${fmtNum(n)}%`;
  // Free, Moderate and Tight go "up to" their cutoff; Pause is everything above the last one
  const cut = (i, cuts, fmt) => t(i < cuts.length ? "calc.upTo" : "calc.above", { n: fmt(cuts[Math.min(i, cuts.length - 1)]) });

  // The level ladder, on a CRT like the numbers it explains
  const ladder = node("div", "crt ladder");
  const table = node("table", "calc-table");
  table.appendChild(node("caption", "sr-only", t("calc.levels")));
  const head = node("tr");
  for (const key of ["calc.col.level", "calc.col.session", "calc.col.ratio"]) {
    const th = node("th", "", t(key));
    th.scope = "col";
    head.appendChild(th);
  }
  table.appendChild(node("thead")).appendChild(head);
  const tbody = node("tbody");
  for (let lv = 0; lv < LEVEL_KEYS.length; lv++) {
    const tr = node("tr");
    const th = node("th");
    th.scope = "row";
    const mark = node("span", "lv");
    mark.append(node("span", "shp"), node("span", "lvn"));
    paintLevel(mark, lv);
    th.appendChild(mark);
    tr.append(th, node("td", "", cut(lv, SESSION_CUTS, fmtPct)), node("td", "", cut(lv, RATIO_CUTS, fmtRatio)));
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  ladder.appendChild(table);
  levelScale(ladder, t("calc.col.session"), SESSION_CUTS, 100, fmtPct);
  levelScale(ladder, t("calc.col.ratio"), RATIO_CUTS, RATIO_CUTS[RATIO_CUTS.length - 1] + RATIO_RULER_PAST, fmtRatio);
  // The projection has a scale of its own (see PROJECTION_CUTS in core.js), shown as % of the weekly limit
  const fmtProj = (n) => fmtPct(n * 100);
  levelScale(ladder, t("calc.col.proj"), PROJECTION_CUTS, PROJECTION_CUTS[PROJECTION_CUTS.length - 1] + RATIO_RULER_PAST, fmtProj);
  ladder.appendChild(node("p", "edge", t("calc.edge", { ratio: fmtRatio(RATIO_CUTS[0]), pct: fmtPct(SESSION_CUTS[0]) })));
  // Why the edge goes up: Free means quota would go to waste, so what is left at the first cutoff already asks to ease up
  ladder.appendChild(node("p", "edge", t("calc.edgeProj", { a: fmtProj(PROJECTION_CUTS[0]), left: fmtPct(100 - PROJECTION_CUTS[0] * 100) })));
  body.appendChild(ladder);

  // What a plan day weighs, from the weights the plan really uses: Off 0, Light 0.5, Normal 1, Heavy 2
  const weights = Object.entries(WEIGHT_NAME)
    .map(([w, name]) => [Number(w), name])
    .sort((a, b) => a[0] - b[0])
    .map(([w, name]) => `${t(name === "off" ? "day.off" : `plan.${name}`)} ${fmtNum(w)}`)
    .join("; ");

  const dl = node("dl", "rules");
  const add = (key, params) => {
    const row = node("div", "ent");
    row.append(node("dt", "", t(`calc.${key}.t`)), node("dd", "", t(`calc.${key}.d`, params)));
    dl.appendChild(row);
  };
  add("session");
  add("expected", { weights });
  add("budget");
  add("proj", { weekPause: WEEK_PAUSE_AT, days: fmtNum(MIN_WEIGHTED_DAYS), ...projectionCutoffs() });
  add("red");
  add("round");
  body.appendChild(dl);

  // Straight to the same rules, with the person's own numbers
  const cta = node("button", "key primary", t("calc.cta"));
  cta.type = "button";
  cta.classList.toggle("hidden", !lastM);
  cta.addEventListener("click", () => {
    $("helpDrawer").close(); // the topic goes back to its place, then the Overview opens
    go("panel");
    openMath("verdict");
  });
  const actions = node("div", "hero-cta");
  actions.appendChild(cta);
  body.appendChild(actions);
}

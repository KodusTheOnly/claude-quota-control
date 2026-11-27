// Past weeks: one setting (the "4 wk" key in the chart's footer, pastWeeks in the settings). They are drawn as faint
// dashed lines in the week chart (pace-chart.js).

const PAST_N = 4;
let pastData = []; // pastWeeks() of the last render

function pastOn() {
  return Boolean(state.settings && state.settings.pastWeeks) && pastData.length > 0;
}

function renderPast(m) {
  pastData = pastWeeks(m.days, m.w.resetsAt, PAST_N);
  const key = $("pastKey");
  $("pastKeyText").textContent = t("past.key", { n: PAST_N });
  key.disabled = !pastData.length;
  key.setAttribute("aria-pressed", String(pastOn()));
  setTip(key, "plain", pastData.length ? t("past.keyTitle", { n: PAST_N }) : t("past.keyNone"));
}
$("pastKey").addEventListener("click", () => saveSetting({ pastWeeks: !(state.settings && state.settings.pastWeeks) }));

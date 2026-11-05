// Overview: draws the blocks, the optional Extra block and everything that opens over them.
// One function per block lives in js/blocks/. The numbers come from compute().

let lastM = null; // the last numbers drawn, for the things that open on a click

// The summary line the vertical format keeps at the top while the page scrolls
function renderSummary(m) {
  paintLevel($("sumLevel"), m.head.level, m.head.name);
  $("sumLeft").textContent = t("sum.left", { pct: r0(m.budget > 0 ? Math.max(1 - m.todayRatio, 0) * 100 : 0) });
  $("sumProj").textContent = m.lv.proj ? t("sum.projected", { pct: r0(m.lv.proj.projected) }) : t("sum.early");
}

function renderOverview(m) {
  lastM = m;
  renderVerdict(m);
  renderToday(m);
  renderSession(m);
  renderExtra();
  renderWeek(m);
  renderHours(m);
  renderSummary(m);
  renderTypeIn(m);
  if ($("mathDrawer").open) renderMathDrawer(m);
  renderPlanMenu(m);
}

// Type it in and Math: in the header from 1100px up (there is room next to the tabs, and the Overview
// loses a row), in the "..." menu below that. Only shown on the Overview itself.
const OV_KEYS_WIDE = window.matchMedia("(min-width: 1100px)");

function closeOvMenu() {
  $("ovMenu").classList.add("hidden");
  $("moreBtn").setAttribute("aria-expanded", "false");
}

function placeOvKeys() {
  const keys = $("ovKeys");
  const wide = OV_KEYS_WIDE.matches;
  const host = wide ? document.querySelector(".hd .sync") : $("ovMenu");
  if (keys.parentElement !== host) host.prepend(keys);
  const onOverview = state.view === "panel" && !$("dash").classList.contains("hidden");
  keys.classList.toggle("hidden", wide && !onOverview);
  $("moreBtn").classList.toggle("hidden", wide || !onOverview);
  if (wide || !onOverview) closeOvMenu();
}
$("moreBtn").addEventListener("click", () => {
  const open = $("ovMenu").classList.toggle("hidden") === false;
  $("moreBtn").setAttribute("aria-expanded", String(open));
});
// The menu closes after a choice, on a click anywhere else and on Escape
$("ovMenu").addEventListener("click", (e) => { if (e.target.closest("button")) closeOvMenu(); });
document.addEventListener("click", (e) => { if (!e.target.closest("#ovMenu, #moreBtn")) closeOvMenu(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("ovMenu").classList.contains("hidden")) { closeOvMenu(); $("moreBtn").focus(); } });
OV_KEYS_WIDE.addEventListener("change", placeOvKeys);

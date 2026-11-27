// Overview: draws the blocks, the optional Extra block and everything that opens over them.
// One function per block lives in js/blocks/. The numbers come from compute().

let lastM = null; // the last numbers drawn, for the things that open on a click

function renderOverview(m, fresh = false) {
  lastM = m;
  applyAutoWeights(m); // Settings > Plan, "Follow my usual week": saves and draws again when the plan changes
  renderVerdict(m, fresh);
  renderToday(m);
  renderSession(m);
  renderExtra();
  renderPast(m); // before the week: the chart draws the past weeks
  renderWeek(m);
  renderHours(m);
  renderTypeIn(m);
  if ($("mathDrawer").open) renderMathDrawer(m);
  renderPlanMenu(m);
}

// Type it in and Math: in the header from 1280px up (there is room next to the tabs, and the Overview
// loses a row), in the "..." menu below that. Only shown on the Overview itself.
const OV_KEYS_WIDE = window.matchMedia("(min-width: 1280px)");

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

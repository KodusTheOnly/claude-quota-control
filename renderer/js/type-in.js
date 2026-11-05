// "Type it in": key in a reading by hand, for when the usage page is not connected (or just to correct a number)

function openTypeIn() {
  const dlg = $("typeDlg");
  if (!dlg.open) dlg.showModal();
  $("qWeekly").focus();
  $("qWeekly").select();
}
function closeTypeIn() {
  $("typeDlg").close();
}

// Placeholders show the current numbers, so you only retype what changed
function renderTypeIn(m) {
  const w = $("qWeekly");
  if (document.activeElement !== w) w.placeholder = String(Math.round(m.w.used));
  $("qSession").placeholder = m.five ? String(Math.round(m.five.used)) : "";
}

$("typeBtn").addEventListener("click", openTypeIn);
$("typeClose").addEventListener("click", closeTypeIn);
$("typeDlg").addEventListener("click", (e) => {
  if (e.target === $("typeDlg")) closeTypeIn();
});

$("typeForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const weekly = readNumber($("qWeekly"));
  const session = readNumber($("qSession"));
  if (weekly === null || Number.isNaN(weekly) || Number.isNaN(session)) {
    toast(t("q.invalid"), "error");
    return;
  }
  // First manual reading with the collector already running: inherit its reset time
  let anchor;
  if (!(state.settings.manual && state.settings.manual.anchor)) {
    const a = autoSource();
    anchor = a ? a.data.weekly.resetsAt : null;
    if (!anchor) {
      closeTypeIn();
      go("settings");
      toast(t("anchor.needed"), "error");
      return;
    }
  }
  await saveManual({ weekly, session, sessionReset: $("qSessionReset").value || null, anchor });
  $("qWeekly").value = "";
  $("qSession").value = "";
  $("qSessionReset").value = "";
  closeTypeIn();
  toast(t("q.saved", { pct: pct(weekly) }));
});

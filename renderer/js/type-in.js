// "Type it in": key in a reading by hand, for when the usage page is not connected (or just to correct a number)

// Marks the field that cannot be saved and says why, inside the dialog (null clears it)
function typeInError(input) {
  $("typeErr").classList.toggle("hidden", !input);
  for (const id of ["qWeekly", "qSession"]) {
    if ($(id) === input) $(id).setAttribute("aria-invalid", "true");
    else $(id).removeAttribute("aria-invalid");
  }
  if (input) input.focus();
}

function openTypeIn() {
  const dlg = $("typeDlg");
  if (!dlg.open) {
    typeInError(null);
    dlg.showModal();
  }
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
    typeInError(weekly === null || Number.isNaN(weekly) ? $("qWeekly") : $("qSession"));
    return;
  }
  typeInError(null);
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

// Plan menu: click a day of the week to say how heavy it will be (Light, Normal, Heavy or Off).
// Changing a day re-splits what is left of the week among the remaining days.

let planDay = null; // index of the day the menu is open for

function renderPlanMenu(m) {
  if (planDay === null) return;
  const d = m.week[planDay];
  const { nm, date } = dayLabel(d.ms);
  const menu = $("planMenu");
  menu.textContent = "";
  menu.appendChild(node("span", "eng", t("plan.for", { day: `${nm} ${date}` })));
  const keys = node("div", "keyset");
  for (const wt of PLAN_ORDER) {
    const preview = r0(previewBudget(m, planDay, wt));
    const b = node("button", `key${d.weight === wt ? " on" : ""}`, `${t(`plan.${WEIGHT_NAME[wt]}`)} ${wt}× ${t("plan.preview", { pct: preview })}`);
    b.type = "button";
    b.setAttribute("aria-label", `${t(`plan.${WEIGHT_NAME[wt]}`)} ${wt}×, ${t("day.budgetAria", { pct: preview })}`);
    b.setAttribute("aria-pressed", String(d.weight === wt));
    b.addEventListener("click", async () => {
      const next = weights();
      next[d.dow] = wt;
      menu.hidePopover();
      await saveSetting({ weights: next });
    });
    keys.appendChild(b);
  }
  menu.appendChild(keys);
  menu.appendChild(node("span", "hint", d.budget === null ? t("plan.noRecord") : t("plan.hint", { pct: r0(d.budget) })));
  if (!evenWeights()) {
    const reset = node("button", "key reset", t("plan.reset"));
    reset.type = "button";
    reset.addEventListener("click", async () => {
      menu.hidePopover();
      await saveSetting({ weights: [1, 1, 1, 1, 1, 1, 1] });
    });
    menu.appendChild(reset);
  }
}

// Opens the menu above the day (or below it, when there is more room there)
function openPlanMenu(i, anchor) {
  const menu = $("planMenu");
  planDay = i;
  renderPlanMenu(lastM);
  menu.showPopover();
  const a = anchor.getBoundingClientRect();
  const w = menu.offsetWidth;
  const h = menu.offsetHeight;
  const gap = 8;
  const above = a.top - h - gap >= gap || a.top > window.innerHeight - a.bottom;
  menu.style.left = `${Math.max(gap, Math.min(a.left + a.width / 2 - w / 2, window.innerWidth - w - gap))}px`;
  menu.style.top = `${Math.max(gap, above ? a.top - h - gap : Math.min(a.bottom + gap, window.innerHeight - h - gap))}px`;
  anchor.setAttribute("aria-expanded", "true");
  menu.querySelector(".key.on, .key").focus();
}

$("planMenu").addEventListener("toggle", (e) => {
  if (e.newState === "closed") {
    planDay = null;
    document.querySelectorAll(".day[aria-expanded]").forEach((b) => b.removeAttribute("aria-expanded"));
  }
});

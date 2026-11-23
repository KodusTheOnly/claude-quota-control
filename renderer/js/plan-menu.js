// Plan menu: click a day of the week to say how heavy it will be (Light, Normal, Heavy or Off).
// Changing a day re-splits what is left of the week among the remaining days.

let planDay = null; // index of the day the menu is open for

// A plan in words, in the order of the week (m.week): "Mon Heavy · Sun Off", or "every day Normal"
function planText(w, week) {
  const names = week.filter((x) => w[x.dow] !== 1).map((x) => `${shortWeekday(new Date(x.ms))} ${t(`plan.${WEIGHT_NAME[w[x.dow]] || "normal"}`)}`);
  return names.length ? names.join(" · ") : t("plan.suggestEven");
}

// Settings > Plan, "Follow my usual week" (autoWeights): each render, the plan takes what the past weeks suggest
// (suggestWeights in learn.js). The suggestion only changes when a week ends, so this saves at most once a week.
// Before SUGGEST_MIN_WEEKS weeks are on record the plan stays as it was set.
let autoApplying = false;
function applyAutoWeights(m) {
  if (!state.settings || !state.settings.autoWeights || autoApplying) return;
  const sug = suggestWeights(m.learn);
  if (!sug || sug.every((x, d) => x === weights()[d])) return;
  autoApplying = true;
  saveSetting({ weights: sug }).finally(() => {
    autoApplying = false;
  });
}

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
    // Two lines (plan on top, the day's budget below) so the key fits half the menu in both languages
    const b = node("button", `key${d.weight === wt ? " on" : ""}`);
    b.append(node("span", "kn", `${t(`plan.${WEIGHT_NAME[wt]}`)} ${wt}×`), node("span", "kp", t("plan.preview", { pct: preview })));
    b.type = "button";
    b.setAttribute("aria-label", `${t(`plan.${WEIGHT_NAME[wt]}`)} ${wt}×, ${t("day.budgetAria", { pct: preview })}`);
    b.setAttribute("aria-pressed", String(d.weight === wt));
    b.addEventListener("click", async () => {
      const next = weights();
      next[d.dow] = wt;
      menu.hidePopover();
      // A day set by hand: the plan is the person's again, so the automatic one turns off
      await saveSetting({ weights: next, autoWeights: false });
    });
    keys.appendChild(b);
  }
  menu.appendChild(keys);
  menu.appendChild(node("span", "hint", d.budget === null ? t("plan.noRecord") : t("plan.hint", { pct: r0(d.budget) })));
  // What the past weeks point to (learn.js): shown when it differs from the plan, applied only on a click
  // With the automatic plan on it says so, and that choosing here turns it off
  const sug = suggestWeights(m.learn);
  if (state.settings && state.settings.autoWeights) {
    menu.appendChild(node("span", "hint", t("plan.autoMenu")));
  } else if (sug && sug.some((x, d) => x !== weights()[d])) {
    menu.appendChild(node("span", "hint", t("plan.suggest", { n: m.learn.n, list: planText(sug, m.week) })));
    const use = node("button", "key reset", t("plan.useSuggest"));
    use.type = "button";
    use.addEventListener("click", async () => {
      menu.hidePopover();
      await saveSetting({ weights: sug });
    });
    menu.appendChild(use);
  } else if (!sug && m.learn && m.learn.n < SUGGEST_MIN_WEEKS) {
    menu.appendChild(node("span", "hint", t("plan.learning", { n: m.learn.n, need: SUGGEST_MIN_WEEKS })));
  }
  if (!evenWeights()) {
    const reset = node("button", "key reset", t("plan.reset"));
    reset.type = "button";
    reset.addEventListener("click", async () => {
      menu.hidePopover();
      await saveSetting({ weights: [1, 1, 1, 1, 1, 1, 1], autoWeights: false });
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
  (menu.querySelector(".key.on") || menu.querySelector(".key")).focus(); // the day's current plan
}

$("planMenu").addEventListener("toggle", (e) => {
  if (e.newState === "closed") {
    planDay = null;
    document.querySelectorAll(".day[aria-expanded]").forEach((b) => b.removeAttribute("aria-expanded"));
  }
});

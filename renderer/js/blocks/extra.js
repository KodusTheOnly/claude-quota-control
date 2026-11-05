// 05 Extra usage (optional): credits and the monthly spend limit, when the usage page shows them.
// Settings has a switch that hides the block for people who do not use extra usage. With extra usage not set up
// there is nothing to say either: the whole strip is gone and the graph takes its space.

function renderExtra() {
  const e = state.settings.extra;
  const setUp = !!(e && (e.limit > 0 || e.balance > 0));
  const show = state.settings.showExtra !== false && setUp;
  $("foot").classList.toggle("hidden", !show);
  $("dash").dataset.extra = show ? "on" : "off";
  if (!show) return;

  const money = (v, short = false) => fmtMoney(v, e.currency, e.symbol, short);
  const hasLimit = e.limit > 0 && e.spent !== null;
  const ratio = hasLimit ? Math.min(e.spent / e.limit, 1) : 0;
  $("xSpent").textContent = hasLimit ? `${money(e.spent)} / ${money(e.limit, true)}` : t("extra.noLimit");
  $("xMonth").textContent = hasLimit ? t("extra.thisMonth") : "";
  $("xBar").classList.toggle("hidden", !hasLimit);
  setBar($("xBar"), { fill: ratio * 100 });
  $("xBar").setAttribute("aria-label", t("extra.barAria", { pct: r0(ratio * 100) }));

  $("xCredits").textContent = e.balance !== null ? `${t("extra.balance")} ${money(e.balance)}` : "";
  const bits = [];
  if (e.autoReload !== null) bits.push(`${t("extra.auto")} ${t(e.autoReload ? "extra.on" : "extra.off")}`);
  bits.push(t("extra.read", { ago: ago(e.at) }));
  $("xInfo").textContent = bits.join(" · ");
}

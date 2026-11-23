// Tooltips: a small screen in the app's look that says what a part of the Overview is. It opens after the pointer rests on a
// part for a moment (or when the part gets keyboard focus); while one is open, or just after, the next opens at once, so
// moving along the parts reads them one by one. The part it explains gets a dashed outline.
//
// A part opts in with setTip(el, key, value): key names its texts in i18n.js (tip.<key>.t is the name, tip.<key>.d what it
// is), and value is what it reads now ("82%", "17:51 · 2h 04m"). The key "plain" has no texts of its own: only the value,
// for parts whose value already says it all (a day, an hour of the strip). The native title is not used, so the two never
// show at once.

const TIP_DELAY = 1000; // ms the pointer rests on a part before its tip opens
const TIP_WARM = 400; // ms after a tip closes during which the next one opens at once

function setTip(el, key, value = "", warn = false) {
  el.dataset.tip = key;
  el.dataset.tipV = value;
  el.toggleAttribute("data-tip-warn", warn);
  el.removeAttribute("title");
  if (el === tip.cur) tipFill(el);
}

const tip = { el: null, cur: null, timer: 0, hidAt: 0 };
tip.el = node("div", "tip");
tip.el.id = "tip";
tip.el.setAttribute("role", "tooltip");
tip.el.hidden = true;
tip.el.append(node("i", "ar"), node("p", "tt"), node("p", "td"), node("p", "tv"));
document.body.append(tip.el);

function tipFill(el) {
  const key = el.dataset.tip;
  const named = key && key !== "plain";
  tip.el.querySelector(".tt").textContent = named ? t(`tip.${key}.t`) : "";
  tip.el.querySelector(".td").textContent = named ? t(`tip.${key}.d`) : "";
  const tv = tip.el.querySelector(".tv");
  tv.textContent = el.dataset.tipV || "";
  tv.classList.toggle("warn", el.hasAttribute("data-tip-warn"));
  tv.classList.toggle("only", !named);
}

// Above the part, or under it when there is no room above; kept inside the window, the arrow pointing at the part
function tipPlace(el) {
  const r = el.getBoundingClientRect();
  const w = tip.el.offsetWidth;
  const h = tip.el.offsetHeight;
  const cx = r.left + r.width / 2;
  const left = Math.min(Math.max(cx - w / 2, 8), innerWidth - w - 8);
  let top = r.top - h - 11;
  const above = top >= 8;
  if (!above) top = Math.min(r.bottom + 11, innerHeight - h - 8);
  tip.el.classList.toggle("above", above);
  tip.el.classList.toggle("below", !above);
  tip.el.style.left = `${left}px`;
  tip.el.style.top = `${top}px`;
  tip.el.style.setProperty("--ax", `${Math.min(Math.max(cx - left, 12), w - 12)}px`);
}

// On screen, and with something to say (a "plain" part with no value has nothing)
function tipShown(el) {
  return el.isConnected && el.getClientRects().length > 0 && (el.dataset.tip !== "plain" || Boolean(el.dataset.tipV));
}

function tipShow(el) {
  if (!tipShown(el)) return;
  tip.cur = el;
  tipFill(el);
  tip.el.hidden = false;
  tip.el.classList.remove("on");
  tipPlace(el);
  el.classList.add("tip-hot");
  el.setAttribute("aria-describedby", "tip");
  requestAnimationFrame(() => requestAnimationFrame(() => tip.cur === el && tip.el.classList.add("on")));
}

function tipHide() {
  clearTimeout(tip.timer);
  tip.timer = 0;
  if (!tip.cur) return;
  tip.cur.classList.remove("tip-hot");
  tip.cur.removeAttribute("aria-describedby");
  tip.cur = null;
  tip.el.classList.remove("on");
  tip.el.hidden = true;
  tip.hidAt = Date.now();
}

function tipArm(el) {
  if (el === tip.cur) return;
  const warm = Boolean(tip.cur) || Date.now() - tip.hidAt < TIP_WARM;
  tipHide();
  tip.timer = setTimeout(() => tipShow(el), warm ? 0 : TIP_DELAY);
}

// After a render: the open tip takes the new value, or closes when its part is gone
function tipRefresh() {
  if (!tip.cur) return;
  if (!tipShown(tip.cur) || !tip.cur.dataset.tip) return tipHide();
  tipFill(tip.cur);
  tipPlace(tip.cur);
}

document.addEventListener("pointerover", (e) => {
  const el = e.target.closest && e.target.closest("[data-tip]");
  if (el) tipArm(el);
  else tipHide();
});
document.documentElement.addEventListener("pointerleave", tipHide);
document.addEventListener("pointerdown", tipHide);
document.addEventListener("focusin", (e) => {
  const el = e.target.closest && e.target.closest("[data-tip]");
  if (el && e.target.matches(":focus-visible")) tipArm(el);
});
document.addEventListener("focusout", tipHide);
document.addEventListener("keydown", (e) => e.key === "Escape" && tipHide());
addEventListener("scroll", tipHide, { passive: true, capture: true });
addEventListener("resize", tipHide);
addEventListener("blur", tipHide);

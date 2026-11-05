// Contents keys of Settings and Help: a key jumps to its section, and the key of the section in view stays pressed.
// Under 720px the keys are a row that stays under the header; wider, they are a column beside the sections.

const TOC_VIEWS = ["settings", "help"];
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

function tocKeys(view) {
  return [...document.querySelectorAll(`#view-${view} .toc-k[data-target]`)];
}

function markTocKey(keys, current) {
  for (const key of keys) {
    const on = key === current;
    key.classList.toggle("on", on);
    if (on) key.setAttribute("aria-current", "true");
    else key.removeAttribute("aria-current");
  }
}

// Presses the key of the section that is at the top of the screen
function syncToc() {
  if (!TOC_VIEWS.includes(state.view)) return;
  const keys = tocKeys(state.view);
  if (!keys.length) return;
  const sections = keys.map((k) => document.getElementById(k.dataset.target));
  const tops = sections.map((s) => s.getBoundingClientRect().top);
  // With sections side by side (two columns) "the one at the top" is not one section: keep the key that was chosen
  const sideBySide = tops.some((a, i) => tops.some((b, j) => j > i && Math.abs(a - b) < 4));
  if (sideBySide) return;
  const box = document.querySelector(".content");
  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
  const stuck = window.innerWidth < 720 && window.innerHeight >= 700; // the row of keys covers the top of the screen
  const edge = box.getBoundingClientRect().top + rem * (stuck ? 6 : 1.5);
  let current = keys[0];
  tops.forEach((top, i) => {
    if (top <= edge) current = keys[i];
  });
  if (box.scrollTop > 0 && box.scrollTop + box.clientHeight >= box.scrollHeight - 2) current = keys[keys.length - 1];
  markTocKey(keys, current);
}

document.querySelectorAll(".toc-k[data-target]").forEach((key) =>
  key.addEventListener("click", () => {
    const section = document.getElementById(key.dataset.target);
    markTocKey(tocKeys(state.view), key);
    section.scrollIntoView({ block: "start", behavior: reducedMotion.matches ? "auto" : "smooth" });
  })
);

let tocFrame = 0;
document.querySelector(".content").addEventListener(
  "scroll",
  () => {
    if (tocFrame) return;
    tocFrame = requestAnimationFrame(() => {
      tocFrame = 0;
      syncToc();
    });
  },
  { passive: true }
);

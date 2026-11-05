// "Show the math": one drawer with a section per block. Every number on the Overview can be traced here.
// The MATH key of the Week block opens the drawer, which lists every block. The rows come from m.math (compute.js).

const MATH_SECTIONS = [
  { id: "session", code: "01", title: "mod.sessionShort", rows: "session" },
  { id: "today", code: "02", title: "card.today", rows: "today" },
  { id: "week", code: "03", title: "card.week", rows: "week" },
  { id: "verdict", code: "03", title: "blk.verdict", rows: "projection" }, // the verdict is part of block 03
];
let mathSection = null; // the section the drawer was opened at, while it is open

function renderMathDrawer(m) {
  const body = $("mathBody");
  const keep = body.scrollTop;
  body.textContent = "";
  for (const sec of MATH_SECTIONS) {
    const box = node("section", `ds${sec.id === mathSection ? " act" : ""}`);
    box.id = `math-${sec.id}`;
    const h = node("h3");
    h.append(node("b", "", sec.code), t(sec.title));
    box.appendChild(h);
    if (sec.id === "verdict") {
      const txt = verdictTexts(m);
      for (const line of [txt.reason, txt.guide, txt.until].filter(Boolean)) box.appendChild(node("p", "dn", line));
    }
    for (const [label, value] of m.math[sec.rows]) {
      const row = node("div", `dr${String(value).length > 32 ? " long" : ""}`);
      row.append(node("span", "", t(label)), node("span", "", value));
      box.appendChild(row);
    }
    body.appendChild(box);
  }
  body.scrollTop = keep;
}

function openMath(id) {
  const dlg = $("mathDrawer");
  mathSection = id;
  if (lastM) renderMathDrawer(lastM);
  if (!dlg.open) dlg.showModal();
  const sec = $(`math-${id}`);
  const body = $("mathBody");
  if (sec) body.scrollTop = sec.getBoundingClientRect().top - body.getBoundingClientRect().top + body.scrollTop - 8;
}

document.querySelectorAll("[data-math]").forEach((b) => b.addEventListener("click", () => openMath(b.dataset.math)));
$("mathClose").addEventListener("click", () => $("mathDrawer").close());
// A click on the dimmed area (the dialog element itself) closes it
$("mathDrawer").addEventListener("click", (e) => {
  if (e.target === $("mathDrawer")) $("mathDrawer").close();
});
$("mathDrawer").addEventListener("close", () => {
  mathSection = null;
});

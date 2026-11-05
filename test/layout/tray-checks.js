// Checks for the tray card and the taskbar strip, run inside the page. Each returns a list of problems.

// These functions run inside the page, so each one is sent as text together with the helpers it uses (see `inPage`).
function describe(e) {
  return `${e.tagName.toLowerCase()}${e.id ? `#${e.id}` : ""}${typeof e.className === "string" && e.className ? `.${e.className.trim().split(/\s+/).join(".")}` : ""}`;
}

// Shared by both windows: text that is cut off, or under 12px
function checkText() {
  const problems = [];
  const visible = (e) => {
    const r = e.getBoundingClientRect();
    const cs = getComputedStyle(e);
    return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none";
  };
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const tn = walker.currentNode;
    if (!tn.textContent.trim()) continue;
    const owner = tn.parentElement;
    if (!visible(owner) || owner.closest("[aria-hidden='true']")) continue;
    const range = document.createRange();
    range.selectNodeContents(tn);
    const tr = range.getBoundingClientRect();
    if (!tr.width || !tr.height) continue;
    const label = `"${tn.textContent.trim().slice(0, 30)}" in ${describe(owner)}`;
    if (tr.left < -1 || tr.right > innerWidth + 1 || tr.top < -1 || tr.bottom > innerHeight + 1) problems.push(`text outside the window: ${label}`);
    for (let a = owner; a && a !== document.body; a = a.parentElement) {
      const cs = getComputedStyle(a);
      if (cs.overflowX === "visible" && cs.overflowY === "visible") continue;
      const ar = a.getBoundingClientRect();
      if (tr.left < ar.left - 1 || tr.right > ar.right + 1 || tr.top < ar.top - 1 || tr.bottom > ar.bottom + 1) {
        problems.push(`text clipped: ${label} (box ${describe(a)})`);
        break;
      }
    }
    const size = parseFloat(getComputedStyle(owner).fontSize);
    if (size < 11.95) problems.push(`text under 12px (${size.toFixed(1)}px): ${label}`);
  }
  return problems;
}

function overlapping(parent) {
  const problems = [];
  const kids = [...parent.children].filter((c) => {
    const r = c.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(c).position !== "absolute";
  });
  for (let i = 0; i < kids.length; i++)
    for (let j = i + 1; j < kids.length; j++) {
      const a = kids[i].getBoundingClientRect();
      const b = kids[j].getBoundingClientRect();
      if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1.5 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1.5) problems.push(`siblings overlap: ${describe(kids[i])} and ${describe(kids[j])}`);
    }
  return problems;
}

// The card. `height` is what it asked the window for; the window can be 160 to 680 tall.
function checkCardMain({ height, rows, hasData }) {
  const problems = checkText();
  const root = document.documentElement;
  if (root.scrollWidth > innerWidth + 1) problems.push(`card scrolls sideways (${root.scrollWidth} > ${innerWidth})`);
  if (height < 160 || height > 680) problems.push(`the window would be cut: the card asked for ${height}px, the window takes 160 to 680`);
  const card = document.getElementById("card").getBoundingClientRect();
  if (Math.abs(card.height - height) > 1) problems.push(`card height ${Math.round(card.height)} is not the height it asked for (${height})`);
  if (Math.abs(card.width - 340) > 1) problems.push(`card is ${Math.round(card.width)}px wide, not 340`);

  for (const q of [".pop-hd", ".keyrow", ".meta", ".prow-top", "#verdict .row"]) for (const e of document.querySelectorAll(q)) problems.push(...overlapping(e));
  problems.push(...overlapping(document.getElementById("card")));

  const shown = (id) => {
    const e = document.getElementById(id);
    return e && e.getBoundingClientRect().height > 0;
  };
  if (!shown("lamp")) problems.push("the lamp is not visible");
  if (hasData) {
    for (const id of ["vPct", "vAns", "vLevel", "rows"]) if (!shown(id)) problems.push(`#${id} is not visible`);
    const drawn = document.querySelectorAll("#rows .prow").length;
    if (drawn !== rows) problems.push(`${drawn} rows drawn, the summary has ${rows}`);
    for (const row of document.querySelectorAll("#rows .prow")) {
      if (!row.querySelector(".lv") && !row.querySelector(".plate + .mid-num")) problems.push("a row has no level and no text");
    }
  } else if (!shown("empty")) problems.push("the empty state is not visible");

  // Hit targets of 32px or more
  for (const b of document.querySelectorAll("button")) {
    const r = b.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    if (r.height < 31.5 || r.width < 31.5) problems.push(`small hit target (${Math.round(r.width)}x${Math.round(r.height)}): ${describe(b)}`);
  }
  return problems;
}

// The strip: 30px tall, wide enough for what it says, never wider than the window takes (60 to 320)
function checkStripMain({ width }) {
  const problems = checkText();
  if (width < 60 || width > 320) problems.push(`the strip asked for ${width}px, the window takes 60 to 320`);
  const pill = document.getElementById("pill");
  if (pill.scrollWidth > pill.clientWidth + 1) problems.push(`the strip content is wider than the strip (${pill.scrollWidth} > ${pill.clientWidth})`);
  const box = pill.getBoundingClientRect();
  if (Math.abs(box.height - 30) > 1) problems.push(`the strip is ${Math.round(box.height)}px tall, not 30`);
  for (const e of pill.querySelectorAll("*")) {
    const r = e.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    if (r.left < box.left - 1 || r.right > box.right + 1 || r.top < box.top - 1 || r.bottom > box.bottom + 1) problems.push(`outside the strip: ${describe(e)}`);
  }
  problems.push(...overlapping(pill), ...overlapping(document.getElementById("today")));
  for (const b of document.querySelectorAll("button")) {
    const r = b.getBoundingClientRect();
    if (r.height < 23.5 || r.width < 23.5) problems.push(`small hit target (${Math.round(r.width)}x${Math.round(r.height)}): ${describe(b)}`);
  }
  return problems;
}

// Runs a check in the page, with the helpers it calls and its arguments written into the script
const inPage = (main) => (page, arg) => page.evaluate(`(() => {\n${[describe, checkText, overlapping].map(String).join("\n")}\nreturn (${main})(${JSON.stringify(arg)});\n})()`);

module.exports = { checkCard: inPage(checkCardMain), checkStrip: inPage(checkStripMain) };

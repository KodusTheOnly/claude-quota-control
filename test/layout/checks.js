// The checks, run inside the page. Each returns a list of problems (empty when all is well).
// Problems are plain strings that name the element, so a failure is easy to find.

function checkPage({ format, scrolls: formatScrolls, view = "panel" }) {
  const problems = [];
  // The first-run screen is a form, not the dashboard: it scrolls like any form when the window is short
  const firstRun = !document.getElementById("setup").classList.contains("hidden");
  const scrolls = formatScrolls || firstRun || view !== "panel"; // Settings and Help are documents: they scroll
  const describe = (e) => {
    const id = e.id ? `#${e.id}` : "";
    const cls = typeof e.className === "string" && e.className ? `.${e.className.trim().split(/\s+/).join(".")}` : "";
    return `${e.tagName.toLowerCase()}${id}${cls}`;
  };
  const visible = (e) => {
    const r = e.getBoundingClientRect();
    const cs = getComputedStyle(e);
    return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none" && cs.clip !== "rect(0px, 0px, 0px, 0px)"; // not hidden, and not visually hidden for screen readers only
  };
  const overview = document.getElementById(`view-${view}`);
  const dialogs = [...document.querySelectorAll("dialog[open], [popover]:popover-open")];
  const notices = [...document.querySelectorAll(".toast:not(.hidden), #errMsg:not(.hidden)")];
  const scope = [overview, ...dialogs, ...notices];
  const inScope = (e) => scope.some((s) => s.contains(e));

  // 1. The page itself never moves; wide and medium windows never scroll at all
  const content = document.querySelector(".content");
  const root = document.documentElement;
  if (root.scrollWidth > innerWidth + 1) problems.push(`page scrolls sideways (${root.scrollWidth} > ${innerWidth})`);
  if (content.scrollWidth > content.clientWidth + 1) problems.push(`content scrolls sideways (${content.scrollWidth} > ${content.clientWidth})`);
  if (!scrolls && content.scrollHeight > content.clientHeight + 1) problems.push(`content scrolls (${content.scrollHeight} > ${content.clientHeight}) in the ${format} format`);

  // 2. Text that does not fit its box. Every text node is measured against every clipping ancestor.
  const clipsAt = (e) => {
    const cs = getComputedStyle(e);
    return cs.overflowX !== "visible" || cs.overflowY !== "visible";
  };
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const seen = new Set();
  while (walker.nextNode()) {
    const tn = walker.currentNode;
    if (!tn.textContent.trim()) continue;
    const owner = tn.parentElement;
    if (!inScope(owner) || !visible(owner) || owner.closest("[aria-hidden='true'], .sr-only")) continue;
    if (owner.closest(".clamp")) continue; // intentional ellipsis; the full text is in the title
    const range = document.createRange();
    range.selectNodeContents(tn);
    const tr = range.getBoundingClientRect();
    if (!tr.width || !tr.height) continue;
    // Text must be inside the window ...
    if (tr.left < -1 || tr.right > innerWidth + 1) problems.push(`text off the window sideways: "${tn.textContent.trim().slice(0, 30)}" in ${describe(owner)}`);
    // ... and inside every box that clips it
    let scrolled = false; // past a scrolling area, only sideways clipping counts: the rest is just scrolled out of view
    for (let a = owner; a && a !== document.body; a = a.parentElement) {
      if (!clipsAt(a)) continue;
      const ar = a.getBoundingClientRect();
      const sideways = tr.left < ar.left - 1 || tr.right > ar.right + 1;
      const vertically = tr.top < ar.top - 1 || tr.bottom > ar.bottom + 1;
      if (/(auto|scroll)/.test(getComputedStyle(a).overflowY)) {
        scrolled = true;
        if (sideways) { problems.push(`text clipped sideways: "${tn.textContent.trim().slice(0, 30)}" in ${describe(owner)} (box ${describe(a)})`); break; }
        continue;
      }
      const out = sideways || (vertically && !scrolled);
      if (out) {
        const k = `${describe(owner)}|${describe(a)}`;
        if (!seen.has(k)) problems.push(`text clipped: "${tn.textContent.trim().slice(0, 30)}" in ${describe(owner)} (box ${describe(a)})`);
        seen.add(k);
        break;
      }
    }
    // Text must not wrap where it never should
    if (owner.closest(".huge, .big, .nu, .lc, .lv, .mono, .mb, .key, .plate, .ruler, .tab") && !owner.closest(".clamp, .msg, .hint, .planmenu .hint, .banner")) {
      const lh = parseFloat(getComputedStyle(owner).lineHeight) || tr.height;
      if (tr.height > lh * 1.6 && getComputedStyle(owner).whiteSpace === "normal") problems.push(`short text wraps: "${tn.textContent.trim().slice(0, 30)}" in ${describe(owner)}`);
    }
    // 3. Text is never smaller than 12px
    const fs = parseFloat(getComputedStyle(owner).fontSize);
    if (fs < 11.95) problems.push(`text under 12px (${fs.toFixed(1)}px): "${tn.textContent.trim().slice(0, 30)}"`);
  }
  // SVG text of the chart
  for (const tx of document.querySelectorAll("#paceSvg text")) {
    const fs = parseFloat(getComputedStyle(tx).fontSize);
    if (fs < 11.95) problems.push(`chart text under 12px (${fs.toFixed(1)}px): "${tx.textContent}"`);
    const r = tx.getBoundingClientRect();
    const b = document.getElementById("plot").getBoundingClientRect();
    if (r.left < b.left - 1 || r.right > b.right + 1 || r.top < b.top - 1 || r.bottom > b.bottom + 1) problems.push(`chart text outside the chart: "${tx.textContent}"`);
  }

  // The chart's own labels ("now", where the pace leads) must stay off the lines (unless haloed, for a chart with no free spot) and off each other
  const labelBoxes = [...document.querySelectorAll("#paceSvg text.lbl")].map((tx) => ({ tx, b: tx.getBBox() }));
  const lines = [...document.querySelectorAll("#paceSvg polyline")].map((pl) => pl.getAttribute("points").trim().split(/\s+/).map((p) => p.split(",").map(Number)));
  const nowLine = document.querySelector('#paceSvg line[stroke-width="1.5"]');
  if (nowLine) lines.push([[+nowLine.getAttribute("x1"), +nowLine.getAttribute("y1")], [+nowLine.getAttribute("x2"), +nowLine.getAttribute("y2")]]);
  const hits = (a, b, r) => {
    let t0 = 0;
    let t1 = 1;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    for (const [p, q] of [[-dx, a[0] - r.x], [dx, r.x + r.width - a[0]], [-dy, a[1] - r.y], [dy, r.y + r.height - a[1]]]) {
      if (p === 0) { if (q < 0) return false; continue; }
      const k = q / p;
      if (p < 0) { if (k > t1) return false; t0 = Math.max(t0, k); } else { if (k < t0) return false; t1 = Math.min(t1, k); }
    }
    return true;
  };
  for (const { tx, b } of labelBoxes) {
    const r = { x: b.x + 1, y: b.y + 2, width: b.width - 2, height: b.height - 4 }; // the glyphs, not the line box
    if (!tx.classList.contains("halo") && lines.some((pts) => pts.some((p, i) => i > 0 && hits(pts[i - 1], p, r)))) problems.push(`chart label crosses a line: "${tx.textContent}"`);
  }
  for (let i = 0; i < labelBoxes.length; i++) for (let j = i + 1; j < labelBoxes.length; j++) {
    const a = labelBoxes[i].b;
    const c = labelBoxes[j].b;
    if (Math.min(a.x + a.width, c.x + c.width) - Math.max(a.x, c.x) > 1 && Math.min(a.y + a.height, c.y + c.height) - Math.max(a.y, c.y) > 1) problems.push(`chart labels overlap: "${labelBoxes[i].tx.textContent}" and "${labelBoxes[j].tx.textContent}"`);
  }

  // 4. Siblings must not overlap: the blocks, and the things inside a block's screen
  const overlap = (a, b) => {
    const ra = a.getBoundingClientRect();
    const rb = b.getBoundingClientRect();
    return Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left) > 1.5 && Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top) > 1.5;
  };
  // The blocks are compared with the blocks beside them (Session and Today sit inside the Week block, next to each other)
  const blocks = [...document.querySelectorAll("#dash .blk")].filter(visible);
  const byParent = [...new Set(blocks.map((e) => e.parentElement))].map((p) => blocks.filter((e) => e.parentElement === p));
  const groups = [...byParent,...[".hd", ".keys", ".sync"].map((q) => [...document.querySelector(q).children].filter(visible)), ...[...document.querySelectorAll("#dash .crt, #dash .days, #dash .osc")].map((e) => [...e.children].filter((c) => visible(c) && getComputedStyle(c).position !== "absolute"))];
  for (const g of groups) {
    for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) if (overlap(g[i], g[j])) problems.push(`siblings overlap: ${describe(g[i])} and ${describe(g[j])}`);
  }

  // 5. What must always be visible (in the wide and medium formats, without scrolling)
  // (#tLevel and #sLevel are not here: Today and Session show their level only when it is Tight or Pause)
  const must = firstRun || view !== "panel" ? [] : ["vAns", "vRuler", "tUsed", "sPct", "wUsed", "plot", "days", "hrs", "syncBtn", "lamp"];
  for (const id of must) {
    const e = document.getElementById(id);
    if (!e) {
      problems.push(`missing #${id}`);
      continue;
    }
    if (id === "syncBtn" && e.classList.contains("hidden")) continue;
    if (!visible(e)) {
      problems.push(`#${id} is not visible`);
      continue;
    }
    const r = e.getBoundingClientRect();
    if (!scrolls && (r.bottom > innerHeight + 1 || r.right > innerWidth + 1)) problems.push(`#${id} is off the screen`);
    if (r.right > innerWidth + 1) problems.push(`#${id} is off the screen sideways`);
  }
  const dayCards = [...document.querySelectorAll(".day")];
  if (!firstRun && view === "panel" && (dayCards.length !== 7 || !dayCards.every(visible))) problems.push("the seven days are not all visible");

  // Settings and Help: every contents key leads to a section that is there, and the parts of the screen never overlap
  if (view !== "panel") {
    for (const k of document.querySelectorAll(`#view-${view} .toc-k[data-target]`)) {
      if (!visible(k)) continue; // from 720px up the contents keys are gone: every section is on screen
      const target = document.getElementById(k.dataset.target);
      if (!target || !visible(target)) problems.push(`contents key ${k.dataset.target} has no visible section`);
    }
    const parts = [...document.querySelectorAll(`#view-${view} .toc, #view-${view} .lead, #view-${view} .blk`)].filter(visible);
    for (let i = 0; i < parts.length; i++) for (let j = i + 1; j < parts.length; j++) if (overlap(parts[i], parts[j])) problems.push(`parts overlap: ${describe(parts[i])} and ${describe(parts[j])}`);
    const extent = [...parts].reduce((m, e) => Math.max(m, e.getBoundingClientRect().right), 0);
    if (extent > innerWidth + 1) problems.push(`a section is wider than the window (${Math.round(extent)} > ${innerWidth})`);
  }

  // Plate headings (Days, 01 Previous weeks ...) stay inside their block
  if (view !== "panel") {
    for (const pn of document.querySelectorAll(`#view-${view} .blk > .pl .pn`)) {
      if (!visible(pn)) continue;
      const blk = pn.closest(".blk").getBoundingClientRect();
      const r = pn.getBoundingClientRect();
      if (r.right > blk.right - 4 || r.left < blk.left) problems.push(`plate heading runs out of its block: "${pn.textContent.trim().slice(0, 30)}"`);
    }
  }

  // History: the three blocks, the stats and a column for every day, or the empty message
  if (view === "history") {
    for (const id of ["histDays", "histWeeks", "histMap"]) {
      const e = document.getElementById(id);
      if (!e || !visible(e)) problems.push(`#${id} is not visible`);
    }
    const range = Number(document.querySelector(".rk.on").dataset.range);
    const box = document.getElementById("chartBox");
    if (box.classList.contains("hidden")) {
      if (!visible(document.getElementById("daysEmpty"))) problems.push("History has no data and shows no empty message");
    } else {
      const cols = document.querySelectorAll("#chart svg .h-use, #chart svg .h-today, #chart svg .h-none, #chart svg .h-zero");
      if (cols.length !== range) problems.push(`the chart has ${cols.length} columns, expected ${range}`);
      const stats = [...document.querySelectorAll("#stats .stat")];
      if (stats.length !== 4 || !stats.every(visible)) problems.push("the four stats are not all visible");
      const svg = document.querySelector("#chart svg").getBoundingClientRect();
      const b = box.getBoundingClientRect();
      if (svg.left < b.left - 1 || svg.right > b.right + 1 || svg.bottom > b.bottom + 1) problems.push("the chart sticks out of its screen");
      for (const c of cols) {
        const r = c.getBoundingClientRect();
        if (r.width < 2.5) problems.push(`a column is only ${r.width.toFixed(1)}px wide`);
      }
      const labels = [...document.querySelectorAll("#chart svg text")].filter((tx) => visible(tx)).map((tx) => tx.getBoundingClientRect());
      for (let i = 0; i < labels.length; i++) for (let j = i + 1; j < labels.length; j++) {
        const a = labels[i], c = labels[j];
        if (Math.min(a.right, c.right) - Math.max(a.left, c.left) > 1 && Math.min(a.bottom, c.bottom) - Math.max(a.top, c.top) > 1) problems.push("two chart labels overlap");
      }
    }
    const map = document.getElementById("sessionMap");
    if (map.querySelectorAll(".mc").length !== 24) problems.push("the session chart does not have 24 hours");
  }

  // About: the nameplate, the keys and the four plates, with Help lit in the tabs and a way back
  if (view === "about") {
    for (const q of ["#view-about .np", "#view-about .keys2", "#view-about .plates4", "#view-about .back .key", "#aboutVersion"]) {
      const e = document.querySelector(q);
      if (!e || !visible(e)) problems.push(`${q} is not visible`);
    }
    if (document.querySelectorAll("#view-about .plates4 .blk").length !== 4) problems.push("About does not have its four plates");
    const lit = document.querySelector(".nav-btn.on");
    if (!lit || lit.dataset.view !== "help") problems.push("Help is not lit while About is open");
    const mark = document.querySelector("#view-about .mark svg");
    if (!mark || mark.getBoundingClientRect().width < 20) problems.push("the bar mark is missing from the nameplate");
    const line = document.getElementById("updateLine");
    const checked = !line.classList.contains("hidden");
    if (checked && (!visible(line) || !line.querySelector("#updateResult").textContent.trim())) problems.push("the update line is open but says nothing");
  }

  // 6. The window buttons own the top-right corner; the header must stay clear of it
  const reserved = innerWidth - 140;
  for (const e of document.querySelectorAll(".hd .sync, .hd .sync > *, .hd .brand")) {
    if (!visible(e)) continue;
    const r = e.getBoundingClientRect();
    if (r.top < 40 && r.right > reserved + 1) problems.push(`header item under the window buttons: ${describe(e)}`);
  }

  // 6b. Nothing in the header may sit on top of the brand or another header item (a long status text pushed into the brand once)
  // The brand's icon and name count on their own: the name can spill out of the brand's box (it did at 420px with Connect)
  const headItems = [...document.querySelectorAll(".hd .brand, .hd .brand > *, .hd .sync > *")].filter(visible);
  for (let i = 0; i < headItems.length; i++) for (let j = i + 1; j < headItems.length; j++) {
    if (headItems[i].contains(headItems[j]) || headItems[j].contains(headItems[i])) continue;
    const a = headItems[i].getBoundingClientRect(), b = headItems[j].getBoundingClientRect();
    if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1) problems.push(`header items overlap: ${describe(headItems[i])} and ${describe(headItems[j])}`);
  }

  // 7. Hit targets of 32px or more
  for (const b of document.querySelectorAll("button, label.tgl, select, input:not([type=hidden]):not([type=checkbox])")) {
    if (!inScope(b) && !b.closest(".hd") && !b.closest(".msg")) continue;
    if (!visible(b) || b.closest(".sr-only")) continue;
    const r = b.getBoundingClientRect();
    if (r.height < 31.5 || r.width < 31.5) problems.push(`small hit target (${Math.round(r.width)}x${Math.round(r.height)}): ${describe(b)}`);
  }
  return problems;
}

module.exports = { checkPage };

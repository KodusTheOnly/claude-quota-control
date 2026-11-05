// 01 Verdict: "can I use Claude until the reset?"
// The big number is where the week ends at the pace so far. Under it: the answer, the level and a ruler of all levels.

// Why the verdict is what it is. When the level is high, add the pace that would still make it to the reset.
function verdictReason(m) {
  const h = m.head;
  if (m.forecast.kind === "out") return t("hero.sub.out");
  const rate = h.level >= 2 && m.perDay > 0
    ? ` ${t("reason.makeIt", { rate: t(evenWeights() ? "week.perDay" : "week.perNormalDay", { pct: pct(m.perDay) }) })}`
    : "";
  return h.reason + rate;
}

// The big number of the verdict and the words next to it ("86%", "at reset · in 4d 21h"), as the tray card shows them.
// The band in the Overview says it its own way, see bandFigures.
function verdictFigures(m) {
  const proj = m.lv.proj;
  const out = m.forecast.kind === "out";
  return {
    pct: out ? "100%" : proj ? `${r0(proj.projected)}%` : "–",
    when: out ? t("forecast.out") : proj ? t("verdict.when", { dur: fmtDur(m.w.resetsAt - m.now) }) : t("forecast.early"),
  };
}

// The projection in the band, after the level shapes. Each piece can give way on its own when the half is narrow:
// first the leftover, then the words; the number stays.
//   Free (under 80%)   "79%" "at reset" " · ~21% left"
//   80% to 100%        "92%" "at reset"
//   over 100%          "Limit" "~Sat 14:00"
//   early              "Too early to tell" (words only)
function bandFigures(m) {
  const none = { pre: "", num: "", when: "", left: "", kind: "words" };
  if (m.forecast.kind === "out") return { ...none, num: "100%", when: t("forecast.out"), kind: "num" };
  if (m.forecast.kind === "early" || !m.lv.proj) return { ...none, when: t("forecast.early") };
  if (m.forecast.kind === "short") {
    const d = new Date(m.forecast.eta);
    return { ...none, pre: t("band.limit"), num: `~${shortWeekday(d)} ${fmtTime(m.forecast.eta)}`, kind: "num" };
  }
  const shown = asShownPct(m.lv.proj.projected);
  const left = shown < PROJECTION_CUTS[0] * 100 ? `· ${t("band.left", { pct: 100 - shown })}` : "";
  return { ...none, num: `${shown}%`, when: t("band.atReset"), left, kind: "num" };
}

// The answer in one or two words, with a face. The face is decoration (aria-hidden): the level keeps its color, shape and word.
// In the first days of the week there is no projection yet, so the answer is "still early" instead of a level.
const VERDICT_FACES = [":D", ":|", "o_o", ">:O"];
const EARLY_FACE = ":P";
function verdictAnswer(m) {
  if (m.forecast.kind === "early") return { text: t("hero.ans.early"), face: EARLY_FACE };
  return { text: t(`hero.ans.${LEVEL_KEYS[m.head.level]}`), face: VERDICT_FACES[m.head.level] };
}

// The level the verdict shows. While the projection is still missing the level would rest on one
// noisy day, so it stays "not rated" (null), unless the week is already so far gone that it reads Pause.
function verdictLevel(m) {
  return m.forecast.kind === "early" && !weekAtPause(m.w.used) ? null : m.head.level;
}

function renderVerdict(m) {
  const level = verdictLevel(m);
  const figures = bandFigures(m);
  $("vPre").textContent = figures.pre;
  $("vPct").textContent = figures.num;
  $("vWhen").textContent = figures.when;
  $("vLeft").textContent = figures.left;
  const first = limitsFirst(m);
  $("vFirst").textContent = first ? t("band.first", { what: t(first.kind === "week" ? "band.firstWeek" : "band.firstSession"), when: first.kind === "week" ? `${shortWeekday(new Date(first.ms))} ${fmtTime(first.ms)}` : fmtTime(first.ms) }) : "";
  for (const id of ["vPre", "vPct", "vWhen", "vLeft", "vFirst"]) $(id).classList.toggle("hidden", !$(id).textContent);
  fitBand();

  const answer = verdictAnswer(m);
  $("vAns").textContent = answer.text;
  $("vFace").textContent = answer.face;
  setLevelClass($("vAns").parentElement, level); // the cursor takes the level's color
  paintLevel($("vLevel"), level);

  const ruler = $("vRuler");
  ruler.setAttribute("aria-label", t("hero.levelAria", { level: lvName(level) }));
  [...ruler.children].forEach((span, i) => span.classList.toggle("on", i === level));

  // The long explanation lives in the Math drawer; the band only carries it as a tooltip
  $("vScr").title = verdictTexts(m).reason;
}

// The projection gets what is left of the line after the answer and the shapes. Try it whole, then without the
// "Limits you first" line, then without the leftover, then without the words (the number alone), then with only the lit shape (it keeps the level's color,
// shape and the ruler's label), then that shape without its name (as in the vertical format), and only then
// without the number, with all the shapes back. Measured, since the
// room changes with the level, the language and the window: no fixed breakpoint fits them all.
const BAND_FITS = ["fit-nofirst", "fit-noleft", "fit-num", "fit-none"];
const BAND_STEPS = [
  { num: null, lit: false },
  { num: "fit-nofirst", lit: false }, // "Limits you first" is the first to go, before the leftover
  { num: "fit-noleft", lit: false },
  { num: "fit-num", lit: false },
  { num: "fit-num", lit: true },
  { num: "fit-num", lit: true, bare: true },
  { num: "fit-none", lit: false },
];
function fitBand() {
  const box = $("vNum");
  const vl = box.parentElement;
  const hasLit = Boolean($("vRuler").querySelector(".on")); // with no level lit, the shapes all stay
  for (const step of BAND_STEPS) {
    if (step.lit && !hasLit) continue;
    box.classList.remove(...BAND_FITS);
    if (step.num) box.classList.add(step.num);
    vl.classList.toggle("lit-only", step.lit);
    vl.classList.toggle("lit-bare", Boolean(step.bare));
    if (box.scrollWidth <= box.clientWidth + 1) return;
  }
}
new ResizeObserver(() => fitBand()).observe($("vNum").parentElement);

// The longer words behind the verdict: why, what to do, and when it eases. Shown in the Math drawer.
function verdictTexts(m) {
  const h = m.head;
  return {
    reason: verdictReason(m),
    guide: h.guide,
    until: h.until
      ? t(h.next === 0 ? "hero.backToFree" : "hero.easesTo", { level: levelName(h.next), when: fmtWhen(h.until, m.now) })
      : h.level === 0 ? "" : t("hero.nothingHolding"),
  };
}

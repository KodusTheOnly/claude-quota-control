// Tray icon

// Dark disc with a progress ring in the status color (arc = session %, or week % when there
// is no session reading) and the same number in the middle. The dark disc keeps contrast on
// light and dark taskbars. Each size is drawn separately so the number stays sharp.
const TRAY_SIZES = [16, 20, 24, 32, 40, 48];
// The icon is always a CRT, whatever the Screens choice, so these are the CRT values of --free, --moderate, --tight,
// --pause, --scr, --sline, --st and --sm (not read from the page, which may be on paper screens)
const TRAY_LEVEL_HEX = ["#46C07F", "#E8C547", "#F28C38", "#F2575A"];
const TRAY_CRT = { scr: "#0A0F0C", sline: "#2F4036", st: "#E4EFE6", sm: "#9DB0A2" };

function drawTrayIcon(size, color, label, fraction) {
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const ctx = c.getContext("2d");
  const mid = size / 2;
  const stroke = Math.max(2, size * 0.14);
  const r = mid - stroke / 2;

  ctx.fillStyle = TRAY_CRT.scr;
  ctx.beginPath();
  ctx.arc(mid, mid, mid, 0, Math.PI * 2);
  ctx.fill();

  ctx.lineWidth = stroke;
  ctx.strokeStyle = TRAY_CRT.sline;
  ctx.beginPath();
  ctx.arc(mid, mid, r, 0, Math.PI * 2);
  ctx.stroke();

  if (fraction > 0) {
    ctx.strokeStyle = color;
    ctx.lineCap = size >= 24 ? "round" : "butt";
    ctx.beginPath();
    ctx.arc(mid, mid, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(fraction, 1));
    ctx.stroke();
  }

  const two = label.length > 1;
  ctx.fillStyle = TRAY_CRT.st;
  ctx.font = `700 ${Math.round(size * (two ? (size <= 20 ? 0.58 : 0.5) : 0.66))}px "Segoe UI", Arial, sans-serif`;
  if ("letterSpacing" in ctx) ctx.letterSpacing = two ? `${-(size / 32).toFixed(1)}px` : "0px";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, mid, mid + size * 0.04);
  return c.toDataURL("image/png");
}

function updateTray(m) {
  if (!api) return;
  let tooltip = t("tray.setup", { name: t("app.name") });
  let color = TRAY_CRT.sm;
  let label = "?";
  let fraction = 0;
  if (m) {
    color = TRAY_LEVEL_HEX[m.head.level];
    const shown = m.five ? m.five.used : m.w.used;
    label = String(Math.max(0, Math.min(Math.round(shown), 99)));
    fraction = Math.max(0, shown) / 100;
    tooltip = t("tray.head", { name: t("app.name"), level: m.head.name })
      + (m.five ? `\n${t("tray.session", { pct: pct(m.five.used) })}` : "")
      + `\n${t("tray.week", { pct: pct(m.w.used) })}\n${m.dayOff ? t("tray.todayOff", { pct: pct(m.spent) }) : t("tray.today", { pct: pct(m.todayRatio * 100) })}\n${t("tray.updated", { ago: ago(lastUpdate()) })}`;
  }
  const images = TRAY_SIZES.map((size) => ({ scale: size / 16, dataUrl: drawTrayIcon(size, color, label, fraction) }));
  api.setTray({ images, tooltip });
}

// Summary for the tray card and the taskbar strip. Both windows only draw what is in here, so every word
// and every number they show is decided in this one place.
//   lamp     the state of the data (Live, Stale...) as a level key (free, tight...) and a word
//   notice   the note above the card's numbers when the reading is stale or offline (the lamp already says which)
//   head     the verdict: big number, the words next to it, the answer and the level (key and name)
//   rows     Today, Session and Week: label, text, caption, level (key and name) and the bar (fill, over, tick, all in %)
function publishSummary(m, src) {
  if (!api || !api.publishSummary) return;
  const st = src ? dataState() : "none";
  const s = {
    connected: Boolean(state.settings.claudeConnected),
    syncing: syncBusy,
    msg: state.syncMsg && Date.now() - state.syncMsg.at < 10000 ? state.syncMsg : null,
    lang: I18N.getLang(),
    dark: document.documentElement.dataset.theme === "dark",
    paper: document.documentElement.dataset.screens === "paper", // only ever set with the light theme (its default there)
    lamp: { key: lvKey(STATE_LEVEL[st]), text: st === "none" ? t("src.none") : t(`state.${st}`) },
    notice:
      st === "stale" || st === "offline"
        ? { text: t(`msg.${st}`, { dur: fmtDur(Date.now() - lastUpdate()), time: fmtTime(lastUpdate()) }) }
        : null,
    updated: lastUpdate() ? `${sourceLabel(src || { kind: "manual", data: {} })} ${ago(lastUpdate())}` : t("src.none"),
    hasData: Boolean(m),
  };
  if (m) {
    const figures = verdictFigures(m);
    const answer = verdictAnswer(m);
    const shown = verdictLevel(m);
    // The card shows the face's first frame, still
    s.head = { key: lvKey(shown), name: lvName(shown), answer: answer.text, face: answer.face[0].trim(), pct: figures.pct, when: figures.when };
    s.rows = [];

    // Today: a share of today's budget; "left" until it is spent, then "over"
    // An Off day is not rated: it says Off and what was used (a share of the week), with no level or bar
    const off = m.dayOff;
    const ratio = off ? 0 : m.todayRatio;
    const left = pct(Math.max(1 - ratio, 0) * 100);
    const usedToday = pct(m.spent);
    const todayLevel = off ? null : m.lv.today;
    s.rows.push({ kind: "today", label: t("pop.today"), text: off ? t("pop.offUsed", { pct: usedToday }) : t("pop.left", { pct: left }), short: off ? usedToday : left, isOver: !off && isOverBudget(ratio), off, level: todayLevel, ...budgetBarValues(ratio) });

    if (m.five) {
      const f = m.five;
      const elapsed = f.resetsAt ? clamp100(100 - ((f.resetsAt - m.now) / (5 * HOUR)) * 100) : null;
      s.rows.push({
        kind: "session",
        label: t("pop.session"),
        text: t("today.used", { pct: r0(f.used) }),
        caption: f.resetsAt ? t("mod.sessionResets", { dur: fmtDur(f.resetsAt - m.now) }) : t("session.logged", { ago: ago(f.at) }),
        level: m.lv.session,
        fill: clamp100(f.used),
        over: 0,
        tick: elapsed,
      });
    }
    s.rows.push({
      kind: "week",
      label: t("pop.week"),
      text: t("today.used", { pct: r0(m.w.used) }),
      caption: t("pop.expected", { pct: pct(m.lv.expected) }),
      level: m.lv.week,
      fill: clamp100(m.w.used),
      over: 0,
      tick: clamp100(m.lv.expected),
    });
    for (const row of s.rows) {
      row.key = lvKey(row.level);
      row.levelName = row.level === null ? "" : lvName(row.level);
      delete row.level;
    }
  }
  api.publishSummary(s);
}

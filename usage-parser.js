// Parses the text of Claude's usage page (Settings > Usage). Week and session now come from the
// page's own data (usage-json.js); this reader is only used for the Extra usage block (credits
// and monthly spend limit), which is not in that data yet. Works in English and Portuguese.

const SESSION_LABELS = ["sessão atual", "sessao atual", "current session"];
const WEEKLY_LABELS = ["esta semana", "this week", "todos os modelos", "all models", "weekly limit", "limite semanal"];

const WEEKDAYS = [
  ["domingo", "dom", "sunday", "sun"],
  ["segunda-feira", "segunda", "seg", "monday", "mon"],
  ["terça-feira", "terca-feira", "terça", "terca", "ter", "tuesday", "tue", "tues"],
  ["quarta-feira", "quarta", "qua", "wednesday", "wed"],
  ["quinta-feira", "quinta", "qui", "thursday", "thu", "thurs"],
  ["sexta-feira", "sexta", "sex", "friday", "fri"],
  ["sábado", "sabado", "sáb", "sab", "saturday", "sat"],
];

const PCT_RE = /(\d{1,3}(?:[.,]\d+)?)\s*%/;
const RESET_RE = /(redefine|reinicia|reseta|renova|reset|renews|restarts)/i;

function norm(s) {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

// "23:10", "8:00 AM", "11 PM" -> {h, m}
function parseClock(text) {
  const m = text.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?/i);
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  const ap = m[3] ? m[3].toLowerCase().replace(/\./g, "") : null;
  if (!m[2] && !ap) return null; // a bare number is not a time
  if (ap === "pm" && h < 12) h += 12;
  if (ap === "am" && h === 12) h = 0;
  if (h > 23 || min > 59) return null;
  return { h, m: min };
}

function findWeekday(text) {
  const t = norm(text);
  for (let i = 0; i < WEEKDAYS.length; i++) {
    for (const name of WEEKDAYS[i]) {
      const re = new RegExp(`(^|[^a-zà-ú])${name.replace("-", "\\-")}([^a-zà-ú]|$)`, "i");
      if (re.test(t)) return i;
    }
  }
  return null;
}

// Turns reset text into a date/time (ms), relative to "now".
function parseReset(text, now = Date.now()) {
  if (!text) return null;
  const t = norm(text);

  // "in 2 hr 5 min", "em 2 h 5 min", "in 40 min"
  const rel = t.match(/(?:em|in)\s+(?:(\d+)\s*(?:horas|hora|hours|hour|hrs|hr|h))?\s*(?:(\d+)\s*(?:minutos|minuto|minutes|minute|mins|min))?/);
  if (rel && (rel[1] || rel[2])) {
    return now + (Number(rel[1] || 0) * 60 + Number(rel[2] || 0)) * 60000;
  }

  const clock = parseClock(t);
  if (!clock) return null;
  const base = new Date(now);
  const wd = findWeekday(t);

  // "tomorrow at 8:00 AM" / "amanhã às 08:00"
  if (/amanh|tomorrow/.test(t)) {
    const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + 1, clock.h, clock.m);
    return d.getTime();
  }

  if (wd !== null) {
    let add = (wd - base.getDay() + 7) % 7;
    let d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + add, clock.h, clock.m);
    if (d.getTime() <= now) d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + add + 7, clock.h, clock.m);
    return d.getTime();
  }

  // Time only: the next time that clock time occurs
  let d = new Date(base.getFullYear(), base.getMonth(), base.getDate(), clock.h, clock.m);
  if (d.getTime() <= now) d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + 1, clock.h, clock.m);
  return d.getTime();
}

// From a label, finds the first % and the first reset line
function readBlock(lines, start) {
  let used = null;
  let resetText = null;
  for (let i = start + 1; i < Math.min(lines.length, start + 8); i++) {
    const line = lines[i];
    if (i > start + 1 && isLabel(line)) break;
    if (resetText === null && RESET_RE.test(line)) resetText = line;
    if (used === null) {
      const m = line.match(PCT_RE);
      if (m) used = Number(m[1].replace(",", "."));
    }
    if (used !== null && resetText !== null) break;
  }
  return { used, resetText };
}

function isLabel(line) {
  const n = norm(line);
  return SESSION_LABELS.includes(n) || WEEKLY_LABELS.includes(n);
}

// Money as written on the page: "R$ 0,00", "$1,234.50", "R$ 1.500", "€12"
const CURRENCY_RE = "(R\\$|US\\$|\\$|€|£)";
const CURRENCY_CODES = { "R$": "BRL", "US$": "USD", "$": "USD", "€": "EUR", "£": "GBP" };

function parseAmount(str) {
  let x = String(str).trim();
  const lastDot = x.lastIndexOf(".");
  const lastComma = x.lastIndexOf(",");
  if (lastDot >= 0 && lastComma >= 0) {
    // The later separator is the decimal one
    x = lastComma > lastDot ? x.replace(/\./g, "").replace(",", ".") : x.replace(/,/g, "");
  } else if (lastComma >= 0) {
    x = /,\d{1,2}$/.test(x) ? x.replace(",", ".") : x.replace(/,/g, "");
  } else if (lastDot >= 0) {
    x = /\.\d{1,2}$/.test(x) ? x : x.replace(/\./g, "");
  }
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

const CREDITS_LABELS = ["créditos de uso", "creditos de uso", "usage credits", "extra usage", "uso extra"];
const SPEND_RE = new RegExp(`${CURRENCY_RE}\\s*([\\d.,]+)\\s*(?:de|of)\\s*${CURRENCY_RE}?\\s*([\\d.,]+)\\s*(?:este mês|esse mês|neste mês|no mês|this month)`, "i");
const BALANCE_RE = new RegExp(`^${CURRENCY_RE}\\s*([\\d.,]+)$`);

// Credits balance, spend so far this month and the monthly limit
function parseExtra(lines) {
  let balance = null;
  let spent = null;
  let limit = null;
  let symbol = null;
  let autoReload = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (CREDITS_LABELS.includes(norm(line)) && balance === null) {
      for (let j = i + 1; j <= i + 2 && j < lines.length; j++) {
        const b = lines[j].match(BALANCE_RE);
        if (b) {
          balance = parseAmount(b[2]);
          symbol = symbol || b[1];
          break;
        }
      }
    }
    const m = line.match(SPEND_RE);
    if (m && spent === null) {
      spent = parseAmount(m[2]);
      limit = parseAmount(m[4]);
      symbol = m[1];
    }
    if (/recarregamento autom[aá]tico\s+(desativado|ativado)|auto[- ]?reload\s+(off|on|disabled|enabled)/i.test(line)) {
      autoReload = /desativado|off|disabled/i.test(line.match(/recarregamento autom[aá]tico\s+\S+|auto[- ]?reload\s+\S+/i)[0]) ? false : true;
    }
  }
  if (balance === null && spent === null) return null;
  return { currency: CURRENCY_CODES[symbol] || null, symbol, balance, spent, limit, autoReload };
}

function parseUsageText(text, now = Date.now()) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  let session = null;
  let weekly = null;
  for (let i = 0; i < lines.length; i++) {
    const n = norm(lines[i]);
    if (!session && SESSION_LABELS.includes(n)) {
      const b = readBlock(lines, i);
      if (b.used !== null) session = { used: b.used, resetsAt: parseReset(b.resetText, now), resetText: b.resetText };
    } else if (!weekly && WEEKLY_LABELS.includes(n)) {
      const b = readBlock(lines, i);
      if (b.used !== null) weekly = { used: b.used, resetsAt: parseReset(b.resetText, now), resetText: b.resetText };
    }
  }

  const extra = parseExtra(lines);
  if (!weekly) return { ok: false, session };
  return { ok: true, weekly, session, extra };
}

module.exports = { parseUsageText, parseReset };

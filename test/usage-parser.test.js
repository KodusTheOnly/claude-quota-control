const test = require("node:test");
const assert = require("node:assert/strict");
const { parseUsageText, parseReset } = require("../usage-parser");

// Wednesday 2026-10-28 10:00 local time
const NOW = new Date(2026, 9, 28, 10, 0).getTime();
const at = (y, mo, d, h, mi) => new Date(y, mo - 1, d, h, mi).getTime();

test("reads session and week from an English page", () => {
  const text = [
    "Plan usage limits",
    "Current session",
    "Resets in 2 hr 46 min",
    "16% used",
    "Weekly limits",
    "All models",
    "Resets Mon 8:00 AM",
    "3% used",
  ].join("\n");
  const r = parseUsageText(text, NOW);
  assert.equal(r.ok, true);
  assert.equal(r.session.used, 16);
  assert.equal(r.session.resetsAt, NOW + (2 * 60 + 46) * 60000);
  assert.equal(r.weekly.used, 3);
  assert.equal(r.weekly.resetsAt, at(2026, 11, 2, 8, 0));
});

test("reads a Portuguese page with decimal commas", () => {
  const text = ["Sessão atual", "Reinicia em 40 min", "7,5% usado", "Todos os modelos", "Reinicia seg. 08:00", "12% usado"].join("\n");
  const r = parseUsageText(text, NOW);
  assert.equal(r.ok, true);
  assert.equal(r.session.used, 7.5);
  assert.equal(r.session.resetsAt, NOW + 40 * 60000);
  assert.equal(r.weekly.used, 12);
});

test("a session block does not swallow the weekly percentage", () => {
  const text = ["Current session", "Resets in 1 hr", "All models", "Resets Mon 8:00 AM", "50% used"].join("\n");
  const r = parseUsageText(text, NOW);
  assert.equal(r.session, null);
  assert.equal(r.weekly.used, 50);
});

test("reports failure when there is no weekly block", () => {
  assert.equal(parseUsageText("Something else entirely", NOW).ok, false);
  assert.equal(parseUsageText("", NOW).ok, false);
  assert.equal(parseUsageText(null, NOW).ok, false);
});

test("parseReset: relative, tomorrow, clock only and weekday forms", () => {
  assert.equal(parseReset("Resets in 40 min", NOW), NOW + 40 * 60000);
  assert.equal(parseReset("Resets tomorrow at 8:00 AM", NOW), at(2026, 10, 29, 8, 0));
  assert.equal(parseReset("Resets at 11 PM", NOW), at(2026, 10, 28, 23, 0));
  assert.equal(parseReset("Resets at 9:00 AM", NOW), at(2026, 10, 29, 9, 0), "a time already past rolls to tomorrow");
  assert.equal(parseReset("Resets Wed 8:00 AM", NOW), at(2026, 11, 4, 8, 0), "same weekday, time already past: next week");
  assert.equal(parseReset("Resets Fri 15:00", NOW), at(2026, 10, 30, 15, 0));
});

test("parseReset: rejects text with no usable time", () => {
  assert.equal(parseReset("", NOW), null);
  assert.equal(parseReset("Resets soon", NOW), null);
  assert.equal(parseReset("Resets 25:00", NOW), null);
});

const PT_FULL = [
  "Seu uso",
  "Pro",
  "Atenção. Nesse ritmo, você vai esgotar seu limite no início da noite de segunda-feira, antes da redefinição de terça-feira.",
  "Subir de plano",
  "Comprar créditos de uso",
  "Sessão atual",
  "Redefine às 12:50",
  "31% usado",
  "Esta semana",
  "Reinicia terça-feira, 08:00",
  "18% usado",
  "Créditos de uso",
  "R$ 0",
  "Disponível para qualquer tarefa. Os créditos promocionais são usados antes dos comprados.",
  "Ative os créditos de uso para continuar usando o Claude se atingir o limite do plano. Saiba mais",
  "Comprar créditos de uso · Até 30% de desconto",
  "Limite de gastos mensais",
  "Gerenciar",
  "R$ 0,00 de R$ 500 este mês · Recarregamento automático desativado",
].join("\n");

test("reads the credits and the monthly spend limit", () => {
  const r = parseUsageText(PT_FULL, NOW);
  assert.equal(r.ok, true);
  assert.deepEqual(r.extra, { currency: "BRL", symbol: "R$", balance: 0, spent: 0, limit: 500, autoReload: false });
});

test("no extra section when the page has none", () => {
  const text = ["Your usage", "Pro", "Upgrade plan", "Current session", "Resets in 2 hr", "10% used", "This week", "Resets Tue 8:00 AM", "20% used"].join("\n");
  const r = parseUsageText(text, NOW);
  assert.equal(r.ok, true);
  assert.equal(r.extra, null);
});

test("reads money in English format, with balance and a limit in use", () => {
  const text = ["Usage credits", "$12.50", "Monthly spend limit", "$37.25 of $100 this month · Auto-reload on", "This week", "Resets Tue 8:00 AM", "5% used"].join("\n");
  const r = parseUsageText(text, NOW);
  assert.equal(r.extra.currency, "USD");
  assert.equal(r.extra.balance, 12.5);
  assert.equal(r.extra.spent, 37.25);
  assert.equal(r.extra.limit, 100);
  assert.equal(r.extra.autoReload, true);
});

test("money with thousands separators", () => {
  const text = ["Créditos de uso", "R$ 1.250,50", "R$ 1.500,00 de R$ 2.000 este mês", "Esta semana", "Reinicia ter 08:00", "5% usado"].join("\n");
  const r = parseUsageText(text, NOW);
  assert.equal(r.extra.balance, 1250.5);
  assert.equal(r.extra.spent, 1500);
  assert.equal(r.extra.limit, 2000);
});

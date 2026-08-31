const assert = require("assert");
const Core = require("./core.js");

function run() {
  assert.strictEqual(Core.shiftMonth("2026-01", -1), "2025-12");
  assert.strictEqual(Core.shiftMonth("2026-08", 1), "2026-09");
  assert.strictEqual(Core.daysInMonth(2026, 2), 28);

  const entries = [
    { id: "1", date: "2026-08-01", amount: 100, type: "expense", category: "Food", note: "tea", method: "Cash" },
    { id: "2", date: "2026-08-01", amount: 40, type: "income", category: "Other", note: "refund", method: "Cash" },
    { id: "3", date: "2026-08-02", amount: 50, type: "expense", category: "Food", note: "tea", method: "Cash", deleted: true },
    { id: "4", date: "2026-07-15", amount: 200, type: "expense", category: "Food", note: "rent snack", method: "bKash", recurringId: "r1" },
  ];

  assert.strictEqual(Core.expenseTotal(entries), 300);
  assert.strictEqual(Core.incomeTotal(entries), 40);
  assert.strictEqual(Core.netSpend(Core.monthEntries(entries, "2026-08")), 60);

  const fc = Core.forecastMonthEnd(310, "2026-08", "2026-08-10");
  assert.ok(Math.abs(fc.projected - 310 * 3.1) < 0.001);
  assert.strictEqual(fc.daysLeft, 21);

  const dup = Core.duplicateOf(entries, { date: "2026-08-01", amount: 100, note: "Tea", category: "Food", type: "expense" });
  assert.ok(dup && dup.id === "1");

  const cats = Core.allCategories(["Pets", "Food", "  "]);
  assert.ok(cats.includes("Pets"));
  assert.strictEqual(cats.filter((c) => c === "Food").length, 1);

  const pending = Core.pendingRecurring(entries, "2026-08");
  assert.strictEqual(pending.length, 1);
  const copy = Core.copyRecurring(pending[0], "2026-08");
  assert.strictEqual(copy.date, "2026-08-15");
  assert.strictEqual(copy.recurringId, "r1");

  const already = Core.pendingRecurring(
    [...entries, { id: "5", date: "2026-08-15", amount: 200, type: "expense", category: "Food", note: "x", recurringId: "r1" }],
    "2026-08",
  );
  assert.strictEqual(already.length, 0);

  const daily = new Map([
    [1, 10],
    [2, 12],
    [3, 80],
  ]);
  const unusual = Core.unusualDays(daily, 2);
  assert.strictEqual(unusual[0][0], 3);

  const rows = Core.filterLedger(entries, { month: "2026-08", search: "tea", sortKey: "amount", sortDir: "asc" });
  assert.strictEqual(rows.length, 1);
  const all = Core.filterLedger(entries, { month: "2026-08", allMonths: true, search: "" });
  assert.strictEqual(all.length, 3);

  const trend = Core.monthTrend(entries, "2026-08", 2);
  assert.strictEqual(trend.length, 2);
  assert.strictEqual(trend[1].month, "2026-08");

  console.log("ok — " + module.children.length + " core checks passed");
}

run();

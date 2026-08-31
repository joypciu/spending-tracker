const LedgerCore = (() => {
  const BASE_CATEGORIES = [
    "Food",
    "Groceries",
    "Transport",
    "Housing",
    "Utilities",
    "Entertainment",
    "Health",
    "Shopping",
    "Other",
  ];
  const METHODS = ["Cash", "bKash", "Nagad", "Card", "Bank", "Other"];

  function pad2(n) {
    return n < 10 ? `0${n}` : String(n);
  }

  function shiftIso(iso, deltaDays) {
    const d = new Date(`${iso}T12:00:00`);
    if (Number.isNaN(d.getTime())) return iso;
    d.setDate(d.getDate() + deltaDays);
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }

  function trailingSpend(entries, endIso, days) {
    const end = new Date(`${endIso}T12:00:00`);
    if (Number.isNaN(end.getTime())) return 0;
    let sum = 0;
    for (const e of entries || []) {
      if (e.deleted || e.type === "income" || !e.date) continue;
      const d = new Date(`${e.date}T12:00:00`);
      const diff = (end - d) / 86400000;
      if (diff >= 0 && diff < days) sum += Number(e.amount || 0);
    }
    return sum;
  }

  function shiftMonth(key, delta) {
    const [y, m] = key.split("-").map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
  }

  function daysInMonth(year, month) {
    return new Date(year, month, 0).getDate();
  }

  function expenseTotal(list) {
    return list.filter((e) => e.type !== "income" && !e.deleted).reduce((s, e) => s + Number(e.amount || 0), 0);
  }

  function incomeTotal(list) {
    return list.filter((e) => e.type === "income" && !e.deleted).reduce((s, e) => s + Number(e.amount || 0), 0);
  }

  function netSpend(list) {
    return expenseTotal(list) - incomeTotal(list);
  }

  function monthEntries(entries, month) {
    const prefix = `${month}-`;
    return (entries || []).filter((e) => !e.deleted && e.date && e.date.startsWith(prefix));
  }

  function forecastMonthEnd(spent, month, todayIso) {
    const [y, m] = month.split("-").map(Number);
    const days = daysInMonth(y, m);
    if (!todayIso || !todayIso.startsWith(`${month}-`)) {
      return { projected: spent, pace: 0, daysLeft: 0, elapsed: days };
    }
    const elapsed = Math.max(1, Number(todayIso.slice(8, 10)));
    const daysLeft = Math.max(0, days - elapsed);
    const pace = spent / elapsed;
    return { projected: pace * days, pace, daysLeft, elapsed };
  }

  function duplicateOf(entries, candidate, windowDays = 0) {
    return (entries || []).find((e) => {
      if (e.deleted || e.id === candidate.id) return false;
      if (e.type !== (candidate.type || "expense")) return false;
      if (Number(e.amount) !== Number(candidate.amount)) return false;
      if ((e.note || "").trim().toLowerCase() !== (candidate.note || "").trim().toLowerCase()) return false;
      if (e.category !== candidate.category) return false;
      if (windowDays === 0) return e.date === candidate.date;
      return e.date === candidate.date;
    });
  }

  function mergeNamed(base, custom) {
    const extra = (custom || []).map((c) => String(c).trim()).filter(Boolean);
    const seen = new Set(base);
    const out = base.slice();
    for (const c of extra) {
      if (!seen.has(c)) {
        seen.add(c);
        out.splice(Math.max(0, out.length - 1), 0, c);
      }
    }
    return out;
  }

  function allCategories(custom) {
    return mergeNamed(BASE_CATEGORIES, custom);
  }

  function allMethods(custom) {
    return mergeNamed(METHODS, custom);
  }

  function methodBalances(entries, month) {
    const map = new Map();
    for (const e of monthEntries(entries, month)) {
      const key = e.method || "Other";
      const signed = e.type === "income" ? -Number(e.amount || 0) : Number(e.amount || 0);
      map.set(key, (map.get(key) || 0) + signed);
    }
    return [...map.entries()].sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  }

  function suggestAmounts(entries, extras) {
    const set = new Set((extras || [20, 50, 100, 200, 500]).map(Number));
    for (const e of entries || []) {
      if (e.deleted || e.type === "income") continue;
      const n = Number(e.amount);
      if (n > 0) set.add(n);
    }
    return [...set].filter((n) => n > 0).sort((a, b) => a - b).slice(0, 10);
  }

  function walletSnapshot(entries, month, starting) {
    const nets = new Map(methodBalances(entries, month));
    const start = starting || {};
    const names = new Set([...nets.keys(), ...Object.keys(start)]);
    const rows = [];
    for (const name of names) {
      if (!name) continue;
      const net = nets.get(name) || 0;
      const seed = Number.parseFloat(start[name]);
      const hasSeed = Number.isFinite(seed) && seed > 0;
      if (!hasSeed && !net) continue;
      rows.push({ name, net, remaining: hasSeed ? seed - net : null, hasSeed });
    }
    rows.sort((a, b) => Math.abs(b.remaining ?? b.net) - Math.abs(a.remaining ?? a.net));
    return rows;
  }

  function merchantKey(note) {
    const t = String(note || "")
      .toLowerCase()
      .replace(/[^a-z0-9\u0980-\u09ff\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!t) return "";
    return t.split(" ").slice(0, 3).join(" ");
  }

  function unusualDays(dailyMap, threshold = 2) {
    const values = [...dailyMap.values()].filter((v) => v > 0);
    if (!values.length) return [];
    const avg = values.reduce((s, v) => s + v, 0) / values.length;
    if (avg <= 0) return [];
    return [...dailyMap.entries()]
      .filter(([, v]) => v > avg * threshold)
      .sort((a, b) => b[1] - a[1]);
  }

  function pendingRecurring(entries, month, skipped) {
    const thisMonth = new Set(
      monthEntries(entries, month)
        .filter((e) => e.recurringId)
        .map((e) => e.recurringId),
    );
    const seen = new Map();
    for (const e of entries || []) {
      if (e.deleted || !e.recurringId || e.type === "income") continue;
      if (e.date && e.date.slice(0, 7) >= month) continue;
      if (thisMonth.has(e.recurringId)) continue;
      const skip = skipped && skipped[e.recurringId];
      if (Array.isArray(skip) && skip.includes(month)) continue;
      const prev = seen.get(e.recurringId);
      if (!prev || e.date > prev.date) seen.set(e.recurringId, e);
    }
    return [...seen.values()];
  }

  function copyRecurring(source, month) {
    const day = Math.min(Number(source.date.slice(8, 10)), daysInMonth(...month.split("-").map(Number)));
    return {
      date: `${month}-${pad2(day)}`,
      amount: source.amount,
      category: source.category,
      method: source.method,
      type: source.type || "expense",
      note: source.note,
      recurringId: source.recurringId,
    };
  }

  function monthTrend(entries, throughMonth, count = 6) {
    const out = [];
    let key = throughMonth;
    for (let i = 0; i < count; i++) {
      out.unshift({ month: key, spent: expenseTotal(monthEntries(entries, key)) });
      key = shiftMonth(key, -1);
    }
    return out;
  }

  function filterLedger(entries, opts) {
    const month = opts.month;
    const q = (opts.search || "").trim().toLowerCase();
    const allMonths = !!opts.allMonths;
    let rows = allMonths
      ? (entries || []).filter((e) => !e.deleted)
      : monthEntries(entries, month);
    if (opts.filterCategory && opts.filterCategory !== "all") {
      rows = rows.filter((e) => e.category === opts.filterCategory);
    }
    if (opts.filterMethod && opts.filterMethod !== "all") {
      rows = rows.filter((e) => e.method === opts.filterMethod);
    }
    if (opts.filterType && opts.filterType !== "all") {
      rows = rows.filter((e) => e.type === opts.filterType);
    }
    if (q) {
      rows = rows.filter((e) => `${e.note} ${e.category} ${e.method} ${e.amount} ${e.date}`.toLowerCase().includes(q));
    }
    const dir = opts.sortDir === "asc" ? 1 : -1;
    const sortKey = opts.sortKey || "date";
    rows.sort((a, b) => {
      if (sortKey === "amount") return (a.amount - b.amount) * dir;
      return String(a[sortKey] || "").localeCompare(String(b[sortKey] || "")) * dir;
    });
    return rows;
  }

  return {
    BASE_CATEGORIES,
    METHODS,
    pad2,
    shiftMonth,
    shiftIso,
    trailingSpend,
    daysInMonth,
    expenseTotal,
    incomeTotal,
    netSpend,
    monthEntries,
    forecastMonthEnd,
    duplicateOf,
    allCategories,
    allMethods,
    methodBalances,
    suggestAmounts,
    walletSnapshot,
    merchantKey,
    unusualDays,
    pendingRecurring,
    copyRecurring,
    monthTrend,
    filterLedger,
  };
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = LedgerCore;
}

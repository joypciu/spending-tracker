const STORAGE_KEY = "spending-tracker-v1";
const REMIND_HOUR = 22;
const REMIND_MINUTE = 30;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const pad2 = LedgerCore.pad2;
const shiftMonth = LedgerCore.shiftMonth;
const daysInMonth = LedgerCore.daysInMonth;
const expenseTotal = LedgerCore.expenseTotal;
const incomeTotal = LedgerCore.incomeTotal;
const netSpend = LedgerCore.netSpend;

const DEFAULTS = {
  selectedMonth: "2026-08",
  selectedDate: "2026-08-31",
  monthlyBudget: "40000",
  budgetsByMonth: {},
  dailyCap: "",
  currency: "৳",
  weekStart: 6,
  locale: "bn-BD",
  density: "comfortable",
  theme: "dark",
  remindEnabled: false,
  lastRemindDate: "",
  view: "overview",
  search: "",
  filterCategory: "all",
  filterMethod: "all",
  filterType: "all",
  sortKey: "date",
  sortDir: "desc",
  categoryCaps: {},
  templates: [],
  customCategories: [],
  customMethods: [],
  recurringSkipped: {},
  pinHash: "",
  idleLockMinutes: 5,
  startingBalances: {},
  nagDismissedDate: "",
  lastCategory: "Food",
  lastMethod: "Cash",
  searchAllMonths: false,
  entries: [],
  syncEnabled: false,
  syncUrl: "",
  syncId: "",
  syncSecret: "",
  lastSyncAt: 0,
  metaUpdatedAt: 0,
  deviceId: "",
};

function sampleEntries() {
  const today = todayIso();
  const yesterday = LedgerCore.shiftIso(today, -1);
  return [
    { date: today, amount: 40, category: "Food", note: "Tea", method: "Cash", type: "expense" },
    { date: today, amount: 120, category: "Groceries", note: "Water", method: "Cash", type: "expense" },
    { date: yesterday, amount: 50, category: "Transport", note: "Rickshaw", method: "Cash", type: "expense" },
  ].map((row) => migrateEntry({ ...row, id: newId() }));
}

function loadSampleEntries() {
  const live = state.entries.some((e) => !e.deleted);
  if (live && !confirm("Add three sample purchases for today and yesterday? Existing rows stay.")) return;
  state.entries = state.entries.concat(sampleEntries());
  bumpMeta();
  saveState();
  render();
  toast("Sample purchases added");
}

let remindTimer = null;
let undo = null;
let modalSnap = "";
let calendarFollow = true;
let idleLockTimer = null;
let editingId = null;
let toastTimer = null;
let state = loadState();

function categories() {
  return LedgerCore.allCategories(state.customCategories);
}

function methods() {
  return LedgerCore.allMethods(state.customMethods);
}

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function currentMonthKey() {
  return todayIso().slice(0, 7);
}

function uiLocale() {
  return state.locale === "en-US" ? "en-US" : "bn-BD";
}

function monthLabel(key) {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleString(uiLocale(), { month: "long", year: "numeric" });
}

function formatIsoDate(iso) {
  if (!iso) return "—";
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  const thisYear = iso.startsWith(`${new Date().getFullYear()}-`);
  return d.toLocaleDateString(uiLocale(), {
    month: "short",
    day: "numeric",
    year: thisYear ? undefined : "numeric",
  });
}

function pickNamed(list, preferred, fallback) {
  if (preferred && list.includes(preferred)) return preferred;
  return fallback;
}

function formatMoney(n, symbol = state.currency) {
  const whole = Math.abs(n - Math.round(n)) < 0.005;
  const abs = Math.abs(n).toLocaleString("en-US", {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: 2,
  });
  return n < 0 ? `-${symbol}${abs}` : `${symbol}${abs}`;
}

function highlightQuery(text, q) {
  const raw = String(text ?? "");
  const query = (q || "").trim();
  if (!query) return escapeHtml(raw);
  const out = [];
  const lower = raw.toLowerCase();
  const needle = query.toLowerCase();
  let i = 0;
  while (i < raw.length) {
    const at = lower.indexOf(needle, i);
    if (at < 0) {
      out.push(escapeHtml(raw.slice(i)));
      break;
    }
    out.push(escapeHtml(raw.slice(i, at)));
    out.push(`<mark>${escapeHtml(raw.slice(at, at + needle.length))}</mark>`);
    i = at + needle.length;
  }
  return out.join("");
}

function jumpSelectedDay(delta) {
  const next = LedgerCore.shiftIso(state.selectedDate || todayIso(), delta);
  state.selectedDate = next;
  state.selectedMonth = next.slice(0, 7);
  calendarFollow = true;
  saveState();
  render();
}

function newId() {
  return crypto.randomUUID ? crypto.randomUUID() : `e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function migrateEntry(e) {
  return {
    id: e.id || newId(),
    date: e.date,
    amount: Number(e.amount) || 0,
    category: e.category || "Other",
    note: e.note || "",
    method: e.method || "Cash",
    type: e.type === "income" ? "income" : "expense",
    updatedAt: e.updatedAt || Date.now(),
    deleted: !!e.deleted,
    recurringId: e.recurringId || "",
  };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      const merged = { ...DEFAULTS, ...parsed };
      merged.entries = Array.isArray(parsed.entries) ? parsed.entries.map(migrateEntry) : [];
      if (!merged.selectedDate) merged.selectedDate = todayIso();
      if (!merged.budgetsByMonth) merged.budgetsByMonth = {};
      if (!merged.categoryCaps) merged.categoryCaps = {};
      if (!merged.templates) merged.templates = [];
      if (!merged.customCategories) merged.customCategories = [];
      if (!merged.customMethods) merged.customMethods = [];
      if (!merged.recurringSkipped) merged.recurringSkipped = {};
      if (!merged.startingBalances) merged.startingBalances = {};
      if (!merged.deviceId) merged.deviceId = newId();
      if (!merged.syncUrl && location.protocol.startsWith("http")) {
        merged.syncUrl = location.origin;
      }
      return merged;
    }
  } catch {
    /* seed */
  }
  return {
    ...structuredClone(DEFAULTS),
    entries: [],
    selectedMonth: currentMonthKey(),
    selectedDate: todayIso(),
    deviceId: newId(),
    syncUrl: location.protocol.startsWith("http") ? location.origin : "",
  };
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  scheduleSync();
}

function bumpMeta() {
  state.metaUpdatedAt = Date.now();
}

function pairingCode() {
  if (!state.syncId || !state.syncSecret) return "";
  return `LEDGER.${state.syncId}.${state.syncSecret}`;
}

function parsePairing(code) {
  const parts = String(code || "").trim().split(".");
  if (parts.length >= 3 && parts[0] === "LEDGER") {
    return { id: parts[1], secret: parts.slice(2).join(".") };
  }
  return null;
}

function monthBudget() {
  const specific = state.budgetsByMonth[state.selectedMonth];
  const raw = specific != null && specific !== "" ? specific : state.monthlyBudget;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function signedAmount(e) {
  return e.type === "income" ? -e.amount : e.amount;
}

function monthEntries(month = state.selectedMonth) {
  return LedgerCore.monthEntries(state.entries, month);
}

function toast(message, actionLabel, action) {
  const el = document.getElementById("toast");
  el.hidden = false;
  el.innerHTML = "";
  const span = document.createElement("span");
  span.textContent = message;
  el.appendChild(span);
  if (actionLabel && action) {
    const btn = document.createElement("button");
    btn.className = "link";
    btn.textContent = actionLabel;
    btn.style.border = "0";
    btn.style.background = "none";
    btn.style.color = "var(--accent)";
    btn.onclick = () => {
      action();
      hideToast();
    };
    el.appendChild(btn);
  }
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, 5000);
}

function hideToast() {
  document.getElementById("toast").hidden = true;
}

function setBanner(text) {
  const el = document.getElementById("banner");
  const label = document.getElementById("banner-text");
  el.hidden = !text;
  if (label) label.textContent = text || "";
  else el.textContent = text || "";
}

function fillSelect(el, items, withAll) {
  const cur = el.value;
  el.innerHTML = "";
  if (withAll) {
    const o = document.createElement("option");
    o.value = "all";
    o.textContent = withAll;
    el.appendChild(o);
  }
  for (const item of items) {
    const o = document.createElement("option");
    o.value = item;
    o.textContent = item;
    el.appendChild(o);
  }
  if ([...el.options].some((o) => o.value === cur)) el.value = cur;
}

function nextReminderTime(from = new Date()) {
  const t = new Date(from);
  t.setHours(REMIND_HOUR, REMIND_MINUTE, 0, 0);
  if (t.getTime() <= from.getTime()) t.setDate(t.getDate() + 1);
  return t;
}

function setStatus(text, kind) {
  const el = document.getElementById("remind-status");
  el.hidden = !text;
  el.textContent = text;
  el.className = `status ${kind || ""}`;
}

function showLocalNotification() {
  const title = "Ledger";
  const body = "It is 10:30 PM. Add today’s spending.";
  if (window.Notification && Notification.permission === "granted") {
    try {
      new Notification(title, { body, tag: "daily-spend-1030" });
    } catch {
      /* ignore */
    }
  }
  if (navigator.serviceWorker) {
    navigator.serviceWorker.getRegistration().then((reg) => {
      if (reg) reg.showNotification(title, { body, tag: "daily-spend-1030" });
    });
  }
}

function scheduleInPageReminder() {
  if (remindTimer) clearTimeout(remindTimer);
  if (!state.remindEnabled) return;
  const delay = Math.max(1000, nextReminderTime().getTime() - Date.now());
  remindTimer = setTimeout(() => {
    const stamp = todayIso();
    if (state.lastRemindDate !== stamp) {
      state.lastRemindDate = stamp;
      saveState();
      showLocalNotification();
    }
    scheduleInPageReminder();
  }, delay);
}

async function enableReminders() {
  if (!("Notification" in window)) {
    setStatus("This browser cannot show alerts. The Windows 10:30 PM task still can.", "warn");
    return false;
  }
  let perm = Notification.permission;
  if (perm === "default") perm = await Notification.requestPermission();
  if (perm !== "granted") {
    setStatus("Permission denied. The Windows task can still alert you at 10:30 PM.", "warn");
    return false;
  }
  scheduleInPageReminder();
  setStatus(`Next in-app reminder: ${nextReminderTime().toLocaleString()}.`, "ok");
  return true;
}

function disableReminders() {
  if (remindTimer) clearTimeout(remindTimer);
  remindTimer = null;
  setStatus("In-app reminder off.", "warn");
}

function openModal(preset) {
  editingId = preset?.id || null;
  document.getElementById("modal-title").textContent = editingId ? "Edit entry" : "Add expense";
  document.getElementById("date").value = preset?.date || state.selectedDate || todayIso();
  document.getElementById("amount").value = preset?.amount != null ? String(preset.amount) : "";
  document.getElementById("category").value = pickNamed(
    categories(),
    preset?.category || state.lastCategory,
    "Food",
  );
  document.getElementById("method").value = pickNamed(methods(), preset?.method || state.lastMethod, "Cash");
  document.getElementById("entry-type").value = preset?.type || "expense";
  document.getElementById("note").value = preset?.note || "";
  document.getElementById("save-template").checked = false;
  document.getElementById("make-recurring").checked = !!preset?.recurringId;
  document.getElementById("modal-duplicate").hidden = !editingId;
  document.getElementById("dup-warn").hidden = true;
  fillNoteSuggest();
  renderTemplateChips();
  renderAmountChips();
  document.getElementById("entry-modal").showModal();
  document.getElementById("amount").focus();
  modalSnap = snapshotModal();
}

function snapshotModal() {
  return [
    document.getElementById("date").value,
    document.getElementById("amount").value,
    document.getElementById("category").value,
    document.getElementById("method").value,
    document.getElementById("entry-type").value,
    document.getElementById("note").value,
    String(document.getElementById("save-template").checked),
    String(document.getElementById("make-recurring").checked),
  ].join("\0");
}

function closeModal(force) {
  const dialog = document.getElementById("entry-modal");
  if (!force && dialog.open && snapshotModal() !== modalSnap) {
    if (!window.confirm("Discard this entry?")) return false;
  }
  dialog.close();
  editingId = null;
  saveEntryFromForm._force = false;
  return true;
}

function monthSummaryText() {
  const list = monthEntries();
  const spent = expenseTotal(list);
  const income = incomeTotal(list);
  const cats = new Map();
  for (const e of list) {
    if (e.type === "income") continue;
    cats.set(e.category, (cats.get(e.category) || 0) + e.amount);
  }
  const top = [...cats.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  const lines = [
    `Ledger · ${monthLabel(state.selectedMonth)}`,
    `Spent ${formatMoney(spent)}`,
    income ? `Income ${formatMoney(income)}` : "",
    `Net ${formatMoney(spent - income)}`,
    top.length ? `Top: ${top.map(([n, v]) => `${n} ${formatMoney(v)}`).join(", ")}` : "",
  ].filter(Boolean);
  return lines.join("\n");
}

async function copyMonthSummary() {
  try {
    await navigator.clipboard.writeText(monthSummaryText());
    toast("Month summary copied");
  } catch {
    toast("Could not copy — select and copy from Insights");
  }
}

function nudgeAmount(dir, ev) {
  const el = document.getElementById("amount");
  const taka = state.currency === "৳";
  const step = ev && ev.shiftKey ? (taka ? 100 : 10) : taka ? 10 : 1;
  const n = Number.parseFloat(el.value);
  const base = Number.isFinite(n) ? n : 0;
  el.value = String(Math.max(0, Math.round((base + dir * step) * 100) / 100));
  el.focus();
}

function saveEntryFromForm() {
  if (saveEntryFromForm._busy) return false;
  saveEntryFromForm._busy = true;
  try {
  const amount = Number.parseFloat(document.getElementById("amount").value);
  const date = document.getElementById("date").value;
  if (!Number.isFinite(amount) || amount <= 0 || !date) return false;
  const payload = {
    id: editingId || newId(),
    date,
    amount: Math.round(amount * 100) / 100,
    category: document.getElementById("category").value,
    method: document.getElementById("method").value,
    type: document.getElementById("entry-type").value,
    note: document.getElementById("note").value.trim(),
    updatedAt: Date.now(),
    deleted: false,
    recurringId: existingRecurring(),
  };
  const dup = LedgerCore.duplicateOf(state.entries, payload);
  const warn = document.getElementById("dup-warn");
  if (dup && !editingId) {
    warn.hidden = false;
    warn.textContent = `Looks like a duplicate of ${dup.note || dup.category} on ${formatIsoDate(dup.date)}. Save again to keep both.`;
    if (!saveEntryFromForm._force) {
      saveEntryFromForm._force = true;
      return false;
    }
  } else if (!editingId && date > todayIso()) {
    warn.hidden = false;
    warn.textContent = "That date is in the future. Save again if you meant to pre-log it.";
    if (!saveEntryFromForm._force) {
      saveEntryFromForm._force = true;
      return false;
    }
  }
  saveEntryFromForm._force = false;
  if (editingId) {
    state.entries = state.entries.map((e) => (e.id === editingId ? payload : e));
    toast("Entry updated");
  } else {
    state.entries.unshift(payload);
    toast("Expense saved", "Undo", () => undoLastSave(payload.id));
  }
  if (document.getElementById("save-template").checked) {
    state.templates.unshift({
      id: newId(),
      amount: payload.amount,
      category: payload.category,
      method: payload.method,
      type: payload.type,
      note: payload.note,
      updatedAt: Date.now(),
      deleted: false,
    });
    state.templates = state.templates.slice(0, 12);
  }
  state.selectedMonth = date.slice(0, 7);
  state.selectedDate = date;
  state.lastCategory = payload.category;
  state.lastMethod = payload.method;
  saveState();
  return true;
  } finally {
    saveEntryFromForm._busy = false;
  }
}

function restoreUndo() {
  if (!undo) return;
  const live = state.entries.find((e) => e.id === undo.id);
  if (live) {
    live.deleted = false;
    live.updatedAt = Date.now();
  } else {
    state.entries.unshift({ ...undo, updatedAt: Date.now() });
  }
  undo = null;
  saveState();
  render();
}

function undoLastSave(id) {
  const live = state.entries.find((e) => e.id === id);
  if (!live || live.deleted) return;
  live.deleted = true;
  live.updatedAt = Date.now();
  saveState();
  render();
}

function removeEntry(id) {
  const found = state.entries.find((e) => e.id === id);
  if (!found) return;
  found.deleted = true;
  found.updatedAt = Date.now();
  undo = { ...found, deleted: false };
  saveState();
  render();
  toast("Entry removed", "Undo", restoreUndo);
}

function applyTemplate(t) {
  openModal({
    date: state.selectedDate || todayIso(),
    amount: t.amount,
    category: t.category,
    method: t.method,
    type: t.type,
    note: t.note,
  });
}

function existingRecurring() {
  const checked = document.getElementById("make-recurring").checked;
  if (!checked) return "";
  if (editingId) {
    const live = state.entries.find((e) => e.id === editingId);
    if (live && live.recurringId) return live.recurringId;
  }
  return newId();
}

function fillNoteSuggest() {
  const list = document.getElementById("note-suggest");
  const seen = new Set();
  const notes = [];
  for (const e of state.entries) {
    const n = (e.note || "").trim();
    if (!n || seen.has(n.toLowerCase())) continue;
    seen.add(n.toLowerCase());
    notes.push(n);
    if (notes.length >= 40) break;
  }
  list.innerHTML = notes.map((n) => `<option value="${escapeHtml(n)}"></option>`).join("");
}

function refreshCategorySelects() {
  fillSelect(document.getElementById("category"), categories());
  fillSelect(document.getElementById("filter-category"), categories(), "All categories");
  fillSelect(document.getElementById("method"), methods());
  fillSelect(document.getElementById("filter-method"), methods(), "All methods");
}

function lastLiveExpense() {
  return state.entries.find((e) => !e.deleted && e.type !== "income");
}

function repeatLast() {
  const last = lastLiveExpense();
  if (!last) {
    toast("Nothing to repeat yet");
    return;
  }
  openModal({
    date: state.selectedDate || todayIso(),
    amount: last.amount,
    category: last.category,
    method: last.method,
    type: last.type,
    note: last.note,
    recurringId: last.recurringId,
  });
}

function skipPendingRecurring() {
  const pending = LedgerCore.pendingRecurring(state.entries, state.selectedMonth, state.recurringSkipped);
  if (!state.recurringSkipped) state.recurringSkipped = {};
  for (const src of pending) {
    const list = state.recurringSkipped[src.recurringId] || [];
    if (!list.includes(state.selectedMonth)) list.push(state.selectedMonth);
    state.recurringSkipped[src.recurringId] = list;
  }
  bumpMeta();
  saveState();
  render();
  toast("Skipped repeats for this month");
}

function applyPendingRecurring() {
  const pending = LedgerCore.pendingRecurring(state.entries, state.selectedMonth, state.recurringSkipped);
  for (const src of pending) {
    const copy = LedgerCore.copyRecurring(src, state.selectedMonth);
    state.entries.unshift({
      ...copy,
      id: newId(),
      updatedAt: Date.now(),
      deleted: false,
    });
  }
  if (pending.length) {
    toast(`Added ${pending.length} recurring charge${pending.length === 1 ? "" : "s"}`);
    saveState();
    render();
  }
}

function filteredLedger() {
  return LedgerCore.filterLedger(state.entries, {
    month: state.selectedMonth,
    search: state.search,
    allMonths: state.searchAllMonths,
    filterCategory: state.filterCategory,
    filterMethod: state.filterMethod,
    filterType: state.filterType,
    sortKey: state.sortKey,
    sortDir: state.sortDir,
  });
}

function loggingStreak() {
  return LedgerCore.loggingStreak(state.entries, todayIso());
}

function renderAmountChips() {
  const box = document.getElementById("amount-chips");
  if (!box) return;
  const amounts = LedgerCore.suggestAmounts(state.entries);
  box.innerHTML = amounts
    .map((n) => `<button type="button" class="chip" data-amt-chip="${n}">${formatMoney(n)}</button>`)
    .join("");
}

function renderTemplateChips() {
  const box = document.getElementById("quick-templates");
  const recent = [];
  const seen = new Set();
  for (const t of state.templates) {
    if (t.deleted) continue;
    const key = `${t.note}|${t.amount}|${t.category}`;
    if (seen.has(key)) continue;
    seen.add(key);
    recent.push(t);
  }
  for (const e of state.entries) {
    if (!e.note) continue;
    const key = `${e.note}|${e.amount}|${e.category}`;
    if (seen.has(key)) continue;
    seen.add(key);
    recent.push(e);
    if (recent.length >= 8) break;
  }
  box.innerHTML = recent
    .map(
      (t) =>
        `<button type="button" class="chip" data-tpl="${t.id || ""}" data-note="${encodeURIComponent(t.note)}" data-amt="${t.amount}" data-cat="${t.category}" data-method="${t.method || "Cash"}" data-type="${t.type || "expense"}">${escapeHtml(t.note || t.category)} · ${formatMoney(t.amount)}</button>`,
    )
    .join("");
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderKpis() {
  const list = monthEntries();
  const spent = expenseTotal(list);
  const income = incomeTotal(list);
  const net = spent - income;
  const today = todayIso();
  const todayList = state.entries.filter((e) => !e.deleted && e.date === today);
  const todaySpent = expenseTotal(todayList);
  const prefix = `${state.selectedMonth}-`;
  let elapsed = 0;
  if (today.startsWith(prefix)) elapsed = Number(today.slice(8, 10));
  else if (today > `${prefix}01`) elapsed = daysInMonth(...state.selectedMonth.split("-").map(Number));
  const avg = elapsed > 0 ? spent / elapsed : 0;
  const budget = monthBudget();
  const remaining = budget ? budget - net : 0;
  const prev = monthEntries(shiftMonth(state.selectedMonth, -1));
  const prevNet = netSpend(prev);
  const delta = prevNet > 0 ? ((net - prevNet) / prevNet) * 100 : null;
  let remainTone = "";
  if (budget) remainTone = remaining < 0 ? "danger" : remaining < budget * 0.2 ? "warn" : "ok";

  const yestSpent = expenseTotal(
    state.entries.filter((e) => !e.deleted && e.date === LedgerCore.shiftIso(today, -1)),
  );
  document.getElementById("kpis").innerHTML = `
    <div class="kpi"><div class="value">${formatMoney(spent)}</div><div class="label">Spent · ${monthLabel(state.selectedMonth)}</div>${delta != null ? `<div class="delta">${delta >= 0 ? "+" : ""}${delta.toFixed(0)}% vs last month</div>` : ""}</div>
    <div class="kpi"><div class="value">${formatMoney(today.startsWith(prefix) ? todaySpent : 0)}</div><div class="label">Spent today</div><div class="delta">${loggingStreak()} day streak · yesterday ${formatMoney(yestSpent)}</div></div>
    <div class="kpi"><div class="value">${formatMoney(LedgerCore.trailingSpend(state.entries, today, 7))}</div><div class="label">Last 7 days</div><div class="delta">${formatMoney(avg)} / day this month</div></div>
    <div class="kpi ${remainTone}"><div class="value">${budget ? formatMoney(remaining) : formatMoney(net)}</div><div class="label">${budget ? "Budget remaining" : "Net spend"}</div>${income ? `<div class="delta">${formatMoney(income)} in refunds</div>` : ""}</div>
  `;
  renderWallets();
}

function renderWallets() {
  const el = document.getElementById("wallets");
  if (!el) return;
  const rows = LedgerCore.walletSnapshot(state.entries, state.selectedMonth, state.startingBalances);
  if (!rows.length) {
    el.hidden = true;
    el.innerHTML = "";
    return;
  }
  el.hidden = false;
  el.innerHTML = rows
    .map((row) => {
      const value = row.hasSeed ? row.remaining : row.net;
      const label = row.hasSeed ? `${row.name} left` : `${row.name} spent`;
      const tone = row.hasSeed && row.remaining < 0 ? "danger" : "";
      return `<button type="button" class="wallet ${tone}" data-method="${escapeHtml(row.name)}"><span>${escapeHtml(label)}</span><strong>${formatMoney(value)}</strong></button>`;
    })
    .join("");
}

function renderBudgetBar() {
  const list = monthEntries();
  const net = netSpend(list);
  const budget = monthBudget();
  const bar = document.getElementById("budget-bar");
  if (!budget) {
    bar.hidden = true;
    return;
  }
  bar.hidden = false;
  const pct = Math.round((net / budget) * 100);
  document.getElementById("budget-left").textContent = `${pct}% of monthly budget`;
  document.getElementById("budget-right").textContent = `${formatMoney(net)} / ${formatMoney(budget)}`;
  const fill = document.getElementById("budget-fill");
  fill.style.width = `${Math.min(100, Math.max(0, pct))}%`;
  fill.classList.toggle("over", net > budget);
  const track = document.getElementById("budget-track");
  if (track) {
    track.setAttribute("aria-valuenow", String(Math.min(100, Math.max(0, pct))));
    track.setAttribute("aria-label", `${pct} percent of monthly budget used`);
  }
  const [y, m] = state.selectedMonth.split("-").map(Number);
  const days = daysInMonth(y, m);
  const today = todayIso();
  const elapsed = today.startsWith(`${state.selectedMonth}-`) ? Number(today.slice(8, 10)) : days;
  const expected = (budget / days) * elapsed;
  const vsPace = net - expected;
  document.getElementById("pace-note").textContent =
    (vsPace > 0
      ? `${formatMoney(vsPace)} ahead of even daily pace.`
      : `${formatMoney(-vsPace)} under even daily pace.`) +
    ` Projected month-end: ${formatMoney(LedgerCore.forecastMonthEnd(net, state.selectedMonth, todayIso()).projected)}.`;
}

function renderCalendar() {
  const [year, month] = state.selectedMonth.split("-").map(Number);
  const dayCount = daysInMonth(year, month);
  const list = monthEntries();
  const daily = new Map();
  const counts = new Map();
  for (let d = 1; d <= dayCount; d++) {
    daily.set(d, 0);
    counts.set(d, 0);
  }
  for (const e of list) {
    const day = Number(e.date.slice(8, 10));
    daily.set(day, (daily.get(day) || 0) + signedAmount(e));
    counts.set(day, (counts.get(day) || 0) + 1);
  }
  const today = todayIso();
  const cap = Number.parseFloat(state.dailyCap);
  const hasCap = Number.isFinite(cap) && cap > 0;
  const first = LedgerCore.gridOffset(new Date(year, month - 1, 1).getDay(), state.weekStart);
  let html = LedgerCore.rotateWeekdays(WEEKDAYS, state.weekStart).map((w) => `<div class="dow">${w}</div>`).join("");
  for (let i = 0; i < first; i++) html += `<div></div>`;
  for (let d = 1; d <= dayCount; d++) {
    const iso = `${state.selectedMonth}-${pad2(d)}`;
    const total = daily.get(d) || 0;
    const cls = ["day"];
    if (iso === today) cls.push("today");
    if (iso === state.selectedDate) cls.push("selected");
    if (iso > today) cls.push("future");
    if (hasCap && total > cap) cls.push("over");
    const n = counts.get(d) || 0;
    html += `<button type="button" class="${cls.join(" ")}" data-iso="${iso}" role="gridcell" aria-pressed="${iso === state.selectedDate}" aria-label="${iso}, ${total ? formatMoney(total) : "no spend"}">
      <span class="n">${d}</span>
      <span class="amt ${total ? "" : "empty"}">${total ? formatMoney(total) : "—"}</span>
      <span class="count">${n ? `${n}` : ""}</span>
    </button>`;
  }
  document.getElementById("calendar").innerHTML = html;
  document.getElementById("cal-title").textContent = monthLabel(state.selectedMonth);
  const selectedDay = document.querySelector("#calendar .day.selected");
  if (calendarFollow && state.view === "overview" && selectedDay) {
    selectedDay.scrollIntoView({ block: "nearest", inline: "nearest" });
    calendarFollow = false;
  }
}

function renderDayPanel() {
  const iso = state.selectedDate;
  const items = state.entries.filter((e) => !e.deleted && e.date === iso).sort((a, b) => b.id.localeCompare(a.id));
  const spent = expenseTotal(items);
  const income = incomeTotal(items);
  const net = spent - income;
  const pretty = iso
    ? new Date(`${iso}T12:00:00`).toLocaleDateString(uiLocale(), {
        weekday: "long",
        month: "long",
        day: "numeric",
      })
    : "Select a day";
  document.getElementById("day-panel-title").textContent = pretty;
  document.getElementById("day-panel-total").textContent = formatMoney(net);
  document.getElementById("day-panel-total").title = income
    ? `${formatMoney(spent)} spent · ${formatMoney(income)} in`
    : "";
  const capNote = document.getElementById("day-cap-note");
  if (capNote) {
    const left = LedgerCore.dailyCapLeft(state.dailyCap, spent);
    if (left == null) {
      capNote.hidden = true;
      capNote.textContent = "";
    } else {
      capNote.hidden = false;
      capNote.textContent =
        left >= 0 ? `${formatMoney(left)} left on the daily cap.` : `${formatMoney(-left)} over the daily cap.`;
      capNote.className = left >= 0 ? "caption" : "caption over-cap";
    }
  }
  document.getElementById("day-panel-list").innerHTML = items.length
    ? items
        .map(
          (e) => `<li>
            <div>
              <button type="button" class="link" data-edit="${e.id}">${highlightQuery(e.note || e.category, state.search)}</button>
              <div class="meta">${e.category} · ${e.method}${e.type === "income" ? " · refund" : ""}</div>
            </div>
            <div class="${e.type === "income" ? "income" : ""}">${e.type === "income" ? "+" : ""}${formatMoney(e.amount)}</div>
          </li>`,
        )
        .join("")
    : `<li><div class="meta">Nothing logged. Add the first purchase for this day.</div></li>`;
}

function filtersActive() {
  return !!(
    (state.search || "").trim() ||
    state.filterCategory !== "all" ||
    state.filterMethod !== "all" ||
    state.filterType !== "all" ||
    state.searchAllMonths
  );
}

function clearFilters() {
  state.search = "";
  state.filterCategory = "all";
  state.filterMethod = "all";
  state.filterType = "all";
  state.searchAllMonths = false;
  saveState();
  render();
}

function renderSortHeaders() {
  for (const btn of document.querySelectorAll("#view-ledger [data-sort]")) {
    const on = btn.dataset.sort === state.sortKey;
    const label = btn.dataset.label || btn.dataset.sort;
    btn.setAttribute("aria-sort", on ? (state.sortDir === "asc" ? "ascending" : "descending") : "none");
    btn.textContent = on ? `${label} ${state.sortDir === "asc" ? "↑" : "↓"}` : label;
  }
}

function renderLedger() {
  const rows = filteredLedger();
  const spent = expenseTotal(rows);
  document.getElementById("ledger-meta").textContent = `${rows.length} rows · ${formatMoney(spent)} expenses in view${state.searchAllMonths ? " · all months" : ""}`;
  const tableHtml = rows
    .map(
      (e) => `<tr data-id="${e.id}">
        <td title="${e.date}">${formatIsoDate(e.date)}</td>
        <td><span class="tag">${e.category}</span></td>
        <td>${e.method}</td>
        <td>${highlightQuery(e.note || "—", state.search)}</td>
        <td class="num ${e.type === "income" ? "income" : ""}">${e.type === "income" ? "+" : ""}${formatMoney(e.amount)}</td>
        <td><button type="button" class="icon" data-del="${e.id}" aria-label="Remove ${escapeHtml(e.note || e.category)}">×</button></td>
      </tr>`,
    )
    .join("");
  document.getElementById("purchases").innerHTML = rows.length
    ? tableHtml
    : `<tr><td colspan="6" class="empty-row">No matching rows. Clear filters or add an expense.</td></tr>`;
  document.getElementById("ledger-cards").innerHTML = rows.length
    ? rows
        .map(
          (e) => `<li data-id="${e.id}">
        <button type="button" class="link" data-edit="${e.id}">${highlightQuery(e.note || e.category, state.search)}</button>
        <div class="amt ${e.type === "income" ? "income" : ""}">${e.type === "income" ? "+" : ""}${formatMoney(e.amount)}</div>
        <div class="sub">${formatIsoDate(e.date)} · ${e.category} · ${e.method}</div>
        <button type="button" class="icon" data-del="${e.id}" aria-label="Remove ${escapeHtml(e.note || e.category)}">×</button>
      </li>`,
        )
        .join("")
    : `<li class="empty-card"><div class="meta">No matching rows. Clear filters or add an expense.</div></li>`;
  const clearBtn = document.getElementById("clear-filters");
  if (clearBtn) clearBtn.hidden = !filtersActive();
  renderSortHeaders();
}

function renderInsights() {
  const list = monthEntries();
  const [year, month] = state.selectedMonth.split("-").map(Number);
  const dayCount = daysInMonth(year, month);
  const daily = new Map();
  for (let d = 1; d <= dayCount; d++) daily.set(d, 0);
  let weekend = 0;
  let weekday = 0;
  for (const e of list) {
    if (e.type === "income") continue;
    const day = Number(e.date.slice(8, 10));
    daily.set(day, (daily.get(day) || 0) + e.amount);
    const wd = new Date(`${e.date}T12:00:00`).getDay();
    if (wd === 0 || wd === 6) weekend += e.amount;
    else weekday += e.amount;
  }
  const spent = expenseTotal(list);
  const maxDay = Math.max(...daily.values(), 1);
  const cap = Number.parseFloat(state.dailyCap);
  document.getElementById("day-caption").textContent = `Daily expense totals · ${monthLabel(state.selectedMonth)}`;
  document.getElementById("day-chart").innerHTML = Array.from({ length: dayCount }, (_, i) => {
    const v = daily.get(i + 1) || 0;
    const h = v > 0 ? Math.max(3, (v / maxDay) * 128) : 0;
    const over = Number.isFinite(cap) && cap > 0 && v > cap;
    return `<div class="col" title="Day ${i + 1}: ${formatMoney(v)}"><div class="bar ${over ? "over" : ""}" style="height:${h}px"></div><div class="lbl">${i + 1}</div></div>`;
  }).join("");

  const cats = new Map();
  const methods = new Map();
  for (const e of list) {
    if (e.type === "income") continue;
    cats.set(e.category, (cats.get(e.category) || 0) + e.amount);
    methods.set(e.method, (methods.get(e.method) || 0) + e.amount);
  }
  const ranked = [...cats.entries()].sort((a, b) => b[1] - a[1]);
  const catMax = ranked[0]?.[1] || 1;
  document.getElementById("cat-list").innerHTML = ranked.length
    ? ranked
        .map(([name, value]) => {
          const capN = Number.parseFloat(state.categoryCaps[name]);
          let cls = "fill";
          let extra = "";
          if (Number.isFinite(capN) && capN > 0) {
            extra = ` / ${formatMoney(capN)}`;
            if (value > capN) cls += " over";
            else if (value > capN * 0.8) cls += " warn";
          }
          return `<div class="cat-row"><div>${name}</div><div class="track"><div class="${cls}" style="width:${(value / catMax) * 100}%"></div></div><div class="num">${formatMoney(value)}${extra}</div></div>`;
        })
        .join("")
    : `<p class="caption">No expenses this month yet.</p>`;

  const mRanked = [...methods.entries()].sort((a, b) => b[1] - a[1]);
  const mMax = mRanked[0]?.[1] || 1;
  document.getElementById("method-list").innerHTML = mRanked.length
    ? mRanked
        .map(
          ([name, value]) =>
            `<div class="method-row cat-row"><div>${name}</div><div class="track"><div class="fill" style="width:${(value / mMax) * 100}%"></div></div><div class="num">${formatMoney(value)}</div></div>`,
        )
        .join("")
    : `<p class="caption">No expenses this month yet.</p>`;

  const splitMax = Math.max(weekend, weekday, 1);
  document.getElementById("week-split").innerHTML = `
    <div class="cat-row"><div>Weekdays</div><div class="track"><div class="fill" style="width:${(weekday / splitMax) * 100}%"></div></div><div class="num">${formatMoney(weekday)}</div></div>
    <div class="cat-row"><div>Weekend</div><div class="track"><div class="fill" style="width:${(weekend / splitMax) * 100}%"></div></div><div class="num">${formatMoney(weekend)}</div></div>
  `;

  const daysLogged = new Set(list.map((e) => e.date)).size;
  const forecast = LedgerCore.forecastMonthEnd(spent, state.selectedMonth, todayIso());
  document.getElementById("insight-kpis").innerHTML = `
    <div class="kpi"><div class="value">${formatMoney(spent)}</div><div class="label">Expenses</div></div>
    <div class="kpi"><div class="value">${daysLogged}</div><div class="label">Days with activity</div></div>
    <div class="kpi"><div class="value">${formatMoney(forecast.projected)}</div><div class="label">Projected month-end</div></div>
    <div class="kpi"><div class="value">${formatMoney(incomeTotal(list))}</div><div class="label">Refunds / income</div></div>
  `;

  const trend = LedgerCore.monthTrend(state.entries, state.selectedMonth, 6);
  const tMax = Math.max(...trend.map((t) => t.spent), 1);
  const trendEl = document.getElementById("trend-chart");
  if (trendEl) {
    trendEl.innerHTML = trend
      .map((t) => {
        const h = t.spent > 0 ? Math.max(4, (t.spent / tMax) * 128) : 0;
        const label = t.month.slice(5);
        return `<div class="col" title="${t.month}: ${formatMoney(t.spent)}"><div class="bar" style="height:${h}px"></div><div class="lbl">${label}</div></div>`;
      })
      .join("");
  }

  const merchants = new Map();
  for (const e of list) {
    if (e.type === "income") continue;
    const key = LedgerCore.merchantKey(e.note) || e.category;
    merchants.set(key, (merchants.get(key) || 0) + e.amount);
  }
  const topMerch = [...merchants.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  const unusual = LedgerCore.unusualDays(daily, 2).slice(0, 3);
  const prevSpent = expenseTotal(monthEntries(shiftMonth(state.selectedMonth, -1)));
  const notes = [];
  if (forecast.projected && monthBudget() && forecast.projected > monthBudget()) {
    notes.push(`On this pace you will overshoot the ${formatMoney(monthBudget())} budget.`);
  }
  if (prevSpent > 0) {
    const dlt = ((spent - prevSpent) / prevSpent) * 100;
    notes.push(`${dlt >= 0 ? "+" : ""}${dlt.toFixed(0)}% vs ${monthLabel(shiftMonth(state.selectedMonth, -1))}.`);
  }
  for (const [day, amt] of unusual) {
    notes.push(`Day ${day} was unusually high at ${formatMoney(amt)}.`);
  }
  if (topMerch[0]) notes.push(`Largest note cluster: ${topMerch[0][0]} (${formatMoney(topMerch[0][1])}).`);
  const smart = document.getElementById("smart-notes");
  if (smart) {
    smart.innerHTML = notes.length
      ? notes.map((n) => `<li><div>${escapeHtml(n)}</div></li>`).join("")
      : `<li><div class="meta">Log a few more days and this panel will call out pace, spikes, and repeats.</div></li>`;
  }
}

function renderSettings() {
  document.getElementById("budget").value = state.budgetsByMonth[state.selectedMonth] ?? state.monthlyBudget;
  document.getElementById("daily-cap").value = state.dailyCap;
  document.getElementById("currency").value = state.currency;
  document.getElementById("week-start").value = String(state.weekStart ?? 6);
  document.getElementById("date-locale").value = state.locale === "en-US" ? "en-US" : "bn-BD";
  document.getElementById("theme-light").checked = state.theme === "light";
  document.getElementById("density-compact").checked = state.density === "compact";
  document.getElementById("remind-enabled").checked = !!state.remindEnabled;
  document.getElementById("sync-enabled").checked = !!state.syncEnabled;
  document.getElementById("sync-url").value = state.syncUrl || "";
  document.getElementById("sync-code").value = pairingCode();
  document.getElementById("pin-clear").hidden = !state.pinHash;
  document.getElementById("idle-lock-min").value = state.idleLockMinutes ?? 5;
  const templates = state.templates.filter((t) => !t.deleted);
  document.getElementById("cat-caps").innerHTML = categories().map(
    (c) =>
      `<label>${c}<input type="number" min="0" data-cap="${c}" placeholder="no cap" value="${state.categoryCaps[c] || ""}" /></label>`,
  ).join("");
  const starts = document.getElementById("wallet-starts");
  if (starts) {
    starts.innerHTML = methods()
      .map(
        (m) =>
          `<label>${m}<input type="number" min="0" data-wallet="${m}" placeholder="on hand" value="${state.startingBalances[m] || ""}" /></label>`,
      )
      .join("");
  }
  document.getElementById("template-list").innerHTML = templates.length
    ? templates
        .map(
          (t) => `<li>
            <div>
              <button type="button" class="link" data-use-tpl="${t.id}">${escapeHtml(t.note || t.category)} · ${formatMoney(t.amount)}</button>
              <div class="meta">${t.category} · ${t.method}</div>
            </div>
            <button type="button" class="icon" data-del-tpl="${t.id}" aria-label="Remove template">×</button>
          </li>`,
        )
        .join("")
    : `<li><div class="meta">Save an entry as a template from the add dialog.</div></li>`;
  renderSyncStatus();
}

function render() {
  document.documentElement.dataset.theme = state.theme === "light" ? "light" : "dark";
  document.documentElement.lang = uiLocale() === "bn-BD" ? "bn" : "en";
  document.documentElement.dataset.density = state.density === "compact" ? "compact" : "comfortable";
  document.querySelector('meta[name="theme-color"]').content = state.theme === "light" ? "#f4f2ee" : "#0f1114";
  document.getElementById("month-btn").textContent = monthLabel(state.selectedMonth);
  document.title = `Ledger · ${formatMoney(expenseTotal(monthEntries()))} · ${monthLabel(state.selectedMonth)}`;
  const monthPick = document.getElementById("month-pick");
  if (monthPick) monthPick.value = state.selectedMonth;
  const hash = `#${state.view}`;
  if (location.hash !== hash) history.replaceState(null, "", hash);
  refreshCategorySelects();
  renderSyncStatus();
  for (const tab of document.querySelectorAll("[data-view]")) {
    const on = tab.dataset.view === state.view;
    tab.classList.toggle("active", on);
    if (tab.classList.contains("tab") || tab.classList.contains("dock-btn")) {
      if (on) tab.setAttribute("aria-current", "page");
      else tab.removeAttribute("aria-current");
    }
  }
  for (const view of ["overview", "ledger", "insights", "settings"]) {
    document.getElementById(`view-${view}`).hidden = state.view !== view;
  }
  document.getElementById("search").value = state.search;
  document.getElementById("filter-category").value = state.filterCategory;
  document.getElementById("filter-method").value = state.filterMethod;
  document.getElementById("filter-type").value = state.filterType;
  const allMonths = document.getElementById("search-all");
  if (allMonths) allMonths.checked = !!state.searchAllMonths;

  const today = todayIso();
  const liveCount = state.entries.filter((e) => !e.deleted).length;
  const emptyHero = document.getElementById("empty-books");
  if (emptyHero) emptyHero.hidden = liveCount > 0;
  const kpis = document.getElementById("kpis");
  if (kpis) kpis.hidden = liveCount === 0;
  const loggedToday = state.entries.some((e) => !e.deleted && e.date === today && e.type !== "income");
  const hideNag = liveCount === 0 || loggedToday || state.nagDismissedDate === today;
  setBanner(hideNag ? "" : "Nothing logged today. Add purchases as they happen so 10:30 PM is only a backup.");
  const pending = LedgerCore.pendingRecurring(state.entries, state.selectedMonth, state.recurringSkipped);
  const recBar = document.getElementById("recurring-bar");
  if (recBar) {
    recBar.hidden = pending.length === 0;
    document.getElementById("recurring-text").textContent = pending.length
      ? `${pending.length} monthly repeat${pending.length === 1 ? "" : "s"} from earlier months can be copied into ${monthLabel(state.selectedMonth)}.`
      : "";
  }

  renderKpis();
  renderBudgetBar();
  renderCalendar();
  renderDayPanel();
  renderLedger();
  renderInsights();
  renderSettings();
}

function exportCsv() {
  const rows = filteredLedger();
  const header = ["date", "type", "category", "method", "note", "amount"];
  const lines = [header.join(",")].concat(
    rows.map((e) =>
      [e.date, e.type, e.category, e.method, `"${String(e.note).replace(/"/g, '""')}"`, e.amount].join(","),
    ),
  );
  download(`ledger-${state.selectedMonth}.csv`, lines.join("\n"), "text/csv");
}

function exportJson() {
  const dump = { ...state };
  dump.pinHash = "";
  if (!document.getElementById("export-pairing")?.checked) {
    dump.syncSecret = "";
    dump.syncId = "";
    dump.syncUrl = dump.syncUrl;
  }
  download(`ledger-backup-${todayIso()}.json`, JSON.stringify(dump, null, 2), "application/json");
}

async function hashPin(pin) {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`ledger-pin:${state.deviceId}:${pin}`),
  );
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function pinUnlocked() {
  if (!state.pinHash) return true;
  try {
    return sessionStorage.getItem("ledger-unlocked") === state.pinHash;
  } catch {
    return false;
  }
}

function showLockGate() {
  const gate = document.getElementById("lock-gate");
  if (!gate || pinUnlocked()) return;
  if (!gate.open) gate.showModal();
  const pin = document.getElementById("unlock-pin");
  const err = document.getElementById("unlock-error");
  if (err) {
    err.hidden = true;
    err.textContent = "";
  }
  if (pin) {
    pin.value = "";
    requestAnimationFrame(() => pin.focus());
  }
}

function hideLockGate() {
  const gate = document.getElementById("lock-gate");
  if (gate?.open) gate.close();
  armIdleLock();
}

function lockNow() {
  if (!state.pinHash) return;
  try {
    sessionStorage.removeItem("ledger-unlocked");
  } catch {
    /* ignore */
  }
  const modal = document.getElementById("entry-modal");
  if (modal?.open) closeModal(true);
  const pal = document.getElementById("palette");
  if (pal?.open) pal.close();
  showLockGate();
}

function idleLockMs() {
  const n = Number(state.idleLockMinutes);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(240, Math.max(1, n)) * 60 * 1000;
}

function armIdleLock() {
  if (idleLockTimer) clearTimeout(idleLockTimer);
  idleLockTimer = null;
  if (!state.pinHash || !pinUnlocked()) return;
  const ms = idleLockMs();
  if (!ms) return;
  idleLockTimer = setTimeout(lockNow, ms);
}

function download(name, body, type) {
  const blob = new Blob([body], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function importJson(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      const incoming = Array.isArray(data) ? data : data.entries || [];
      const byId = new Map(state.entries.map((e) => [e.id, e]));
      for (const e of incoming.map(migrateEntry)) byId.set(e.id, e);
      state.entries = [...byId.values()].sort((a, b) => b.date.localeCompare(a.date));
      if (data.monthlyBudget) state.monthlyBudget = data.monthlyBudget;
      if (data.templates) state.templates = data.templates;
      if (Array.isArray(data.customMethods)) state.customMethods = data.customMethods;
      if (Array.isArray(data.customCategories)) state.customCategories = data.customCategories;
      saveState();
      render();
      toast(`Imported ${incoming.length} entries`);
    } catch {
      toast("Could not read that file");
    }
  };
  reader.readAsText(file);
}

function renderSyncStatus() {
  const el = document.getElementById("sync-status");
  const detail = document.getElementById("sync-detail");
  if (!state.syncEnabled) {
    el.textContent = navigator.onLine ? "On this device" : "Offline";
    if (detail) detail.textContent = "Turn on sync and paste the same pairing code on your phone and computer.";
    return;
  }
  if (!navigator.onLine) {
    el.textContent = "Offline — will sync later";
    if (detail) detail.textContent = "Changes are saved here and will upload when the internet is back.";
    return;
  }
  if (syncBusy) {
    el.textContent = "Syncing…";
    return;
  }
  if (state.lastSyncAt) {
    el.textContent = `Synced ${new Date(state.lastSyncAt).toLocaleTimeString()}`;
    if (detail) detail.className = "status ok";
    if (detail) detail.textContent = "Phone and desktop merge automatically whenever this page can reach the server.";
  } else {
    el.textContent = "Sync ready";
    if (detail) detail.textContent = "Press Sync now, or wait — it retries on its own.";
  }
}

let syncBusy = false;
let syncTimer = null;

function scheduleSync() {
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    syncNow({ silent: true });
  }, 900);
}

function syncEndpoint() {
  const base = (state.syncUrl || (location.protocol.startsWith("http") ? location.origin : "")).replace(/\/$/, "");
  if (!base || !state.syncId) return "";
  return `${base}/api/sync/${encodeURIComponent(state.syncId)}`;
}

async function syncNow({ silent } = {}) {
  if (!state.syncEnabled || !state.syncSecret || !state.syncId) return;
  const url = syncEndpoint();
  if (!url || !navigator.onLine) {
    renderSyncStatus();
    return;
  }
  if (typeof LedgerSync === "undefined") return;
  if (syncBusy) return;
  syncBusy = true;
  renderSyncStatus();
  try {
    let remote = null;
    const res = await fetch(url, { cache: "no-store" });
    if (res.ok) {
      const pack = await res.json();
      remote = await LedgerSync.decryptJson(pack, state.syncSecret);
    } else if (res.status !== 404) {
      throw new Error("Could not reach sync server");
    }
    const local = LedgerSync.fromState(state);
    const merged = LedgerSync.mergeDocs(local, remote);
    LedgerSync.applyToState(state, merged);
    const pack = await LedgerSync.encryptJson(LedgerSync.fromState(state), state.syncSecret);
    const put = await fetch(url, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(pack),
    });
    if (!put.ok) throw new Error("Upload failed");
    state.lastSyncAt = Date.now();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    render();
    if (!silent) toast("Devices synced");
  } catch (err) {
    const detail = document.getElementById("sync-detail");
    if (detail) {
      detail.className = "status warn";
      detail.textContent = silent
        ? "Waiting for a connection to the sync server."
        : String(err.message || err);
    }
    document.getElementById("sync-status").textContent = "Sync paused";
  } finally {
    syncBusy = false;
    renderSyncStatus();
  }
}

function generatePairing() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  const secretBytes = crypto.getRandomValues(new Uint8Array(18));
  const secret = [...secretBytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  state.syncId = hex;
  state.syncSecret = secret;
  state.syncEnabled = true;
  if (!state.syncUrl && location.protocol.startsWith("http")) state.syncUrl = location.origin;
  saveState();
  render();
  return pairingCode();
}

function bind() {
  refreshCategorySelects();

  document.getElementById("prev-month").onclick = () => {
    state.selectedMonth = shiftMonth(state.selectedMonth, -1);
    state.selectedDate = `${state.selectedMonth}-01`;
    calendarFollow = true;
    saveState();
    render();
  };
  document.getElementById("next-month").onclick = () => {
    state.selectedMonth = shiftMonth(state.selectedMonth, 1);
    state.selectedDate = `${state.selectedMonth}-01`;
    calendarFollow = true;
    saveState();
    render();
  };
  document.getElementById("month-btn").onclick = () => {
    const el = document.getElementById("month-pick");
    el.value = state.selectedMonth;
    if (el.showPicker) el.showPicker();
    else el.focus();
  };
  document.getElementById("month-pick").onchange = (e) => {
    if (!e.target.value) return;
    state.selectedMonth = e.target.value;
    state.selectedDate = `${state.selectedMonth}-01`;
    calendarFollow = true;
    saveState();
    render();
  };
  document.getElementById("jump-today").onclick = () => {
    state.selectedMonth = currentMonthKey();
    state.selectedDate = todayIso();
    state.view = "overview";
    calendarFollow = true;
    saveState();
    render();
  };
  document.getElementById("open-add").onclick = () => openModal({ date: state.selectedDate || todayIso() });
  document.getElementById("empty-add").onclick = () => openModal({ date: state.selectedDate || todayIso() });
  document.getElementById("empty-sample").onclick = loadSampleEntries;
  document.getElementById("load-sample").onclick = loadSampleEntries;
  document.getElementById("fab-add").onclick = () => openModal({ date: state.selectedDate || todayIso() });
  document.getElementById("day-add").onclick = () => openModal({ date: state.selectedDate || todayIso() });
  document.getElementById("day-repeat").onclick = repeatLast;

  const onNav = (e) => {
    const tab = e.target.closest("[data-view]");
    if (!tab) return;
    state.view = tab.dataset.view;
    saveState();
    render();
  };
  document.querySelector(".tabs").onclick = onNav;
  document.querySelector(".dock").onclick = onNav;

  document.getElementById("calendar").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-iso]");
    if (!btn) return;
    state.selectedDate = btn.dataset.iso;
    calendarFollow = true;
    saveState();
    render();
  });
  document.getElementById("calendar").addEventListener("dblclick", (e) => {
    const btn = e.target.closest("[data-iso]");
    if (!btn) return;
    state.selectedDate = btn.dataset.iso;
    openModal({ date: btn.dataset.iso });
  });

  document.getElementById("day-panel-list").onclick = (e) => {
    const edit = e.target.closest("[data-edit]");
    if (edit) {
      const entry = state.entries.find((x) => x.id === edit.dataset.edit);
      if (entry) openModal(entry);
    }
  };

  document.getElementById("ledger-cards").onclick = (e) => {
    const del = e.target.closest("[data-del]");
    if (del) {
      removeEntry(del.dataset.del);
      return;
    }
    const edit = e.target.closest("[data-edit], li[data-id]");
    if (edit) {
      const id = edit.dataset.edit || edit.dataset.id;
      const entry = state.entries.find((x) => x.id === id);
      if (entry && !entry.deleted) openModal(entry);
    }
  };
  document.getElementById("purchases").onclick = (e) => {
    const del = e.target.closest("[data-del]");
    if (del) {
      e.stopPropagation();
      removeEntry(del.dataset.del);
      return;
    }
    const row = e.target.closest("tr[data-id]");
    if (row) {
      const entry = state.entries.find((x) => x.id === row.dataset.id);
      if (entry && !entry.deleted) openModal(entry);
    }
  };

  document.getElementById("search").oninput = (e) => {
    state.search = e.target.value;
    saveState();
    renderLedger();
  };
  document.getElementById("filter-category").onchange = (e) => {
    state.filterCategory = e.target.value;
    saveState();
    renderLedger();
  };
  document.getElementById("filter-method").onchange = (e) => {
    state.filterMethod = e.target.value;
    saveState();
    renderLedger();
  };
  document.getElementById("filter-type").onchange = (e) => {
    state.filterType = e.target.value;
    saveState();
    renderLedger();
  };
  document.getElementById("clear-filters").onclick = clearFilters;
  document.querySelector("#view-ledger thead").onclick = (e) => {
    const btn = e.target.closest("[data-sort]");
    if (!btn) return;
    if (state.sortKey === btn.dataset.sort) state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
    else {
      state.sortKey = btn.dataset.sort;
      state.sortDir = "desc";
    }
    saveState();
    renderLedger();
  };

  document.getElementById("budget").onchange = (e) => {
    state.budgetsByMonth[state.selectedMonth] = e.target.value;
    state.monthlyBudget = e.target.value;
    bumpMeta();
    saveState();
    render();
  };
  document.getElementById("daily-cap").onchange = (e) => {
    state.dailyCap = e.target.value;
    bumpMeta();
    saveState();
    render();
  };
  document.getElementById("currency").onchange = (e) => {
    state.currency = e.target.value;
    bumpMeta();
    saveState();
    render();
  };
  document.getElementById("week-start").onchange = (e) => {
    state.weekStart = Number(e.target.value);
    bumpMeta();
    saveState();
    render();
  };
  document.getElementById("date-locale").onchange = (e) => {
    state.locale = e.target.value;
    bumpMeta();
    saveState();
    render();
  };
  document.getElementById("theme-light").onchange = (e) => {
    state.theme = e.target.checked ? "light" : "dark";
    saveState();
    render();
  };
  document.getElementById("density-compact").onchange = (e) => {
    state.density = e.target.checked ? "compact" : "comfortable";
    saveState();
    render();
  };
  document.getElementById("remind-enabled").onchange = async (e) => {
    if (e.target.checked) {
      const ok = await enableReminders();
      state.remindEnabled = ok;
      e.target.checked = ok;
    } else {
      state.remindEnabled = false;
      disableReminders();
    }
    saveState();
  };
  document.getElementById("cat-caps").onchange = (e) => {
    const input = e.target.closest("[data-cap]");
    if (!input) return;
    state.categoryCaps[input.dataset.cap] = input.value;
    bumpMeta();
    saveState();
    renderInsights();
  };
  document.getElementById("wallet-starts").onchange = (e) => {
    const input = e.target.closest("[data-wallet]");
    if (!input) return;
    if (!state.startingBalances) state.startingBalances = {};
    state.startingBalances[input.dataset.wallet] = input.value;
    bumpMeta();
    saveState();
    renderWallets();
  };
  document.getElementById("template-list").onclick = (e) => {
    const use = e.target.closest("[data-use-tpl]");
    if (use) {
      const t = state.templates.find((x) => x.id === use.dataset.useTpl);
      if (t) applyTemplate(t);
      return;
    }
    const del = e.target.closest("[data-del-tpl]");
    if (del) {
      const t = state.templates.find((x) => x.id === del.dataset.delTpl);
      if (t) {
        t.deleted = true;
        t.updatedAt = Date.now();
      } else {
        state.templates = state.templates.filter((x) => x.id !== del.dataset.delTpl);
      }
      saveState();
      renderSettings();
    }
  };

  document.getElementById("export-csv").onclick = exportCsv;
  document.getElementById("export-json").onclick = exportJson;
  document.getElementById("import-json").onchange = (e) => {
    const file = e.target.files && e.target.files[0];
    if (file) importJson(file);
    e.target.value = "";
  };
  document.getElementById("copy-summary").onclick = copyMonthSummary;
  document.getElementById("copy-summary-settings").onclick = copyMonthSummary;
  document.getElementById("print-month").onclick = () => {
    state.view = "insights";
    saveState();
    render();
    window.print();
  };

  document.getElementById("entry-modal").addEventListener("cancel", (e) => {
    e.preventDefault();
    closeModal();
  });
  document.getElementById("modal-cancel").onclick = (e) => {
    e.preventDefault();
    closeModal();
  };
  document.getElementById("modal-duplicate").onclick = (e) => {
    e.preventDefault();
    const src = editingId ? state.entries.find((x) => x.id === editingId) : null;
    closeModal(true);
    if (!src) return;
    openModal({
      date: state.selectedDate || src.date || todayIso(),
      amount: src.amount,
      category: src.category,
      method: src.method,
      type: src.type,
      note: src.note,
      recurringId: src.recurringId,
    });
  };
  document.getElementById("amount-down").onclick = (e) => nudgeAmount(-1, e);
  document.getElementById("amount-up").onclick = (e) => nudgeAmount(1, e);
  document.getElementById("entry-form").onsubmit = (e) => {
    e.preventDefault();
    const saveBtn = document.getElementById("modal-save");
    saveBtn.disabled = true;
    try {
      if (saveEntryFromForm()) {
        closeModal(true);
        render();
      }
    } finally {
      saveBtn.disabled = false;
    }
  };
  document.getElementById("amount-chips").onclick = (e) => {
    const chip = e.target.closest("[data-amt-chip]");
    if (!chip) return;
    document.getElementById("amount").value = chip.dataset.amtChip;
    document.getElementById("amount").focus();
  };
  document.getElementById("quick-templates").onclick = (e) => {
    const chip = e.target.closest(".chip");
    if (!chip) return;
    document.getElementById("note").value = decodeURIComponent(chip.dataset.note || "");
    document.getElementById("amount").value = chip.dataset.amt;
    document.getElementById("category").value = chip.dataset.cat;
    document.getElementById("method").value = chip.dataset.method;
    document.getElementById("entry-type").value = chip.dataset.type;
  };

  document.getElementById("sync-enabled").onchange = (e) => {
    state.syncEnabled = e.target.checked;
    if (state.syncEnabled && !pairingCode()) generatePairing();
    saveState();
    render();
    syncNow();
  };
  document.getElementById("sync-url").onchange = (e) => {
    state.syncUrl = e.target.value.trim().replace(/\/$/, "");
    saveState();
  };
  document.getElementById("sync-code").onchange = (e) => {
    const parsed = parsePairing(e.target.value);
    if (parsed) {
      state.syncId = parsed.id;
      state.syncSecret = parsed.secret;
      state.syncEnabled = true;
      saveState();
      render();
      syncNow();
    }
  };
  document.getElementById("sync-generate").onclick = async () => {
    generatePairing();
    try {
      await navigator.clipboard.writeText(pairingCode());
      toast("Pairing code copied");
    } catch {
      toast("Pairing created — copy it from Settings");
    }
    syncNow();
  };
  document.getElementById("sync-copy").onclick = async () => {
    if (!pairingCode()) generatePairing();
    try {
      await navigator.clipboard.writeText(pairingCode());
      toast("Pairing code copied");
    } catch {
      toast("Copy the pairing field manually");
    }
  };
  document.getElementById("sync-now").onclick = () => syncNow();
  document.getElementById("apply-recurring").onclick = applyPendingRecurring;
  document.getElementById("skip-recurring").onclick = skipPendingRecurring;
  document.getElementById("dismiss-banner").onclick = () => {
    state.nagDismissedDate = todayIso();
    saveState();
    setBanner("");
  };
  document.getElementById("repeat-last").onclick = repeatLast;
  document.getElementById("wallets").onclick = (e) => {
    const btn = e.target.closest("[data-method]");
    if (!btn) return;
    state.filterMethod = btn.dataset.method;
    state.view = "ledger";
    saveState();
    render();
  };
  document.getElementById("add-method-form").onsubmit = (e) => {
    e.preventDefault();
    const name = document.getElementById("new-method").value.trim();
    if (!name) return;
    if (!state.customMethods.includes(name) && !LedgerCore.METHODS.includes(name)) {
      state.customMethods.push(name);
      bumpMeta();
      saveState();
    }
    document.getElementById("new-method").value = "";
    render();
    toast(`Method ${name} ready`);
  };
  document.getElementById("pin-form").onsubmit = async (e) => {
    e.preventDefault();
    const pin = document.getElementById("pin-input").value.trim();
    const status = document.getElementById("pin-status");
    if (!/^\d{4,8}$/.test(pin)) {
      status.hidden = false;
      status.className = "status warn";
      status.textContent = "Use 4 to 8 digits.";
      return;
    }
    state.pinHash = await hashPin(pin);
    try {
      sessionStorage.setItem("ledger-unlocked", state.pinHash);
    } catch {
      /* ignore */
    }
    document.getElementById("pin-input").value = "";
    saveState();
    render();
    status.hidden = false;
    status.className = "status ok";
    status.textContent = "PIN saved on this device.";
    armIdleLock();
  };
  document.getElementById("idle-lock-min").onchange = (e) => {
    const n = Number(e.target.value);
    state.idleLockMinutes = Number.isFinite(n) ? Math.max(0, Math.min(240, n)) : 5;
    saveState();
    armIdleLock();
  };
  document.getElementById("pin-clear").onclick = () => {
    state.pinHash = "";
    try {
      sessionStorage.removeItem("ledger-unlocked");
    } catch {
      /* ignore */
    }
    saveState();
    render();
    hideLockGate();
    toast("PIN removed");
  };
  document.getElementById("unlock-form").onsubmit = async (e) => {
    e.preventDefault();
    const pin = document.getElementById("unlock-pin").value.trim();
    const err = document.getElementById("unlock-error");
    if ((await hashPin(pin)) === state.pinHash) {
      try {
        sessionStorage.setItem("ledger-unlocked", state.pinHash);
      } catch {
        /* ignore */
      }
      err.hidden = true;
      hideLockGate();
      return;
    }
    err.hidden = false;
    err.textContent = "That PIN does not match.";
  };
  document.getElementById("lock-gate").addEventListener("cancel", (e) => {
    if (!pinUnlocked()) e.preventDefault();
  });
  document.getElementById("search-all").onchange = (e) => {
    state.searchAllMonths = e.target.checked;
    saveState();
    renderLedger();
  };
  document.getElementById("add-category-form").onsubmit = (e) => {
    e.preventDefault();
    const name = document.getElementById("new-category").value.trim();
    if (!name) return;
    if (!state.customCategories.includes(name) && !LedgerCore.BASE_CATEGORIES.includes(name)) {
      state.customCategories.push(name);
      bumpMeta();
      saveState();
    }
    document.getElementById("new-category").value = "";
    render();
    toast(`Category ${name} ready`);
  };

  const palette = document.getElementById("palette");
  const paletteQ = document.getElementById("palette-q");
  const paletteList = document.getElementById("palette-list");
  const paletteCommands = () => [
    { id: "add", label: "Add expense", run: () => openModal({ date: state.selectedDate || todayIso() }) },
    { id: "overview", label: "Go to Overview", run: () => { state.view = "overview"; saveState(); render(); } },
    { id: "ledger", label: "Go to Ledger", run: () => { state.view = "ledger"; saveState(); render(); } },
    { id: "clear", label: "Clear ledger filters", run: clearFilters },
    { id: "insights", label: "Go to Insights", run: () => { state.view = "insights"; saveState(); render(); } },
    { id: "settings", label: "Go to Settings", run: () => { state.view = "settings"; saveState(); render(); } },
    { id: "repeat", label: "Repeat last expense", run: repeatLast },
    { id: "summary", label: "Copy month summary", run: copyMonthSummary },
    { id: "today", label: "Jump to today", run: () => document.getElementById("jump-today").click() },
    { id: "sync", label: "Sync now", run: () => syncNow() },
    { id: "export", label: "Export JSON backup", run: exportJson },
    { id: "theme", label: "Toggle light theme", run: () => { state.theme = state.theme === "light" ? "dark" : "light"; saveState(); render(); } },
    { id: "compact", label: "Toggle compact layout", run: () => { state.density = state.density === "compact" ? "comfortable" : "compact"; saveState(); render(); } },
  ];
  function renderPalette() {
    const q = (paletteQ.value || "").toLowerCase();
    const items = paletteCommands().filter((c) => c.label.toLowerCase().includes(q));
    paletteList.innerHTML = items
      .map((c, i) => `<li><button type="button" class="${i === 0 ? "active" : ""}" data-cmd="${c.id}">${escapeHtml(c.label)}</button></li>`)
      .join("");
  }
  function runPalette(id) {
    const cmd = paletteCommands().find((c) => c.id === id);
    palette.close();
    if (cmd) cmd.run();
  }
  paletteQ.oninput = renderPalette;
  paletteList.onclick = (e) => {
    const btn = e.target.closest("[data-cmd]");
    if (btn) runPalette(btn.dataset.cmd);
  };
  paletteQ.onkeydown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const first = paletteList.querySelector("[data-cmd]");
      if (first) runPalette(first.dataset.cmd);
    }
  };

  window.addEventListener("hashchange", () => {
    const v = (location.hash || "").replace("#", "");
    if (["overview", "ledger", "insights", "settings"].includes(v) && state.view !== v) {
      state.view = v;
      saveState();
      render();
    }
  });

  window.addEventListener("online", () => syncNow({ silent: true }));
  window.addEventListener("offline", () => renderSyncStatus());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") syncNow({ silent: true });
  });
  setInterval(() => {
    if (state.syncEnabled) syncNow({ silent: true });
  }, 25000);

  let installEvent = null;
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    installEvent = e;
    const btn = document.getElementById("install-app");
    btn.hidden = false;
    btn.onclick = async () => {
      await installEvent.prompt();
      installEvent = null;
      btn.hidden = true;
    };
  });

  document.addEventListener("keydown", (e) => {
    const typing = /input|textarea|select/i.test(e.target.tagName);
    if (e.key === "n" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      openModal({ date: state.selectedDate || todayIso() });
    }
    if ((e.key === "z" || e.key === "Z") && (e.ctrlKey || e.metaKey) && !typing) {
      e.preventDefault();
      restoreUndo();
    }
    if ((e.key === "r" || e.key === "R") && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      repeatLast();
    }
    if (e.key === "/" && !typing) {
      e.preventDefault();
      state.view = "ledger";
      saveState();
      render();
      document.getElementById("search").focus();
    }
    if (e.key === "k" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      renderPalette();
      palette.showModal();
      paletteQ.value = "";
      renderPalette();
      paletteQ.focus();
    }
    if (e.key === "Escape" && palette.open) palette.close();
    if (e.key === "Escape" && !typing && state.view === "ledger" && filtersActive()) {
      e.preventDefault();
      clearFilters();
    }
    const blocked =
      typing ||
      document.getElementById("entry-modal").open ||
      document.getElementById("palette").open ||
      document.getElementById("lock-gate")?.open;
    if (!blocked && !e.altKey && !e.ctrlKey && !e.metaKey && ["1", "2", "3", "4"].includes(e.key)) {
      e.preventDefault();
      state.view = ["overview", "ledger", "insights", "settings"][Number(e.key) - 1];
      saveState();
      render();
      if (state.view === "ledger") document.getElementById("search").focus();
    }
    if (!blocked && state.view === "overview" && !e.altKey && !e.ctrlKey && !e.metaKey) {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        jumpSelectedDay(-1);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        jumpSelectedDay(1);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        jumpSelectedDay(-7);
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        jumpSelectedDay(7);
      } else if (e.key === "Enter") {
        e.preventDefault();
        openModal({ date: state.selectedDate || todayIso() });
      } else if (e.key === "Home") {
        e.preventDefault();
        document.getElementById("jump-today").click();
      }
    }
    if (!typing && e.key === "ArrowLeft" && e.altKey) {
      document.getElementById("prev-month").click();
    }
    if (!typing && e.key === "ArrowRight" && e.altKey) {
      document.getElementById("next-month").click();
    }
  });
  for (const ev of ["pointerdown", "keydown", "touchstart"]) {
    document.addEventListener(ev, armIdleLock, { passive: true });
  }
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") armIdleLock();
  });
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator) || location.protocol === "file:") return;
  navigator.serviceWorker
    .register("sw.js")
    .then((reg) => {
      reg.addEventListener("updatefound", () => {
        const worker = reg.installing;
        if (!worker) return;
        worker.addEventListener("statechange", () => {
          if (worker.state === "installed" && navigator.serviceWorker.controller) {
            toast("New Ledger version ready", "Reload", () => location.reload());
          }
        });
      });
    })
    .catch(() => {});
}

bind();
const bootHash = (location.hash || "").replace("#", "");
if (["overview", "ledger", "insights", "settings"].includes(bootHash)) state.view = bootHash;
saveState();
render();
registerServiceWorker();
showLockGate();
armIdleLock();
if (state.remindEnabled) enableReminders();
if (state.syncEnabled) syncNow({ silent: true });
if (location.protocol.startsWith("http")) {
  fetch("/api/info")
    .then((r) => r.json())
    .then((info) => {
      const remote = (info.urls || []).filter((u) => !u.includes("127.0.0.1"));
      if (!remote.length) return;
      if (!state.syncUrl || /127\.0\.0\.1|localhost/.test(state.syncUrl)) {
        state.syncUrl = remote[0];
        saveState();
        renderSettings();
      }
      const detail = document.getElementById("sync-detail");
      if (detail && !state.lastSyncAt) {
        detail.textContent = `On your phone, open ${remote.join(" or ")} then paste the pairing code.`;
      }
    })
    .catch(() => {});
}

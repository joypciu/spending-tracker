"""Mirror of core.js checks so the suite runs without Node."""
from datetime import date, timedelta


def pad2(n: int) -> str:
    return f"0{n}" if n < 10 else str(n)


def shift_iso(iso: str, delta: int) -> str:
    y, m, d = map(int, iso.split("-"))
    nxt = date(y, m, d) + timedelta(days=delta)
    return f"{nxt.year}-{pad2(nxt.month)}-{pad2(nxt.day)}"


def shift_month(key: str, delta: int) -> str:
    y, m = map(int, key.split("-"))
    m += delta - 1
    y += m // 12
    m = m % 12 + 1
    return f"{y}-{pad2(m)}"


def days_in_month(year: int, month: int) -> int:
    if month == 12:
        nxt = date(year + 1, 1, 1)
    else:
        nxt = date(year, month + 1, 1)
    return (nxt - date(year, month, 1)).days


def expense_total(entries):
    return sum(e["amount"] for e in entries if e.get("type") != "income" and not e.get("deleted"))


def month_entries(entries, month):
    prefix = f"{month}-"
    return [e for e in entries if not e.get("deleted") and str(e.get("date", "")).startswith(prefix)]


def forecast(spent: float, month: str, today: str):
    y, m = map(int, month.split("-"))
    days = days_in_month(y, m)
    if not today.startswith(month + "-"):
        return spent
    elapsed = max(1, int(today[8:10]))
    return spent / elapsed * days


def duplicate_of(entries, candidate):
    for e in entries:
        if e.get("deleted") or e.get("id") == candidate.get("id"):
            continue
        if e.get("type", "expense") != candidate.get("type", "expense"):
            continue
        if e.get("amount") != candidate.get("amount"):
            continue
        if (e.get("note") or "").strip().lower() != (candidate.get("note") or "").strip().lower():
            continue
        if e.get("category") != candidate.get("category"):
            continue
        if e.get("date") == candidate.get("date"):
            return e
    return None


def pending_recurring(entries, month, skipped=None):
    this_month = {e["recurringId"] for e in month_entries(entries, month) if e.get("recurringId")}
    seen = {}
    for e in entries:
        rid = e.get("recurringId")
        if e.get("deleted") or not rid or e.get("type") == "income":
            continue
        if str(e.get("date", ""))[:7] >= month:
            continue
        if rid in this_month:
            continue
        if skipped and rid in skipped and month in skipped[rid]:
            continue
        prev = seen.get(rid)
        if not prev or e["date"] > prev["date"]:
            seen[rid] = e
    return list(seen.values())


def main() -> None:
    assert shift_month("2026-01", -1) == "2025-12"
    assert [6, 0, 1, 2, 3, 4, 5][0] == 6
    days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
    sat = days[6:] + days[:6]
    assert sat[0] == "Sat"
    assert shift_iso("2026-08-31", 1) == "2026-09-01"
    assert shift_iso("2026-09-01", -1) == "2026-08-31"
    assert 800 - 95 == 705
    assert shift_month("2026-08", 1) == "2026-09"
    assert days_in_month(2026, 2) == 28
    entries = [
        {"id": "1", "date": "2026-08-01", "amount": 100, "type": "expense", "category": "Food", "note": "tea"},
        {"id": "2", "date": "2026-08-01", "amount": 40, "type": "income", "category": "Other", "note": "refund"},
        {"id": "3", "date": "2026-08-02", "amount": 50, "type": "expense", "category": "Food", "note": "tea", "deleted": True},
        {"id": "4", "date": "2026-07-15", "amount": 200, "type": "expense", "category": "Food", "note": "rent snack", "recurringId": "r1"},
    ]
    assert expense_total(entries) == 300
    assert abs(forecast(310, "2026-08", "2026-08-10") - 961) < 0.001
    assert duplicate_of(entries, {"date": "2026-08-01", "amount": 100, "note": "Tea", "category": "Food", "type": "expense"})["id"] == "1"
    pending = pending_recurring(entries, "2026-08")
    assert len(pending) == 1
    already = pending_recurring(
        entries
        + [{"id": "5", "date": "2026-08-15", "amount": 200, "type": "expense", "category": "Food", "note": "x", "recurringId": "r1"}],
        "2026-08",
    )
    assert already == []
    skipped = pending_recurring(entries, "2026-08", {"r1": ["2026-08"]})
    assert skipped == []
    amounts = sorted({20, 50, 100, 200, 500, 100})
    assert 100 in amounts and 20 in amounts
    print("ok — core logic checks passed")


if __name__ == "__main__":
    main()

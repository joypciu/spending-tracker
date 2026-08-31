# Ledger

Offline-first personal spending ledger for phone and desktop. Entries live on this device (`localStorage`). Optional encrypted LAN sync lets a phone and a computer share the same books without the server seeing plaintext.

## Run

```bash
python server.py
```

Then open http://127.0.0.1:8788/ — or double-click `Start ledger.cmd` on Windows.

On a phone on the same Wi-Fi, use the LAN URL printed in the terminal. Install from the browser (Add to Home Screen / Install) for an app-like shell.

## What it does

- Overview calendar, day panel, searchable ledger, insights
- Budgets, daily and category caps, wallets with starting balances
- Income/refunds, templates, recurring monthly charges (with skip)
- Custom categories and payment methods
- Command palette (Ctrl+K), hash routes, compact density
- Optional PIN lock with idle timeout (including never)
- CSV/JSON backup (pairing secrets omitted unless you opt in)
- PWA service worker (network-first GET, skip `/api/`)
- Encrypted blob sync via the local Python server
- Optional 10:30 PM reminder (`install-reminder.ps1` on Windows)

New installs start empty. Settings → **Load sample entries** (or the Overview card) adds a few generic rows so you can see the calendar without mixing demo data into a live book.

## Tests

```bash
python test_core.py
python test_server.py
```

Open http://127.0.0.1:8788/ and walk Overview → Ledger → Insights → Settings. Add an expense, search, toggle theme (Ctrl+K), and confirm the page still works with the network off after the first visit.

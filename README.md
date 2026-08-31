# spending-tracker

Offline-first personal spending ledger for phone and desktop. Entries live on the device (localStorage). Optional encrypted LAN sync lets a phone and a computer share the same books without the server ever seeing plaintext.

## Run

```bash
python server.py
```

Then open http://127.0.0.1:8788/ — or double-click `Start ledger.cmd` on Windows.

On a phone on the same Wi-Fi, use the LAN URL printed in the terminal. Install from the browser (Add to Home Screen / Install) for an app-like shell.

## What it already does

- Calendar month view, day panel, searchable ledger, insights
- Budgets, daily and category caps, light/dark theme
- Income/refunds, templates, CSV/JSON backup
- PWA service worker for offline use
- Encrypted blob sync via the local Python server
- Optional 10:30 PM reminder (`install-reminder.ps1` on Windows)

## Tests

```bash
python test_core.py
python test_server.py
```

Open http://127.0.0.1:8788/ and walk Overview → Ledger → Insights → Settings. Add an expense, search, toggle theme (Ctrl+K), and confirm the page still works with the network off after the first visit.

## New in this revision

- Month picker, command palette (Ctrl+K), hash routes
- Recurring monthly charges, duplicate warning, custom categories
- All-months search, six-month trend, projected month-end, smart notes
- Stale-while-revalidate service worker so updates land while offline still works

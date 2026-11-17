# Personal Kanban Board

A zero-dependency, offline-ready personal Kanban board. Three static files
(`index.html`, `styles.css` + five plain scripts) — no build step, no npm,
no frameworks, no CDNs, no web fonts. Your board lives in your browser's
`localStorage`.

## How to open it

- **Simplest:** double-click `index.html` — it works straight from `file://`.
- **Or serve the folder** with any static server, e.g.:

  ```sh
  python -m http.server 8791      # then visit http://localhost:8791
  ```

> Note: `localStorage` is scoped per origin. `file://`, `http://localhost`,
> and any other host each keep their **own separate copy** of your board.
> If you switch between opening the file directly and serving it over HTTP,
> use **Export → Import** to carry your board across.

## Features

- Add, edit, and delete cards. Click a card (or its ✎ button) to edit it in a
  modal: title (required, 1–200 chars), description, priority, due date,
  labels.
- Inline "Add a card" composer at the bottom of every column:
  **Enter** commits, **Esc** cancels, clicking away (blur) also commits.
- Add / rename / delete columns. Renaming: click the column title. Deleting a
  non-empty column asks for confirmation; empty columns delete immediately.
- Drag & drop cards within a column and between columns (HTML5 drag-and-drop,
  with an animated drop gap). A grip handle in each column header reorders the
  columns themselves.
- Cards that are due before today get a red highlight — except in the
  rightmost column, which represents "working on it now" (see Decisions).
- Live search and a priority filter; both are view-only and never delete data.
- Export to a JSON backup file (`kanban-backup-YYYY-MM-DD.json`) and import a
  previously exported file (validated before anything is replaced).
- Light and dark themes; follows your system setting until you toggle
  (🌓 button), then your choice is remembered.
- Autosave with status indicator, data-corruption recovery, and multi-tab
  sync — see below.

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| `N` | New card (opens the inline composer in the first column) |
| `/` | Jump to the search box |
| `Enter` | Commit the inline composer / submit the editor |
| `Esc` | Cancel the inline composer / close the editor without saving |

All shortcuts are ignored while you are typing in a text field.

## Where your data lives

| Key | Contents |
| --- | --- |
| `kanban.board.v1` | The board: `{ version: 1, columns, cards, revision }` |
| `kanban.board.v1.bak` | The previous save, kept as an extra safety net |
| `kanban.board.v1.corrupt-<timestamp>` | A copy of unreadable data, instead of destroying it |
| `kanban.theme` | Your theme choice (`"light"` / `"dark"`) |

Details:

- Saving happens automatically ~300 ms after each change (coalesced), and is
  flushed when the tab is hidden or closed.
- Before every save the previous stored value is copied to `.bak`.
- On load, data is **validated**: unknown `version` numbers and malformed
  boards are never trusted or overwritten. Bad data is preserved under a
  `corrupt-<timestamp>` key and a fresh default board is started, with a
  flash message so you know what happened. Import does the same checks and
  refuses with a clear message.
- If `localStorage` is blocked (e.g. a private window) a banner says
  **"Changes won't be saved."** and the app runs from memory only.
- Two tabs stay in sync: the other tab reloads automatically via the
  `storage` event.
- The app requests persistent storage (`navigator.storage.persist()`) where
  the browser grants it. Clearing site data (or "Clear browsing data") wipes
  the board like any other site data — use Export if you want a portable copy.

## Manual test checklist

See [`MANUAL-TEST-CHECKLIST.md`](./MANUAL-TEST-CHECKLIST.md) — a short,
step-by-step list you can walk through in any browser to verify the
behaviour above.

## File layout & decisions

```
index.html   page skeleton, modal editor, script tags (plain, non-module)
styles.css   all styling; theme values are CSS custom properties
storage.js   localStorage access, validation, export/import helpers
state.js     the single source of truth + autosave pipeline
render.js    DOM rendering (cards, columns, modal, status)
dnd.js       drag and drop (cards + column reorder)
app.js       boot sequence, event wiring, shortcuts
```

Documented decisions (chosen where the spec left room):

- The "overdue" rule: a card is overdue when its due date is **strictly
  before today** and it is **not in the rightmost column** — the "doing
  now" column never gets the red highlight. Due dates within the next
  two days get a softer "soon" chip.
- New cards default to **medium** priority.
- Labels are typed comma-separated and stored as an array, trimmed and
  deduplicated (case-sensitive).
- Inline add: **Enter** commits, **Esc** cancels, **blur commits** what is
  typed (matches the mental model "you walked away from it"). Column
  rename: Enter and blur commit; Esc cancels and restores the old name.
- Confirmations use native `confirm()`/`alert()` — simple, keyboard-accessible
  and dependency-free.

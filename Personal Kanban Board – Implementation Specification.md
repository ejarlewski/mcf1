# Personal Kanban Board – Implementation Specification

*A single-user kanban app that runs entirely in the browser, keeps its state between sessions, and looks great.*

## 1. Overview

Build a small kanban board for one person's personal task management. It is a static web page that runs entirely in the browser: open it, use it, close it, and the board is exactly as you left it. State is saved in the browser's own storage, with export and import for backups. There are no accounts, no server, no multi-user features, and no cloud services. It should also look striking: a polished, dark, glassy "mission control" aesthetic (section 7).

The priority is **simple, readable, dependency-light code** that is easy to maintain and extend later.

## 2. Goals and Non-Goals

**Goals**

- Create, edit, move, and delete task cards across columns.
- Drag and drop cards between and within columns.
- Persist all changes automatically; reloading the page or restarting the browser restores the exact state.
- Back up and restore the board via JSON export and import.
- Fast, keyboard-friendly UI with a distinctive, polished visual design.

**Non-goals (do not build these)**

- Authentication, users, sharing, or permissions
- Servers, backends, databases, or cloud storage
- Real-time sync or notifications
- Frameworks, bundlers, or build steps
- Comments, attachments, time tracking, or reporting

## 3. Technology Constraints

- **Platform:** a static web page made of `index.html`, `styles.css`, and `app.js`. It must work by double-clicking `index.html` (a `file://` URL) and also when served by any static file server. There is no server code and no Node.js.
- **Languages:** plain HTML, CSS, and vanilla JavaScript. Load scripts with classic `<script>` tags, **not ES modules**, because browsers block modules over `file://`.
- **Dependencies:** none. No frameworks, npm packages, CDNs, or web fonts. Use system font stacks.
- **Storage:** `localStorage`, holding the whole board as one JSON string under the key `kanban.board.v1`.
- **Backup:** JSON export and import buttons, because browser storage can be cleared by the user or the browser.
- **Browsers:** current Chrome, Edge, Firefox, and Safari.
- Must work fully offline.

## 4. Data Model

The whole board is one JSON document, stored as a string in localStorage under the key kanban.board.v1:

```json
{
  "version": 1,
  "columns": [
    { "id": "col-1", "title": "To Do", "cardIds": ["card-1", "card-2"] },
    { "id": "col-2", "title": "In Progress", "cardIds": [] },
    { "id": "col-3", "title": "Done", "cardIds": [] }
  ],
  "cards": {
    "card-1": {
      "id": "card-1",
      "title": "Example task",
      "description": "Optional longer notes",
      "priority": "medium",
      "dueDate": "2026-12-01",
      "labels": ["home"],
      "createdAt": "2026-11-17T10:00:00.000Z",
      "updatedAt": "2026-11-17T10:00:00.000Z"
    }
  }
}
```

Rules:

- Column order is the array order. Card order within a column is the `cardIds` array order.
- `title` is required (1–200 characters). All other card fields are optional.
- `priority` is one of `low`, `medium`, `high`, or omitted.
- `dueDate` is an ISO date string (`YYYY-MM-DD`) or omitted.
- `labels` is an array of short free-text strings.
- IDs are generated client-side as a prefix plus a random/unique string (e.g. `crypto.randomUUID()`).
- On first run, seed the three default columns above with no cards.

## 5. Persistence and Backup

All persistence lives in one small storage module. The app keeps the full board in memory and writes the whole document to localStorage after each change.

| Function | Behaviour |
| --- | --- |
| `loadBoard()` | Reads and parses `kanban.board.v1`. Returns the default board if the key is missing. If the data is corrupt, copies the raw string to `kanban.board.v1.corrupt-<timestamp>`, then returns the default board. |
| `saveBoard(board)` | Serialises and writes the board. Before overwriting, copies the previous value to `kanban.board.v1.bak`. Catches quota and security errors and reports them in the status indicator. |
| `exportBoard()` | Downloads the board as `kanban-backup-YYYY-MM-DD.json` using a Blob and a temporary link. |
| `importBoard(file)` | Reads a chosen `.json` file, validates it, asks for confirmation, then replaces the board. |

Storage requirements:

- **Validation:** loaded or imported data must be an object with a `columns` array and a `cards` object, and every id in a column's `cardIds` must exist in `cards`. Otherwise reject it with a clear message and never overwrite the current board.
- **Versioning:** keep the `version` field. Refuse to import a version the app does not know.
- **Storage unavailable:** if localStorage cannot be used (for example private browsing), keep working in memory and show a persistent banner: "Changes won't be saved."
- **Eviction:** call `navigator.storage.persist()` when available (ignore failure) to reduce the chance the browser clears the data.
- **Origins:** localStorage is separate per browser profile and per origin, so `file://` and `http://localhost` see different data. The README must say to pick one way of opening the app and stick to it.

## 6. Functional Requirements

### Columns

- Display columns side by side, horizontally scrollable if they overflow.
- Add a new column, rename a column (inline edit), and delete a column. Deleting a non-empty column requires confirmation and deletes its cards.
- Reordering columns is optional (nice to have via drag and drop).
- Show a card count in each column header.

### Cards

- **Add:** each column has an "Add card" control at the bottom that reveals an inline text input; Enter saves, Escape cancels.
- **View/Edit:** clicking a card opens a modal or side panel to edit title, description, priority, due date, and labels. Changes save on closing or via an explicit Save button.
- **Delete:** available from the edit view, with a confirmation prompt.
- **Move:** drag and drop between columns and reorder within a column. The drop position must be visually indicated. Use the native HTML5 drag-and-drop API.
- **Card display:** show title, a priority indicator (colour-coded), label chips, and the due date. Highlight overdue cards (due date before today and not in the last column).

### Filtering and search

- A search box at the top filters cards by title, description, or label (case-insensitive, live as you type). Non-matching cards are hidden, not deleted.
- Optional: a priority filter dropdown.

### Persistence behaviour

- Load the board with `loadBoard()` on page load.
- After any change, call `saveBoard()`, debounced by about 300 ms so rapid actions produce one write. Also save immediately on `visibilitychange` (hidden) and `pagehide`.
- Show a small, unobtrusive status indicator: "Saved", "Saving…", or "Not saved – storage unavailable".
- Listen for the `storage` event: if another tab changes the board, reload it and re-render, so two open tabs never overwrite each other with stale data.

## 7. Visual Design and UX

Aim for a sleek "mission control" look: dark-first, glassy, and a little futuristic, but calm enough to use all day. Treat this section as a requirement, not decoration.

- **Theme:** dark by default, with a deep navy or charcoal background (around `#0b0f1a`) and soft radial colour glows or a slow, subtle gradient drift behind the board. Provide a light theme too, with a header toggle that defaults to `prefers-color-scheme` and remembers the choice in localStorage (`kanban.theme`).
- **Accents:** vivid neon accents used sparingly for focus, highlights, and priority: cyan (`#22d3ee`), violet (`#a78bfa`), and pink (`#f472b6`). Define every colour as a CSS custom property.
- **Surfaces:** glassmorphism columns: semi-transparent panels with `backdrop-filter` blur, 1px translucent borders, soft shadows, and 12–16px rounded corners. Fall back to a solid translucent colour where blur is unsupported.
- **Columns:** each column has its own accent colour on its header and a count badge. Dragging over a column highlights it with a soft glow.
- **Cards:** lift and glow slightly on hover. A coloured left edge shows priority (low, medium, high). Labels are small pills. The due date chip turns amber within 2 days and red when overdue.
- **Motion:** smooth 150–250 ms transitions. Cards animate in on add and out on delete. While dragging, the card tilts slightly and a gap animates open at the drop position. Respect `prefers-reduced-motion` by disabling non-essential animation.
- **Typography:** system font stack for body text, and `ui-monospace` for counts, dates, and labels. No web fonts.
- **Header:** gradient-text app title, a search box, a New card button, theme toggle, Export and Import buttons, and the save status indicator.
- **Empty states:** a friendly message and a small inline SVG icon in empty columns. No external images.
- **Layout:** columns side by side, horizontally scrollable on overflow. Suited to laptop and desktop windows; mobile polish is not required.
- **Keyboard:** `n` starts a new card in the first column, `/` focuses search, Enter and Escape work in inline inputs, Escape closes the modal, and cards are focusable with Enter opening the edit view.
- **Accessibility:** semantic HTML, visible focus rings in the accent colour, `aria-label` on icon buttons, and AA text contrast even over glass surfaces.
- **Safety:** render all user-provided text with `textContent`, never `innerHTML` with user data.

## 8. Project Structure

```
kanban/
├── index.html
├── styles.css
├── app.js
└── README.md
```

If `app.js` grows beyond a few hundred lines, split it into `storage.js`, `state.js`, `render.js`, and `dnd.js`, loaded with classic `<script>` tags in dependency order and sharing one global namespace such as `window.Kanban`. Keep functions short and commented where the logic is not obvious.

## 9. Suggested Implementation Order

1. Page shell: `index.html`, base CSS, theme variables, and header.
2. Storage module (`loadBoard`, `saveBoard`, default board) and a read-only render of the board.
3. Add, edit, and delete cards via the modal.
4. Drag and drop for cards.
5. Column management (add, rename, delete).
6. Debounced autosave, status indicator, cross-tab sync, and error handling.
7. Search and filtering.
8. Visual polish: glass surfaces, glow, motion, and light and dark themes.
9. Export and import, keyboard shortcuts, and an accessibility pass.
10. README with run instructions.

Complete and verify each step before starting the next.

## 10. Acceptance Criteria

The implementation is done when all of the following are true:

- Double-clicking `index.html` in a modern browser, with no server and no network, shows a working board. It also works when served by any static file server.
- On a fresh install, the board shows To Do, In Progress, and Done columns.
- A card added, edited, or moved is still in the same place after a page reload and after closing and reopening the browser.
- Dragging a card to another column, and to a specific position within a column, works reliably.
- Deleting the `kanban.board.v1` key in dev tools and reloading recovers to the default board without errors.
- Exporting, clearing storage, then importing the file restores the exact board. An invalid import file is rejected without changing the board.
- A change made in one tab appears in a second open tab without a manual refresh and is not overwritten by it.
- No external network requests are made, and there are no runtime dependencies.
- User text containing HTML such as `<script>` renders as plain text.
- The dark theme shows glass panels, accent colours, hover and drag animations, priority edges, and due-date colouring; the light theme and reduced-motion setting both work.
- The README explains how to open the app, that data lives in the browser's localStorage (per browser and per origin), and how to export backups.

## 11. Instructions to the Implementing AI

- Follow the constraints in section 3 strictly; do not add libraries, servers, or tooling that are not listed.
- Do not add features from the non-goals list.
- Put real effort into section 7; the visual design is part of the requirements.
- If something is ambiguous, choose the simplest option that satisfies the requirements and note the decision in the README.
- Output complete files, not fragments, so each can be saved as-is.
- After implementing, provide a short manual test checklist covering the acceptance criteria.

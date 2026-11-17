# Manual Test Checklist

Open `index.html` (double-click works) in any modern browser. Each numbered
item maps to a requirement from the spec.

## 1. First load
- [ ] Fresh browser profile (or after "Clear site data") shows three default
      columns: **To Do / In Progress / Done**, empty, with a 0 badge each.
- [ ] Status indicator reads **Saved**; no "Changes won't be saved" banner.

## 2. Cards
- [ ] Click **New card** (or press `N`): inline input appears focused in the
      first column. Type a title, press **Enter** → card appears with
      medium priority, badge updates, status shows *Saving… → Saved*.
- [ ] In an inline input, press **Esc** → input disappears, nothing added.
- [ ] Type into an inline input, click elsewhere (**blur**) → card is added.
- [ ] Click a card → modal editor opens with values pre-filled. Change title,
      add description, set priority to High, pick a due date, type
      `urgent, launch, urgent` in Labels, click **Save** → card updates;
      labels show as chips `urgent`, `launch` (deduplicated).
- [ ] In the editor, clear the title and press Save → inline error
      *"A card needs a title…"*, modal stays open, nothing changes.
- [ ] Press `Esc` in the modal → closes without saving.
- [ ] Delete in the editor asks to confirm; after confirming, the card
      disappears (with a small exit animation) from board and storage.
- [ ] A title containing `<img src=x onerror=alert(1)>` renders as plain
      text — no alert, no `<img>` in the DOM.

## 3. Columns
- [ ] **Add a column**: empty column appears named "New column"
      in rename mode; type a name, Enter → renamed.
- [ ] Click a column title → inline rename; Enter commits, click-away (blur)
      commits, **Esc restores the old name**.
- [ ] Delete a **non-empty** column → confirmation naming the card count;
      Confirm deletes the column *and* its cards; Cancel keeps everything.
- [ ] Delete an **empty** column → deletes immediately, no prompt.

## 4. Drag & drop
- [ ] Drag a card within a column → drop gap opens, card lands where dropped.
- [ ] Drag a card to another column → it moves; badges update.
- [ ] Drag a card onto an empty column → it lands there.
- [ ] Grab the ⠿ **grip** in a column header and drop it on another column →
      columns reorder. Card order inside columns is preserved.
- [ ] Reload the page → all moves persist.

## 5. Search, filter, overdue
- [ ] `/` focuses Search; typing filters cards live (title, description and
      labels are searched); non-matching columns still visible with their
      other cards; badges reflect actual column contents, not filtered view.
- [ ] Priority filter → shows only matching cards; "All priorities" restores.
- [ ] A card due **yesterday** in To Do/In Progress gets the red overdue
      highlight + "overdue" in its accessible name; the same card dragged to
      the **rightmost column** loses the highlight.
- [ ] A due date within 2 days gets a softer "soon" chip.

## 6. Persistence & recovery
- [ ] Reload the page → the board comes back exactly.
- [ ] Open the page in a **second tab**, add a card in one tab → the other
      tab reloads to show it within ~1 second (multi-tab sync).
- [ ] In DevTools, `localStorage` shows keys `kanban.board.v1` (the board)
      and `kanban.board.v1.bak` (previous copy).
- [ ] Tamper: set `kanban.board.v1` to `{ this is not ] valid`, reload →
      banner/flash *"Saved board was unreadable — a copy was kept…"*, fresh
      default board, and the bad data preserved under a
      `kanban.board.v1.corrupt-<timestamp>` key.
- [ ] Set the board JSON's `"version"` to `999`, reload → same recovery
      message; the invalid value was never used or overwritten blindly.

## 7. Export & import
- [ ] **Export** downloads `kanban-backup-YYYY-MM-DD.json` (today's date)
      containing pretty-printed JSON with `version`, `columns`, `cards`,
      `revision`.
- [ ] **Import** that file back → confirmation showing column/card counts;
      after Confirm, the board matches; Cancel leaves the board untouched.
- [ ] Import a file with garbage content → clear error alert, board
      untouched.
- [ ] Import a file with `"version": 999` → *"unsupported version"* style
      error, board untouched.

## 8. Theme & environment
- [ ] First visit follows your **system** light/dark setting.
- [ ] The 🌓 button flips the theme instantly; reload keeps your choice.
- [ ] Private/incognito window (storage blocked) → banner
      **"Changes won't be saved."** appears; the app still works fully.
- [ ] Network tab: no requests to anything except the local files
      (`index.html`, `styles.css`, `*.js`) — fully offline.
- [ ] With `prefers-reduced-motion: reduce` enabled in your OS, entrance/exit
      animations and drop-gap animation are suppressed.

## Notes
- `localStorage` is per-origin: opening via `file://` and serving via HTTP
  give two separate boards. Use Export/Import to move a board between them.
- Everything is also recoverable via `.bak` and `corrupt-*` keys in
  `localStorage` — clearing site data is still the one destructive action.

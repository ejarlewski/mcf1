/* state.js — the in-memory board, all mutations, and the debounced autosave.
 * Only this module triggers writes (through Kanban.storage). Other modules
 * call Kanban.state actions and listen with onChange / onStatus. */
(function () {
  'use strict';

  window.Kanban = window.Kanban || {};

  var storage = Kanban.storage;
  var SAVE_DEBOUNCE_MS = 300;

  var board = null;
  var lastSavedJson = null;
  var saveTimer = null;
  var dirty = false;

  var changeListeners = [];
  var statusListeners = [];

  function getBoard() { return board; }

  /* ---------- listeners ---------- */

  // Called after every board change with a small meta object, e.g.
  // { type: 'add-card', cardId: 'card-…' }.
  function onChange(fn) { changeListeners.push(fn); }

  // Called with 'saving' | 'saved' | 'unavailable' | 'error' and an optional message.
  function onStatus(fn) { statusListeners.push(fn); }

  function emitStatus(status, message) {
    for (var i = 0; i < statusListeners.length; i++) statusListeners[i](status, message);
  }

  function commit(meta) {
    dirty = true;
    for (var i = 0; i < changeListeners.length; i++) changeListeners[i](meta, board);
    scheduleSave();
  }

  /* ---------- autosave ---------- */

  function scheduleSave() {
    if (!storage.isAvailable()) { emitStatus('unavailable'); return; }
    emitStatus('saving');
    if (saveTimer !== null) clearTimeout(saveTimer);
    saveTimer = setTimeout(flushSave, SAVE_DEBOUNCE_MS);
  }

  // Write immediately. Also used by the debounce timer and the page-hide hooks.
  function flushSave() {
    if (saveTimer !== null) { clearTimeout(saveTimer); saveTimer = null; }
    if (!storage.isAvailable()) { emitStatus('unavailable'); return false; }
    if (!dirty) return true;
    var result = storage.saveBoard(board);
    if (result.ok) {
      dirty = false;
      lastSavedJson = result.json;
      emitStatus('saved');
      return true;
    }
    if (result.reason === 'unavailable') emitStatus('unavailable');
    else if (result.reason === 'quota') emitStatus('error', 'Storage is full — changes not saved');
    else emitStatus('error', 'Storage blocked — changes not saved');
    return false;
  }

  /* ---------- helpers ---------- */

  function findColumn(id) {
    for (var i = 0; i < board.columns.length; i++) {
      if (board.columns[i].id === id) return board.columns[i];
    }
    return null;
  }

  function nowISO() { return new Date().toISOString(); }

  function setOrDelete(obj, key, value) {
    if (value) obj[key] = value; else delete obj[key];
  }

  // Accepts an array or a comma-separated string; trims, drops blanks and
  // duplicates, and caps each label at 40 characters.
  function normalizeLabels(input) {
    var parts;
    if (Array.isArray(input)) parts = input.map(String);
    else if (typeof input === 'string') parts = input.split(',');
    else return [];
    var out = [];
    for (var i = 0; i < parts.length && out.length < 12; i++) {
      var label = parts[i].trim().slice(0, 40);
      if (label && out.indexOf(label) === -1) out.push(label);
    }
    return out;
  }

  /* ---------- column actions ---------- */

  function addColumn(title) {
    var clean = String(title || '').trim().slice(0, 60) || 'New column';
    var column = { id: storage.uid('col'), title: clean, cardIds: [] };
    board.columns.push(column);
    commit({ type: 'add-column', columnId: column.id });
    return column;
  }

  function renameColumn(id, title) {
    var column = findColumn(id);
    var clean = String(title || '').trim().slice(0, 60);
    if (!column || !clean || clean === column.title) return;
    column.title = clean;
    commit({ type: 'rename-column', columnId: id });
  }

  // Deleting a column also deletes its cards. (Confirmation happens in the UI.)
  function deleteColumn(id) {
    for (var i = 0; i < board.columns.length; i++) {
      if (board.columns[i].id === id) {
        var cardIds = board.columns[i].cardIds;
        for (var j = 0; j < cardIds.length; j++) delete board.cards[cardIds[j]];
        board.columns.splice(i, 1);
        commit({ type: 'delete-column', columnId: id });
        return;
      }
    }
  }

  // toIndex is the position in the columns array AFTER the moved column is
  // removed — that is how dnd computes it, and it matches splice semantics.
  function moveColumn(id, toIndex) {
    var from = -1;
    for (var i = 0; i < board.columns.length; i++) {
      if (board.columns[i].id === id) { from = i; break; }
    }
    if (from === -1) return;
    var moved = board.columns.splice(from, 1)[0];
    board.columns.splice(Math.max(0, Math.min(toIndex, board.columns.length)), 0, moved);
    commit({ type: 'move-column', columnId: id });
  }

  /* ---------- card actions ---------- */

  function addCard(columnId, title) {
    var column = findColumn(columnId);
    var clean = String(title || '').trim().slice(0, 200);
    if (!column || !clean) return null;
    var card = {
      id: storage.uid('card'),
      title: clean,
      priority: 'medium',
      createdAt: nowISO(),
      updatedAt: nowISO()
    };
    board.cards[card.id] = card;
    column.cardIds.push(card.id);
    commit({ type: 'add-card', cardId: card.id, columnId: columnId });
    return card;
  }

  // patch keys: title, description, priority, dueDate, labels (string or array).
  // Empty strings mean "remove this optional field".
  function updateCard(id, patch) {
    var card = board.cards[id];
    if (!card) return;
    if ('title' in patch) card.title = String(patch.title || '').trim().slice(0, 200) || card.title;
    if ('description' in patch) setOrDelete(card, 'description', String(patch.description || '').trim());
    if ('priority' in patch) {
      if (storage.PRIORITIES.indexOf(patch.priority) !== -1) card.priority = patch.priority;
      else delete card.priority;
    }
    if ('dueDate' in patch) {
      if (typeof patch.dueDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(patch.dueDate)) {
        card.dueDate = patch.dueDate;
      } else {
        delete card.dueDate;
      }
    }
    if ('labels' in patch) {
      var labels = normalizeLabels(patch.labels);
      if (labels.length) card.labels = labels; else delete card.labels;
    }
    card.updatedAt = nowISO();
    commit({ type: 'update-card', cardId: id });
  }

  function deleteCard(id) {
    if (!board.cards[id]) return;
    for (var i = 0; i < board.columns.length; i++) {
      var cardIds = board.columns[i].cardIds;
      var at = cardIds.indexOf(id);
      if (at !== -1) cardIds.splice(at, 1);
    }
    delete board.cards[id];
    commit({ type: 'delete-card', cardId: id });
  }

  // toIndex is the position in the target column's cardIds AFTER the moved
  // card is removed — that is how dnd computes it.
  function moveCard(cardId, toColumnId, toIndex) {
    var to = findColumn(toColumnId);
    if (!to || !board.cards[cardId]) return;
    for (var i = 0; i < board.columns.length; i++) {
      var at = board.columns[i].cardIds.indexOf(cardId);
      if (at !== -1) board.columns[i].cardIds.splice(at, 1);
    }
    to.cardIds.splice(Math.max(0, Math.min(toIndex, to.cardIds.length)), 0, cardId);
    commit({ type: 'move-card', cardId: cardId, columnId: toColumnId });
  }

  /* ---------- whole-board actions ---------- */

  // Replace the entire board (import). Saves immediately so a crash cannot
  // leave storage holding the old board while memory holds the new one.
  function replaceBoard(next) {
    board = next;
    dirty = true;
    flushSave();
    for (var i = 0; i < changeListeners.length; i++) changeListeners[i]({ type: 'replace-board' }, board);
  }

  // Adopt a board another tab already wrote. Mark it as saved so this tab
  // does not write it straight back (which would ping-pong).
  function adoptBoard(next) {
    board = next;
    lastSavedJson = JSON.stringify(next);
    dirty = false;
    if (saveTimer !== null) { clearTimeout(saveTimer); saveTimer = null; }
    emitStatus('saved');
    for (var i = 0; i < changeListeners.length; i++) {
      changeListeners[i]({ type: 'replace-board', source: 'other-tab' }, board);
    }
  }

  /* ---------- lifecycle ---------- */

  // Load from storage (or seed the default) and save once so the key exists.
  // Returns the storage.loadBoard() result so the UI can report surprises.
  function init() {
    var result = storage.loadBoard();
    board = result.board;
    dirty = true;
    flushSave();
    return result;
  }

  function snapshotJson() {
    return lastSavedJson !== null ? lastSavedJson : JSON.stringify(board);
  }

  Kanban.state = {
    init: init,
    getBoard: getBoard,
    onChange: onChange,
    onStatus: onStatus,
    addColumn: addColumn,
    renameColumn: renameColumn,
    deleteColumn: deleteColumn,
    moveColumn: moveColumn,
    addCard: addCard,
    updateCard: updateCard,
    deleteCard: deleteCard,
    moveCard: moveCard,
    replaceBoard: replaceBoard,
    adoptBoard: adoptBoard,
    flushSave: flushSave,
    snapshotJson: snapshotJson
  };
}());

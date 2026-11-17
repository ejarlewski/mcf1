/* storage.js — all localStorage access, validation and backup logic.
 * The only module that touches localStorage. Depends on nothing else. */
(function () {
  'use strict';

  window.Kanban = window.Kanban || {};

  var KEY = 'kanban.board.v1';
  var THEME_KEY = 'kanban.theme';
  var SUPPORTED_VERSION = 1;
  var PRIORITIES = ['low', 'medium', 'high'];

  // localStorage can be blocked (private windows, disabled storage). Probe once.
  var available = true;
  try {
    var probeKey = KEY + '.probe';
    localStorage.setItem(probeKey, '1');
    localStorage.removeItem(probeKey);
  } catch (err) {
    available = false;
  }

  function isAvailable() { return available; }

  // Random id with a readable prefix, e.g. "card-9f86d081-...".
  // crypto.randomUUID() needs a secure context; file:// counts as one, but a
  // fallback keeps things working everywhere.
  function uid(prefix) {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return prefix + '-' + window.crypto.randomUUID();
    }
    var hex = '';
    while (hex.length < 32) {
      hex += Math.floor(Math.random() * 0x10000).toString(16).padStart(4, '0');
    }
    return prefix + '-' + hex.slice(0, 32);
  }

  // The board the app starts with on first run (or after recovery).
  function defaultBoard() {
    return {
      version: SUPPORTED_VERSION,
      columns: [
        { id: uid('col'), title: 'To Do', cardIds: [] },
        { id: uid('col'), title: 'In Progress', cardIds: [] },
        { id: uid('col'), title: 'Done', cardIds: [] }
      ],
      cards: {}
    };
  }

  function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function fail(error) { return { ok: false, error: error }; }

  /* Shape check for a parsed board: exactly the rules from the spec —
   * an object with a columns array and a cards object, every referenced
   * cardId exists, plus a few sanity extras (ids unique across columns,
   * priority values known, due dates well formed).
   * Returns { ok: true, board } or { ok: false, error }. Never mutates. */
  function validate(data) {
    if (!isObject(data)) return fail('The file does not contain a board object.');
    if (!Number.isInteger(data.version)) return fail('Missing or invalid "version" field.');
    if (data.version !== SUPPORTED_VERSION) {
      return fail('Unsupported board version ' + data.version +
        ' — this app understands version ' + SUPPORTED_VERSION + ' only.');
    }
    if (!Array.isArray(data.columns)) return fail('The board must have a "columns" array.');
    if (!isObject(data.cards)) return fail('The board must have a "cards" object.');

    var seen = {};
    for (var i = 0; i < data.columns.length; i++) {
      var col = data.columns[i];
      if (!isObject(col) || typeof col.id !== 'string' || !col.id) {
        return fail('Column ' + (i + 1) + ' needs a string "id".');
      }
      if (typeof col.title !== 'string' || col.title.trim() === '') {
        return fail('Column "' + col.id + '" needs a title.');
      }
      if (!Array.isArray(col.cardIds)) {
        return fail('Column "' + col.title.trim() + '" needs a "cardIds" array.');
      }
      for (var j = 0; j < col.cardIds.length; j++) {
        var cardId = col.cardIds[j];
        if (typeof cardId !== 'string' || !Object.prototype.hasOwnProperty.call(data.cards, cardId)) {
          return fail('Column "' + col.title.trim() + '" references card "' + cardId +
            '", which does not exist in "cards".');
        }
        if (seen[cardId]) return fail('Card "' + cardId + '" appears in more than one column.');
        seen[cardId] = true;
      }
    }

    var cardIds = Object.keys(data.cards);
    for (var k = 0; k < cardIds.length; k++) {
      var id = cardIds[k];
      var card = data.cards[id];
      if (!isObject(card) || card.id !== id) {
        return fail('Card "' + id + '" must be an object whose "id" matches its key.');
      }
      if (typeof card.title !== 'string' || card.title.length < 1 || card.title.length > 200) {
        return fail('Card "' + id + '" needs a title of 1 to 200 characters.');
      }
      if (card.priority !== undefined && PRIORITIES.indexOf(card.priority) === -1) {
        return fail('Card "' + id + '" has an unknown priority: ' + JSON.stringify(card.priority) + '.');
      }
      if (card.dueDate !== undefined && (typeof card.dueDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(card.dueDate))) {
        return fail('Card "' + id + '" has a due date that is not YYYY-MM-DD.');
      }
      if (card.description !== undefined && typeof card.description !== 'string') {
        return fail('Card "' + id + '" must have a string "description".');
      }
    }
    return { ok: true, board: data };
  }

  // Move an unreadable payload to a side key so it can still be inspected.
  function quarantine(raw) {
    try {
      localStorage.setItem(KEY + '.corrupt-' + Date.now(), raw);
    } catch (err) {
      // Nothing more we can do; the fresh default board is still returned.
    }
  }

  /* Load the board. Never throws. Returns { board, note, detail? }:
   *   note 'missing'     — first run, default board (will be written on first save)
   *   note 'corrupt'     — stored JSON unparseable; raw copy kept, default returned
   *   note 'invalid'     — parsed but failed validation; raw copy kept
   *   note 'unavailable' — localStorage blocked; the app runs from memory only
   *   note null          — loaded normally */
  function loadBoard() {
    if (!available) return { board: defaultBoard(), note: 'unavailable' };

    var raw;
    try {
      raw = localStorage.getItem(KEY);
    } catch (err) {
      available = false;
      return { board: defaultBoard(), note: 'unavailable' };
    }

    if (raw === null || raw === '') return { board: defaultBoard(), note: 'missing' };

    var parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      quarantine(raw);
      return { board: defaultBoard(), note: 'corrupt' };
    }

    var result = validate(parsed);
    if (!result.ok) {
      quarantine(raw);
      return { board: defaultBoard(), note: 'invalid', detail: result.error };
    }
    return { board: parsed, note: null };
  }

  /* Write the whole board, keeping the previous value in a ".bak" key first.
   * Never throws: storage failures come back as { ok: false, reason }. */
  function saveBoard(board) {
    if (!available) return { ok: false, reason: 'unavailable' };
    try {
      var json = JSON.stringify(board);
      var previous = localStorage.getItem(KEY);
      if (previous !== null) localStorage.setItem(KEY + '.bak', previous);
      localStorage.setItem(KEY, json);
      return { ok: true, json: json };
    } catch (err) {
      var name = (err && err.name) || '';
      if (name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED') {
        return { ok: false, reason: 'quota' };
      }
      return { ok: false, reason: 'blocked' };
    }
  }

  // Today's date as YYYY-MM-DD in local time (used for filenames and due dates).
  function todayISO() {
    var now = new Date();
    var local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 10);
  }

  // Download the board as a JSON file via a Blob and a temporary link.
  function exportFile(board) {
    var fileName = 'kanban-backup-' + todayISO() + '.json';
    var blob = new Blob([JSON.stringify(board, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    return fileName;
  }

  // Read, parse and validate a user-chosen backup file. The returned promise
  // never rejects: { ok: true, board } or { ok: false, error }.
  function readFile(file) {
    return new Promise(function (resolve) {
      var reader = new FileReader();
      reader.onload = function () {
        var parsed;
        try {
          parsed = JSON.parse(String(reader.result));
        } catch (err) {
          resolve(fail('That file is not valid JSON.'));
          return;
        }
        resolve(validate(parsed));
      };
      reader.onerror = function () { resolve(fail('Could not read that file.')); };
      reader.readAsText(file);
    });
  }

  /* Theme choice ('light' | 'dark'), stored separately from the board. */
  function getTheme() {
    try { return available ? localStorage.getItem(THEME_KEY) : null; } catch (err) { return null; }
  }
  function setTheme(theme) {
    try { if (available) localStorage.setItem(THEME_KEY, theme); } catch (err) { /* not critical */ }
  }

  // Ask the browser not to evict this origin's storage. Silently ignored when
  // unsupported (or denied).
  function requestPersistence() {
    try {
      if (navigator.storage && typeof navigator.storage.persist === 'function') {
        navigator.storage.persist().catch(function () { /* ignore */ });
      }
    } catch (err) { /* ignore */ }
  }

  Kanban.storage = {
    KEY: KEY,
    THEME_KEY: THEME_KEY,
    SUPPORTED_VERSION: SUPPORTED_VERSION,
    PRIORITIES: PRIORITIES,
    isAvailable: isAvailable,
    uid: uid,
    defaultBoard: defaultBoard,
    validate: validate,
    loadBoard: loadBoard,
    saveBoard: saveBoard,
    exportFile: exportFile,
    readFile: readFile,
    todayISO: todayISO,
    getTheme: getTheme,
    setTheme: setTheme,
    requestPersistence: requestPersistence
  };
}());

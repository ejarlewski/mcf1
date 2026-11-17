/* app.js — boot and wiring: header controls, theme, keyboard shortcuts,
 * cross-tab sync, and autosave safety nets. Must load last. */
(function () {
  'use strict';

  function boot() {
    function $(sel) { return document.querySelector(sel); }

    Kanban.storage.requestPersistence();

    Kanban.render.init({
      boardEl: $('#board'),
      modal: {
        backdrop: $('#modal-backdrop'),
        form: $('#card-form'),
        title: $('#f-title'),
        desc: $('#f-desc'),
        priority: $('#f-priority'),
        due: $('#f-due'),
        labels: $('#f-labels'),
        error: $('#form-error'),
        meta: $('#modal-meta'),
        close: $('#modal-close'),
        del: $('#modal-delete')
      }
    });

    /* ---------- status indicator and warning banner ---------- */

    var statusEl = $('#status');
    var banner = $('#banner');
    var lastRealStatus = { status: 'saved', message: '' };
    var flashTimer = null;

    var STATUS_TEXT = {
      saved: 'Saved',
      saving: 'Saving…',
      unavailable: 'Not saved — storage unavailable',
      error: 'Not saved'
    };

    function paintStatus(status, message) {
      statusEl.textContent = message || STATUS_TEXT[status] || '';
      statusEl.className = 'status status--' + status;
    }

    function flash(status, message) {
      paintStatus(status, message);
      if (flashTimer) clearTimeout(flashTimer);
      flashTimer = setTimeout(function () {
        paintStatus(lastRealStatus.status, lastRealStatus.message);
      }, 3500);
    }

    Kanban.state.onStatus(function (status, message) {
      if (flashTimer) { clearTimeout(flashTimer); flashTimer = null; }
      lastRealStatus = { status: status, message: message || '' };
      paintStatus(status, message);
    });

    // Re-render on board changes (app.js is loaded last, so this listener
    // exists before the initial load below, and before any drag can run).
    // Newly added cards get their entrance animation.
    Kanban.state.onChange(function (meta) {
      if (Kanban.dnd.isDragging()) return;
      Kanban.render.renderAll({
        animateCardId: meta && meta.type === 'add-card' ? meta.cardId : null
      });
    });

    /* ---------- theme (before the first render so accents match) ---------- */

    var themeBtn = $('#btn-theme');
    var lightQuery = window.matchMedia('(prefers-color-scheme: light)');

    function storedTheme() {
      var value = Kanban.storage.getTheme();
      return value === 'light' || value === 'dark' ? value : null;
    }

    function applyTheme(theme) {
      document.documentElement.dataset.theme = theme;
      themeBtn.textContent = '';
      themeBtn.appendChild(Kanban.render.icon(theme === 'dark' ? 'sun' : 'moon'));
      themeBtn.setAttribute('aria-label',
        theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
    }

    applyTheme(storedTheme() || (lightQuery.matches ? 'light' : 'dark'));

    themeBtn.addEventListener('click', function () {
      var next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      Kanban.storage.setTheme(next);
      applyTheme(next);
      Kanban.render.renderAll({ focus: false }); // accent palette follows the theme
    });

    lightQuery.addEventListener('change', function () {
      if (!storedTheme()) applyTheme(lightQuery.matches ? 'light' : 'dark');
    });

    /* ---------- drag and drop ---------- */

    Kanban.dnd.init($('#board'));

    /* ---------- load the board (seeds the default on first run) ---------- */

    var loaded = Kanban.state.init();
    Kanban.render.renderAll();

    if (loaded.note === 'unavailable' || !Kanban.storage.isAvailable()) {
      banner.hidden = false;
    }
    if (loaded.note === 'corrupt') {
      flash('error', 'Saved board was unreadable — a copy was kept, new board started');
    } else if (loaded.note === 'invalid') {
      flash('error', 'Saved board was invalid — a copy was kept, new board started');
    }

    /* ---------- header controls ---------- */

    var searchInput = $('#search');
    searchInput.addEventListener('input', function () {
      Kanban.render.setUI({ search: searchInput.value });
    });

    var filterSelect = $('#priority-filter');
    filterSelect.addEventListener('change', function () {
      Kanban.render.setUI({ priority: filterSelect.value });
    });

    function addCardFromHeader() {
      var columns = Kanban.state.getBoard().columns;
      if (!columns.length) {
        var column = Kanban.state.addColumn('New column');
        Kanban.render.openAddFor(column.id);
      } else {
        Kanban.render.openAddFor(columns[0].id);
      }
    }
    $('#btn-new-card').addEventListener('click', addCardFromHeader);

    /* ---------- export / import ---------- */

    $('#btn-export').addEventListener('click', function () {
      var name = Kanban.storage.exportFile(Kanban.state.getBoard());
      flash('saved', 'Exported ' + name);
    });

    var fileInput = $('#import-file');
    $('#btn-import').addEventListener('click', function () { fileInput.click(); });
    fileInput.addEventListener('change', function () {
      var file = fileInput.files && fileInput.files[0];
      fileInput.value = ''; // allow re-importing the same file later
      if (!file) return;
      Kanban.storage.readFile(file).then(function (result) {
        if (!result.ok) {
          window.alert('Could not import: ' + result.error +
            '\n\nYour current board was left untouched.');
          return;
        }
        var cards = Object.keys(result.board.cards).length;
        var ok = window.confirm('Replace the current board with "' + file.name + '"?\n\n' +
          'Import: ' + result.board.columns.length + ' column(s), ' + cards + ' card(s).\n' +
          'Your current board is kept as kanban.board.v1.bak.');
        if (!ok) {
          flash('saved', 'Import cancelled');
          return;
        }
        Kanban.state.replaceBoard(result.board);
        flash('saved', 'Board imported');
      });
    });

    /* ---------- keyboard shortcuts ---------- */

    document.addEventListener('keydown', function (e) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      var tag = e.target && e.target.tagName;
      var typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
      if (e.key === '/' && !typing) {
        e.preventDefault();
        searchInput.focus();
        searchInput.select();
      } else if ((e.key === 'n' || e.key === 'N') && !typing && !Kanban.render.isModalOpen()) {
        e.preventDefault();
        addCardFromHeader();
      }
    });

    /* ---------- cross-tab sync ---------- */

    window.addEventListener('storage', function (e) {
      if (e.key !== Kanban.storage.KEY) return;
      if (e.newValue === Kanban.state.snapshotJson()) return;
      if (e.newValue === null) {
        // Another tab cleared the board; fall back to the default view.
        Kanban.state.adoptBoard(Kanban.storage.defaultBoard());
        return;
      }
      var parsed;
      try { parsed = JSON.parse(e.newValue); } catch (err) { return; }
      var result = Kanban.storage.validate(parsed);
      if (result.ok) Kanban.state.adoptBoard(result.board);
    });

    /* ---------- autosave safety nets ---------- */

    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') Kanban.state.flushSave();
    });
    window.addEventListener('pagehide', function () { Kanban.state.flushSave(); });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
}());

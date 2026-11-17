/* render.js — draws everything: board, columns, cards, modal and inline edits.
 * Reads state through Kanban.state; mutates it through state actions only.
 * All user text goes in with textContent — innerHTML is used only for the
 * fixed, trusted SVG icon strings in ICONS below. */
(function () {
  'use strict';

  window.Kanban = window.Kanban || {};

  var storage = Kanban.storage;
  var state = Kanban.state;

  var SVG_NS = 'http://www.w3.org/2000/svg';
  var REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)');

  var ICONS = {
    plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
    trash: '<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>',
    grip: '<circle cx="9" cy="6" r="1.4"/><circle cx="9" cy="12" r="1.4"/><circle cx="9" cy="18" r="1.4"/><circle cx="15" cy="6" r="1.4"/><circle cx="15" cy="12" r="1.4"/><circle cx="15" cy="18" r="1.4"/>',
    clock: '<circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15.5 14"/>',
    close: '<line x1="6" y1="6" x2="18" y2="18"/><line x1="6" y1="18" x2="18" y2="6"/>',
    inbox: '<path d="M3 12l9-7 9 7v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M3 12h5l1.5 3h5L16 12h5"/>',
    sun: '<circle cx="12" cy="12" r="4"/><line x1="12" y1="2" x2="12" y2="4"/><line x1="12" y1="20" x2="12" y2="22"/><line x1="4.9" y1="4.9" x2="6.3" y2="6.3"/><line x1="17.7" y1="17.7" x2="19.1" y2="19.1"/><line x1="2" y1="12" x2="4" y2="12"/><line x1="20" y1="12" x2="22" y2="12"/><line x1="4.9" y1="19.1" x2="6.3" y2="17.7"/><line x1="17.7" y1="6.3" x2="19.1" y2="4.9"/>',
    moon: '<path d="M20.5 13.3A8.5 8.5 0 1 1 10.7 3.5a7 7 0 0 0 9.8 9.8z"/>',
    search: '<circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.5" y2="16.5"/>'
  };

  var ui = {
    search: '',
    priority: 'all',
    addingColumnId: null,   // column with an open "add card" input
    addDraft: '',
    renamingColumnId: null, // column whose title is being edited inline
    renameDraft: '',
    modalCardId: null       // card open in the edit modal (null = closed)
  };

  var boardEl = null;
  var modal = null; // map of modal elements, filled by init()
  var lastFocused = null; // restored when the modal closes

  /* ---------- small helpers ---------- */

  function icon(name, extraClass) {
    var svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    if (extraClass) svg.setAttribute('class', extraClass);
    svg.innerHTML = ICONS[name]; // trusted static markup
    return svg;
  }

  function iconButton(name, label, extraClass) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'icon-btn' + (extraClass ? ' ' + extraClass : '');
    btn.setAttribute('aria-label', label);
    btn.title = label;
    btn.appendChild(icon(name));
    return btn;
  }

  function textEl(tag, className, text) {
    var el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined) el.textContent = text;
    return el;
  }

  // Column accent colours come from CSS custom properties so they follow the
  // theme (bright neon in dark, deeper shades in light).
  function accentPalette() {
    var style = getComputedStyle(document.documentElement);
    return ['--accent-1', '--accent-2', '--accent-3'].map(function (name) {
      return style.getPropertyValue(name).trim() || '#22d3ee';
    });
  }

  /* ---------- filtering ---------- */

  function cardPassesFilter(card) {
    if (ui.priority !== 'all' && card.priority !== ui.priority) return false;
    if (ui.search) {
      var needle = ui.search.toLowerCase();
      var hay = (card.title + ' ' + (card.description || '') + ' ' +
        (card.labels || []).join(' ')).toLowerCase();
      if (hay.indexOf(needle) === -1) return false;
    }
    return true;
  }

  /* ---------- due dates ---------- */

  function shortDateTime(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return '';
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) +
      ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }

  // { label, overdue, soon } or null. Overdue means strictly before today and
  // the card is NOT in the last column (the "done-est" one).
  function dueInfo(card, isLastColumn) {
    if (!card.dueDate || !/^\d{4}-\d{2}-\d{2}$/.test(card.dueDate)) return null;
    var today = storage.todayISO();
    var parts = card.dueDate.split('-');
    var due = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    var overdue = card.dueDate < today && !isLastColumn;
    var now = new Date();
    var midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    var days = Math.round((due - midnight) / 86400000);
    var soon = !overdue && days >= 0 && days <= 2;
    var opts = { month: 'short', day: 'numeric' };
    if (due.getFullYear() !== now.getFullYear()) opts.year = 'numeric';
    return {
      label: due.toLocaleDateString(undefined, opts),
      overdue: overdue,
      soon: soon
    };
  }

  /* ---------- board rendering ---------- */

  // options: { focus: bool, animateCardId: string|null }
  function renderAll(options) {
    options = options || {};
    var board = state.getBoard();
    var palette = accentPalette();
    var lastIndex = board.columns.length - 1;

    boardEl.textContent = '';
    for (var i = 0; i < board.columns.length; i++) {
      boardEl.appendChild(buildColumn(board, board.columns[i], i, i === lastIndex,
        palette[i % palette.length], options.animateCardId || null));
    }
    boardEl.appendChild(buildAddColumnButton());

    if (options.focus !== false) focusInlineInputs();
  }

  function focusInlineInputs() {
    if (ui.renamingColumnId) {
      var rename = boardEl.querySelector('.column-title-input');
      if (rename) { rename.focus(); rename.select(); }
    } else if (ui.addingColumnId) {
      var add = boardEl.querySelector('.card-add-input');
      if (add) { add.focus(); add.setSelectionRange(add.value.length, add.value.length); }
    }
  }

  function buildColumn(board, column, index, isLast, accent, animateCardId) {
    var el = document.createElement('section');
    el.className = 'column';
    el.dataset.id = column.id;
    el.style.setProperty('--accent', accent);

    /* header: rename-able title, count badge, drag grip, delete */
    var head = document.createElement('header');
    head.className = 'column-head';

    var titleWrap = document.createElement('h2');
    titleWrap.className = 'column-title-wrap';
    if (ui.renamingColumnId === column.id) {
      var input = document.createElement('input');
      input.type = 'text';
      input.className = 'column-title-input';
      input.value = ui.renameDraft;
      input.maxLength = 60;
      input.setAttribute('aria-label', 'Column name');
      input.addEventListener('input', function () { ui.renameDraft = input.value; });
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); finishRename(true); }
        else if (e.key === 'Escape') { e.preventDefault(); finishRename(false); }
      });
      input.addEventListener('blur', function () { finishRename(true); });
      titleWrap.appendChild(input);
    } else {
      var titleBtn = document.createElement('button');
      titleBtn.type = 'button';
      titleBtn.className = 'column-title';
      titleBtn.textContent = column.title;
      titleBtn.title = 'Rename column';
      titleBtn.setAttribute('aria-label', 'Column: ' + column.title + '. Click to rename.');
      titleBtn.addEventListener('click', function () { startRename(column.id); });
      titleWrap.appendChild(titleBtn);
    }
    head.appendChild(titleWrap);

    var count = textEl('span', 'count', String(column.cardIds.length));
    count.setAttribute('aria-label', column.cardIds.length + ' cards in this column');
    head.appendChild(count);

    var grip = iconButton('grip', 'Drag to reorder column "' + column.title + '"', 'grip');
    grip.setAttribute('draggable', 'true');
    head.appendChild(grip);

    var del = iconButton('trash', 'Delete column "' + column.title + '"');
    del.addEventListener('click', function () {
      // Spec: deleting a non-empty column needs confirmation.
      if (column.cardIds.length > 0) {
        var n = column.cardIds.length;
        var ok = window.confirm('Delete column "' + column.title + '" and its ' +
          n + ' card' + (n === 1 ? '' : 's') + '?');
        if (!ok) return;
      }
      state.deleteColumn(column.id);
    });
    head.appendChild(del);

    el.appendChild(head);

    /* card list (only cards passing the search/priority filter are rendered) */
    var list = document.createElement('div');
    list.className = 'column-cards';
    var shown = 0;
    for (var i = 0; i < column.cardIds.length; i++) {
      var card = board.cards[column.cardIds[i]];
      if (!card || !cardPassesFilter(card)) continue;
      shown++;
      list.appendChild(buildCard(card, isLast, card.id === animateCardId));
    }
    if (shown === 0) {
      list.appendChild(buildEmpty(column.cardIds.length > 0));
    }
    el.appendChild(list);

    /* footer: inline add input or the "add a card" button */
    var foot = document.createElement('div');
    foot.className = 'column-foot';
    if (ui.addingColumnId === column.id) {
      var add = document.createElement('input');
      add.type = 'text';
      add.className = 'card-add-input';
      add.placeholder = 'Card title, then Enter';
      add.value = ui.addDraft;
      add.maxLength = 200;
      add.setAttribute('aria-label', 'New card in ' + column.title);
      add.addEventListener('input', function () { ui.addDraft = add.value; });
      add.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); finishAdd(true); }
        else if (e.key === 'Escape') { e.preventDefault(); finishAdd(false); }
      });
      add.addEventListener('blur', function () { finishAdd(true); });
      foot.appendChild(add);
      foot.appendChild(textEl('p', 'foot-hint', 'Enter saves · Esc cancels'));
    } else {
      var addBtn = document.createElement('button');
      addBtn.type = 'button';
      addBtn.className = 'add-card-btn';
      addBtn.appendChild(icon('plus'));
      addBtn.appendChild(textEl('span', null, 'Add a card'));
      addBtn.addEventListener('click', function () { startAdd(column.id); });
      foot.appendChild(addBtn);
    }
    el.appendChild(foot);

    return el;
  }

  function buildCard(card, isLast, animateIn) {
    var el = document.createElement('article');
    el.className = 'card';
    if (animateIn) el.classList.add('card-in-anim');
    el.dataset.id = card.id;
    el.dataset.priority = card.priority || 'none';
    el.draggable = true;
    el.tabIndex = 0;

    var due = dueInfo(card, isLast);
    if (due && due.overdue) el.classList.add('overdue');

    el.appendChild(textEl('h3', 'card-title', card.title));

    if (card.description) {
      el.appendChild(textEl('p', 'card-desc', card.description));
    }

    var foot = document.createElement('div');
    foot.className = 'card-foot';
    (card.labels || []).forEach(function (label) {
      foot.appendChild(textEl('span', 'chip chip-label', label));
    });
    if (due) {
      var chip = document.createElement('span');
      chip.className = 'chip chip-due';
      if (due.overdue) chip.classList.add('due-overdue');
      else if (due.soon) chip.classList.add('due-soon');
      chip.appendChild(icon('clock'));
      chip.appendChild(textEl('span', null, due.label));
      if (due.overdue) chip.setAttribute('aria-label', 'Due ' + due.label + ', overdue');
      foot.appendChild(chip);
    }
    if (foot.childNodes.length) el.appendChild(foot);

    var aria = card.title;
    if (card.priority) aria += ', priority ' + card.priority;
    if (due) aria += ', due ' + due.label + (due.overdue ? ' (overdue)' : '');
    el.setAttribute('aria-label', aria);

    el.addEventListener('click', function () {
      if (Kanban.dnd && Kanban.dnd.ignoreClick()) return; // swallow the click after a drag
      openEditor(card.id);
    });
    el.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openEditor(card.id);
      }
    });
    return el;
  }

  function buildEmpty(cardsHidden) {
    var wrap = document.createElement('div');
    wrap.className = 'empty';
    wrap.appendChild(icon('inbox'));
    wrap.appendChild(textEl('p', null,
      cardsHidden ? 'No cards match the search or filter.' : 'Nothing here yet.'));
    if (!cardsHidden) {
      wrap.appendChild(textEl('p', 'empty-hint', 'Add a card below, or drag one over.'));
    }
    return wrap;
  }

  function buildAddColumnButton() {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'add-column-btn';
    btn.setAttribute('aria-label', 'Add a column');
    btn.title = 'Add a column';
    btn.appendChild(icon('plus'));
    btn.appendChild(textEl('span', null, 'Column'));
    btn.addEventListener('click', function () {
      var column = state.addColumn('New column'); // commits, so re-open rename on top of that
      ui.renamingColumnId = column.id;
      ui.renameDraft = column.title;
      renderAll(); // focus the fresh rename input
    });
    return btn;
  }

  /* ---------- inline add / rename ---------- */

  function startAdd(columnId) {
    ui.addingColumnId = columnId;
    ui.addDraft = '';
    renderAll();
  }

  // Enter (commit true) saves, Escape (false) discards, blur commits what is
  // typed (documented in the README).
  function finishAdd(commitIt) {
    var columnId = ui.addingColumnId;
    if (columnId === null) return; // already closed (e.g. Escape fired first)
    var draft = ui.addDraft;
    ui.addingColumnId = null;
    ui.addDraft = '';
    if (commitIt && draft.trim()) state.addCard(columnId, draft);
    else renderAll({ focus: false });
  }

  function startRename(columnId) {
    var board = state.getBoard();
    for (var i = 0; i < board.columns.length; i++) {
      if (board.columns[i].id === columnId) {
        ui.renamingColumnId = columnId;
        ui.renameDraft = board.columns[i].title;
        renderAll();
        return;
      }
    }
  }

  function finishRename(commitIt) {
    var columnId = ui.renamingColumnId;
    if (columnId === null) return;
    var draft = ui.renameDraft;
    ui.renamingColumnId = null;
    ui.renameDraft = '';
    if (commitIt) state.renameColumn(columnId, draft); // ignores empty/same names
    renderAll({ focus: false });
  }

  /* ---------- edit modal ---------- */

  function initModal(refs) {
    modal = refs;
    modal.form.addEventListener('submit', function (e) {
      e.preventDefault();
      closeEditor('save');
    });
    modal.close.addEventListener('click', function () { closeEditor('auto'); });
    modal.backdrop.addEventListener('mousedown', function (e) {
      if (e.target === modal.backdrop) closeEditor('auto');
    });
    modal.backdrop.addEventListener('keydown', onModalKeydown);
    modal.del.addEventListener('click', function () {
      var card = state.getBoard().cards[ui.modalCardId];
      if (!card) return;
      if (!window.confirm('Delete "' + card.title + '"?')) return;
      var cardEl = boardEl.querySelector('.card[data-id="' + cssEscape(card.id) + '"]');
      closeEditor('skip');
      var remove = function () { state.deleteCard(card.id); };
      if (cardEl && !REDUCED_MOTION.matches) {
        cardEl.classList.add('card-exit');
        setTimeout(remove, 170); // let the exit animation play first
      } else {
        remove();
      }
    });
  }

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(value);
    return value.replace(/["\\]/g, '\\$&');
  }

  function openEditor(cardId) {
    var card = state.getBoard().cards[cardId];
    if (!card) return;
    lastFocused = document.activeElement;
    ui.modalCardId = cardId;

    modal.error.hidden = true;
    modal.title.value = card.title;
    modal.desc.value = card.description || '';
    modal.priority.value = card.priority || '';
    modal.due.value = card.dueDate || '';
    modal.labels.value = (card.labels || []).join(', ');
    modal.meta.textContent = 'created ' + shortDateTime(card.createdAt) +
      '  ·  updated ' + shortDateTime(card.updatedAt);

    modal.backdrop.hidden = false;
    modal.title.focus();
    modal.title.setSelectionRange(card.title.length, card.title.length);
  }

  // mode: 'save' (explicit, shows errors) | 'auto' (close gesture: save if
  // valid, otherwise discard) | 'skip' (just close).
  function closeEditor(mode) {
    if (ui.modalCardId === null) return;
    var cardId = ui.modalCardId;
    if (mode === 'skip') { hideModal(); return; }

    var title = modal.title.value.trim();
    var due = modal.due.value;
    if (mode === 'save' && (!title || title.length > 200 || (due && !/^\d{4}-\d{2}-\d{2}$/.test(due)))) {
      modal.error.textContent = !title
        ? 'A card needs a title (1–200 characters).'
        : (title.length > 200 ? 'The title must be 200 characters or fewer.' : 'The due date is not valid.');
      modal.error.hidden = false;
      modal.title.focus();
      return;
    }
    if (title) {
      state.updateCard(cardId, {
        title: title,
        description: modal.desc.value,
        priority: modal.priority.value,
        dueDate: due,
        labels: modal.labels.value
      });
    }
    hideModal();
  }

  function hideModal() {
    ui.modalCardId = null;
    modal.backdrop.hidden = true;
    modal.error.hidden = true;
    if (lastFocused && lastFocused.isConnected) lastFocused.focus();
    lastFocused = null;
  }

  function isModalOpen() { return ui.modalCardId !== null; }

  function onModalKeydown(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeEditor('auto');
      return;
    }
    if (e.key !== 'Tab') return;
    // Simple focus trap so Tab cannot wander behind the backdrop.
    var focusables = modal.backdrop.querySelectorAll(
      'button:not([hidden]), input:not([hidden]), textarea:not([hidden]), select:not([hidden])');
    if (!focusables.length) return;
    var first = focusables[0];
    var last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  /* ---------- public API ---------- */

  Kanban.render = {
    init: function (refs) {
      boardEl = refs.boardEl;
      initModal(refs.modal);
    },
    renderAll: renderAll,
    setUI: function (patch) {
      for (var key in patch) if (Object.prototype.hasOwnProperty.call(patch, key)) ui[key] = patch[key];
      renderAll({ focus: false });
    },
    openEditor: openEditor,
    isModalOpen: isModalOpen,
    openAddFor: startAdd, // used by the header "New card" button / N key
    icon: icon            // reused by app.js for the theme button
  };
}());

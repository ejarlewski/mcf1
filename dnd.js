/* dnd.js — HTML5 drag and drop. Cards can be reordered within a column and
 * moved between columns; the grip handle in a column header reorders columns.
 * The drop position is shown by a placeholder element that animates open;
 * the dragged element is dimmed in place. State is committed on drop. */
(function () {
  'use strict';

  window.Kanban = window.Kanban || {};

  var root = null;        // the .board element
  var drag = null;        // { kind: 'card' | 'column', id, height?, width? }
  var placeholder = null; // element marking the current drop position
  var dropTarget = null;  // column currently glowing as the drop target
  var clickGuardUntil = 0; // after a drag, browsers may fire a stray click

  function init(boardEl) {
    root = boardEl;
    root.addEventListener('dragstart', onDragStart);
    root.addEventListener('dragover', onDragOver);
    root.addEventListener('drop', onDrop);
    root.addEventListener('dragend', onDragEnd);
    root.addEventListener('dragleave', onDragLeave);
    // Drop outside the board should never navigate the page.
    document.addEventListener('dragover', function (e) { if (drag) e.preventDefault(); });
    document.addEventListener('drop', function (e) { if (drag) e.preventDefault(); });
  }

  /* ---------- start / end ---------- */

  function onDragStart(e) {
    var grip = e.target.closest ? e.target.closest('.grip') : null;
    if (grip) {
      var columnEl = grip.closest('.column');
      drag = {
        kind: 'column',
        id: columnEl.dataset.id,
        width: Math.round(columnEl.getBoundingClientRect().width)
      };
      e.dataTransfer.setData('text/plain', drag.id);
      e.dataTransfer.effectAllowed = 'move';
      // Let the browser snapshot the drag image before the element is dimmed.
      setTimeout(function () { columnEl.classList.add('drag-src'); }, 0);
      return;
    }

    var cardEl = e.target.closest ? e.target.closest('.card') : null;
    if (!cardEl) {
      e.preventDefault(); // don't allow dragging card text around
      return;
    }
    drag = {
      kind: 'card',
      id: cardEl.dataset.id,
      height: Math.round(cardEl.getBoundingClientRect().height)
    };
    e.dataTransfer.setData('text/plain', drag.id);
    e.dataTransfer.effectAllowed = 'move';
    setTimeout(function () { cardEl.classList.add('drag-src'); }, 0);
  }

  function onDragEnd() {
    if (!drag) return; // drop already cleaned up
    cleanup();
    clickGuardUntil = Date.now() + 250;
    Kanban.render.renderAll(); // put the DOM back in sync with state
  }

  /* ---------- dragover: position the placeholder ---------- */

  function onDragOver(e) {
    if (!drag) return;
    e.preventDefault(); // required to allow a drop
    e.dataTransfer.dropEffect = 'move';
    if (drag.kind === 'card') handleCardOver(e);
    else handleColumnOver(e);
  }

  function handleCardOver(e) {
    var columnEl = e.target.closest ? e.target.closest('.column') : null;
    if (!columnEl || columnEl.classList.contains('drag-src')) {
      clearMarks();
      return;
    }
    markColumn(columnEl);
    var list = columnEl.querySelector('.column-cards');
    if (!list) return;

    // Cards visible under the pointer, excluding the dragged source card.
    var cards = [];
    var kids = list.children;
    for (var i = 0; i < kids.length; i++) {
      if (kids[i].classList.contains('card') && !kids[i].classList.contains('drag-src')) {
        cards.push(kids[i]);
      }
    }

    // Insert before the first card whose midpoint is below the pointer.
    var before = null;
    for (var j = 0; j < cards.length; j++) {
      var rect = cards[j].getBoundingClientRect();
      if (e.clientY < rect.top + rect.height / 2) { before = cards[j]; break; }
    }
    setPlaceholder(list, before);
  }

  function handleColumnOver(e) {
    var overEl = e.target.closest ? e.target.closest('.column') : null;
    if (!overEl || overEl.classList.contains('drag-src')) {
      clearMarks();
      return;
    }
    markColumn(overEl);

    var rect = overEl.getBoundingClientRect();
    var insertBefore = e.clientX < rect.left + rect.width / 2;
    if (!placeholder) {
      placeholder = document.createElement('div');
      placeholder.className = 'drop-ph horiz';
      placeholder.style.setProperty('--ph-w', drag.width + 'px');
    }
    var next = insertBefore ? overEl : overEl.nextElementSibling;
    if (next === placeholder) next = next.nextElementSibling;
    if (placeholder.parentNode === root && placeholder.nextElementSibling === next) return;
    root.insertBefore(placeholder, next);
  }

  function setPlaceholder(list, before) {
    if (!placeholder) {
      placeholder = document.createElement('div');
      placeholder.className = 'drop-ph';
      placeholder.style.setProperty('--ph-h', drag.height + 'px');
    }
    if (placeholder.parentNode !== list || placeholder.nextElementSibling !== (before || null)) {
      list.insertBefore(placeholder, before || null);
    }
  }

  function markColumn(columnEl) {
    if (dropTarget === columnEl) return;
    if (dropTarget) dropTarget.classList.remove('drop-target');
    columnEl.classList.add('drop-target');
    dropTarget = columnEl;
  }

  function clearMarks() {
    if (placeholder) { placeholder.remove(); placeholder = null; }
    if (dropTarget) { dropTarget.classList.remove('drop-target'); dropTarget = null; }
  }

  function onDragLeave(e) {
    if (!drag) return;
    var to = e.relatedTarget;
    if (to instanceof Node && root.contains(to)) return; // moving within the board
    clearMarks();
  }

  /* ---------- drop: commit the move ---------- */

  function onDrop(e) {
    if (!drag) return;
    e.preventDefault();
    var info = drag;
    var ph = placeholder;

    if (ph && ph.parentNode) {
      if (info.kind === 'card') {
        var columnEl = ph.parentNode.closest('.column');
        if (columnEl) {
          // Target index: the index of the card element sitting just after
          // the placeholder (works even when filters hide other cards);
          // at the end of the list it is the column's full length.
          var board = Kanban.state.getBoard();
          var column = null;
          for (var i = 0; i < board.columns.length; i++) {
            if (board.columns[i].id === columnEl.dataset.id) { column = board.columns[i]; break; }
          }
          if (column) {
            var anchor = ph.nextElementSibling;
            var index;
            if (anchor && anchor.classList.contains('card')) {
              index = column.cardIds.indexOf(anchor.dataset.id);
              if (index === -1) index = column.cardIds.length;
            } else {
              index = column.cardIds.length;
            }
            cleanup();
            Kanban.state.moveCard(info.id, column.id, index);
            return;
          }
        }
      } else {
        // Columns: index within the columns as they would be after the
        // dragged column is removed (drag-src elements are excluded).
        var live = [];
        var kids = root.children;
        for (var k = 0; k < kids.length; k++) {
          if (kids[k].classList.contains('column') && !kids[k].classList.contains('drag-src')) {
            live.push(kids[k]);
          }
        }
        var anchorCol = ph.nextElementSibling;
        var colIndex;
        if (anchorCol && anchorCol.classList.contains('column')) {
          colIndex = live.indexOf(anchorCol);
          if (colIndex === -1) colIndex = live.length;
        } else {
          colIndex = live.length;
        }
        cleanup();
        Kanban.state.moveColumn(info.id, colIndex);
        return;
      }
    }

    // No placeholder placed (dropped outside a valid target): just reset.
    cleanup();
    Kanban.render.renderAll();
  }

  function cleanup() {
    drag = null;
    clickGuardUntil = Date.now() + 250;
    if (placeholder) { placeholder.remove(); placeholder = null; }
    if (dropTarget) { dropTarget.classList.remove('drop-target'); dropTarget = null; }
    var srcs = root.querySelectorAll('.drag-src');
    for (var i = 0; i < srcs.length; i++) srcs[i].classList.remove('drag-src');
  }

  /* ---------- public API ---------- */

  Kanban.dnd = {
    init: init,
    isDragging: function () { return drag !== null; },
    // render.js asks this before opening the modal on card click.
    ignoreClick: function () { return Date.now() < clickGuardUntil; }
  };
}());

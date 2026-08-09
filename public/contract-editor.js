/**
 * Shared contenteditable contract editor helpers (project + admin templates).
 * Inserts dividers, tables, and interactive signing fields (initials / checkboxes).
 */
(function (global) {
  function uuid() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text ?? '';
    return div.innerHTML;
  }

  function getSelectionInside(editor) {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount || !editor) return null;
    const range = sel.getRangeAt(0);
    if (!editor.contains(range.commonAncestorContainer)) return null;
    return { sel, range };
  }

  function insertHtml(editor, html) {
    if (!editor) return;
    editor.focus();

    const temp = document.createElement('div');
    temp.innerHTML = String(html || '').trim();
    const frag = document.createDocumentFragment();
    const nodes = [];
    while (temp.firstChild) {
      nodes.push(temp.firstChild);
      frag.appendChild(temp.firstChild);
    }
    if (!nodes.length) return;

    const inside = getSelectionInside(editor);
    if (inside) {
      inside.range.deleteContents();
      inside.range.insertNode(frag);
      const last = nodes[nodes.length - 1];
      const range = document.createRange();
      range.setStartAfter(last);
      range.collapse(true);
      inside.sel.removeAllRanges();
      inside.sel.addRange(range);
      return;
    }

    editor.appendChild(frag);
  }

  function insertDivider(editor) {
    insertHtml(editor, '<hr class="contract-divider"><p><br></p>');
  }

  const TABLE_MAX_ROWS = 20;
  const TABLE_MAX_COLS = 12;

  function insertTable(editor, rows = 3, cols = 3) {
    const r = Math.max(1, Math.min(TABLE_MAX_ROWS, Number(rows) || 3));
    const c = Math.max(1, Math.min(TABLE_MAX_COLS, Number(cols) || 3));
    let html = '<table class="contract-table"><tbody>';
    for (let i = 0; i < r; i++) {
      html += '<tr>';
      for (let j = 0; j < c; j++) {
        const tag = i === 0 ? 'th' : 'td';
        html += `<${tag}>${i === 0 ? `Column ${j + 1}` : '&nbsp;'}</${tag}>`;
      }
      html += '</tr>';
    }
    html += '</tbody></table><p><br></p>';
    insertHtml(editor, html);
  }

  function getTableFromSelection(editor) {
    const inside = getSelectionInside(editor);
    if (!inside) return null;
    let node = inside.range.commonAncestorContainer;
    if (node.nodeType === Node.TEXT_NODE) node = node.parentElement;
    const cell = node?.closest?.('td, th');
    const table = cell?.closest?.('table.contract-table') || node?.closest?.('table.contract-table');
    if (!table || !editor.contains(table)) return null;
    return { table, cell: cell || null, row: cell?.parentElement || null };
  }

  function tableColCount(table) {
    const first = table.querySelector('tr');
    return first ? first.children.length : 0;
  }

  function focusCell(cell) {
    if (!cell) return;
    const range = document.createRange();
    range.selectNodeContents(cell);
    range.collapse(true);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }

  function addTableRow(table, afterRow = null) {
    if (!table) return false;
    const rows = table.querySelectorAll('tr');
    if (rows.length >= TABLE_MAX_ROWS) return false;
    const cols = tableColCount(table) || 1;
    const tr = document.createElement('tr');
    for (let i = 0; i < cols; i++) {
      const td = document.createElement('td');
      td.innerHTML = '&nbsp;';
      tr.appendChild(td);
    }
    const tbody = table.tBodies[0] || table;
    if (afterRow && afterRow.parentElement === tbody) {
      afterRow.insertAdjacentElement('afterend', tr);
    } else {
      tbody.appendChild(tr);
    }
    focusCell(tr.cells[0]);
    return true;
  }

  function addTableColumn(table, afterCell = null) {
    if (!table) return false;
    const cols = tableColCount(table);
    if (cols >= TABLE_MAX_COLS) return false;
    const insertAt = afterCell
      ? Array.from(afterCell.parentElement.children).indexOf(afterCell) + 1
      : cols;
    table.querySelectorAll('tr').forEach((tr, rowIndex) => {
      const tag = rowIndex === 0 && tr.querySelector('th') ? 'th' : 'td';
      const cell = document.createElement(tag);
      cell.innerHTML = tag === 'th' ? `Column ${insertAt + 1}` : '&nbsp;';
      const ref = tr.children[insertAt] || null;
      if (ref) tr.insertBefore(cell, ref);
      else tr.appendChild(cell);
    });
    const focusRow = afterCell?.parentElement || table.querySelector('tr');
    focusCell(focusRow?.children[insertAt]);
    return true;
  }

  function deleteTableRow(table, row = null) {
    if (!table) return false;
    const rows = table.querySelectorAll('tr');
    if (rows.length <= 1) return false;
    const target = row && row.parentElement ? row : rows[rows.length - 1];
    const next = target.nextElementSibling || target.previousElementSibling;
    target.remove();
    if (next) focusCell(next.cells?.[0] || next.querySelector('td, th'));
    return true;
  }

  function deleteTableColumn(table, cell = null) {
    if (!table) return false;
    const cols = tableColCount(table);
    if (cols <= 1) return false;
    const index = cell
      ? Array.from(cell.parentElement.children).indexOf(cell)
      : cols - 1;
    if (index < 0) return false;
    table.querySelectorAll('tr').forEach((tr) => {
      if (tr.children[index]) tr.children[index].remove();
    });
    const focusRow = cell?.parentElement || table.querySelector('tr');
    const focusIndex = Math.min(index, (focusRow?.children.length || 1) - 1);
    focusCell(focusRow?.children[focusIndex]);
    return true;
  }

  function insertInitials(editor, { label = 'Initials' } = {}) {
    const id = uuid();
    const html = `<div class="contract-field contract-initials" data-field-id="${id}" data-field-type="initials" data-required="true" contenteditable="false"><span class="contract-field-label" contenteditable="true">${escapeHtml(label)}</span><span class="contract-field-box" data-placeholder="Initials"></span></div><p><br></p>`;
    insertHtml(editor, html);
  }

  function insertCheckbox(editor, { label = 'I acknowledge and agree to the above.' } = {}) {
    const id = uuid();
    const html = `<div class="contract-field contract-checkbox" data-field-id="${id}" data-field-type="checkbox" data-required="true" contenteditable="false"><span class="contract-field-box" aria-hidden="true"></span><span class="contract-field-label" contenteditable="true">${escapeHtml(label)}</span></div><p><br></p>`;
    insertHtml(editor, html);
  }

  function execCmd(editor, command, value = null) {
    if (!editor) return;
    editor.focus();
    document.execCommand(command, false, value);
  }

  function normalizePastedTables(editor) {
    if (!editor) return;
    editor.querySelectorAll('table:not(.contract-table)').forEach((table) => {
      table.classList.add('contract-table');
    });
  }

  let tableControlsEl = null;
  let tableControlsState = {
    editor: null,
    table: null,
    cell: null,
    row: null,
    hideTimer: null
  };

  function ensureTableControls() {
    if (tableControlsEl) return tableControlsEl;
    tableControlsEl = document.createElement('div');
    tableControlsEl.id = 'contractTableControls';
    tableControlsEl.className = 'contract-table-controls';
    tableControlsEl.hidden = true;
    tableControlsEl.innerHTML = `
      <button type="button" data-table-action="add-row" title="Add row">+ Row</button>
      <button type="button" data-table-action="add-col" title="Add column">+ Col</button>
      <span class="contract-table-controls-sep" aria-hidden="true"></span>
      <button type="button" data-table-action="del-row" title="Delete row">− Row</button>
      <button type="button" data-table-action="del-col" title="Delete column">− Col</button>
    `;
    document.body.appendChild(tableControlsEl);

    tableControlsEl.addEventListener('mouseenter', () => {
      clearTimeout(tableControlsState.hideTimer);
    });
    tableControlsEl.addEventListener('mouseleave', () => {
      scheduleHideTableControls();
    });
    tableControlsEl.addEventListener('mousedown', (e) => {
      // Keep caret/selection in the table while clicking controls
      e.preventDefault();
    });
    tableControlsEl.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-table-action]');
      if (!btn || !tableControlsState.table) return;
      const { table, cell, row, editor } = tableControlsState;
      editor?.focus();
      switch (btn.dataset.tableAction) {
        case 'add-row':
          if (!addTableRow(table, row)) {
            window.showAlertModal?.(`Tables can have at most ${TABLE_MAX_ROWS} rows.`, 'info');
          }
          break;
        case 'add-col':
          if (!addTableColumn(table, cell)) {
            window.showAlertModal?.(`Tables can have at most ${TABLE_MAX_COLS} columns.`, 'info');
          }
          break;
        case 'del-row':
          if (!deleteTableRow(table, row)) {
            window.showAlertModal?.('A table needs at least one row.', 'info');
          }
          break;
        case 'del-col':
          if (!deleteTableColumn(table, cell)) {
            window.showAlertModal?.('A table needs at least one column.', 'info');
          }
          break;
        default:
          break;
      }
      // Refresh target cell after mutation
      const ctx = getTableFromSelection(editor) || { table, cell: null, row: null };
      if (ctx.table) {
        showTableControls(editor, ctx.table, ctx.cell, ctx.row);
      } else {
        hideTableControls();
      }
    });

    window.addEventListener('scroll', repositionTableControls, true);
    window.addEventListener('resize', repositionTableControls);
    return tableControlsEl;
  }

  function repositionTableControls() {
    const { table } = tableControlsState;
    const el = tableControlsEl;
    if (!table || !el || el.hidden) return;
    if (!document.body.contains(table)) {
      hideTableControls();
      return;
    }
    const rect = table.getBoundingClientRect();
    const barWidth = el.offsetWidth || 220;
    const left = Math.min(
      Math.max(8, rect.right - barWidth),
      window.innerWidth - barWidth - 8
    );
    const top = Math.max(8, rect.top - el.offsetHeight - 6);
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  }

  function showTableControls(editor, table, cell = null, row = null) {
    clearTimeout(tableControlsState.hideTimer);
    hideFieldControls();
    const el = ensureTableControls();
    tableControlsState.editor = editor;
    tableControlsState.table = table;
    tableControlsState.cell = cell;
    tableControlsState.row = row;
    editor.querySelectorAll('table.contract-table.is-table-hover').forEach((t) => {
      if (t !== table) t.classList.remove('is-table-hover');
    });
    table.classList.add('is-table-hover');
    el.hidden = false;
    repositionTableControls();
  }

  function hideTableControls() {
    clearTimeout(tableControlsState.hideTimer);
    if (tableControlsState.table) {
      tableControlsState.table.classList.remove('is-table-hover');
    }
    tableControlsState.editor = null;
    tableControlsState.table = null;
    tableControlsState.cell = null;
    tableControlsState.row = null;
    if (tableControlsEl) tableControlsEl.hidden = true;
  }

  function scheduleHideTableControls() {
    clearTimeout(tableControlsState.hideTimer);
    tableControlsState.hideTimer = setTimeout(() => {
      hideTableControls();
    }, 180);
  }

  let fieldControlsEl = null;
  let fieldControlsState = {
    editor: null,
    field: null,
    hideTimer: null
  };

  function ensureFieldControls() {
    if (fieldControlsEl) return fieldControlsEl;
    fieldControlsEl = document.createElement('div');
    fieldControlsEl.id = 'contractFieldControls';
    fieldControlsEl.className = 'contract-field-controls';
    fieldControlsEl.hidden = true;
    fieldControlsEl.innerHTML = `
      <button type="button" data-field-action="remove" title="Remove this field">Remove</button>
    `;
    document.body.appendChild(fieldControlsEl);

    fieldControlsEl.addEventListener('mouseenter', () => {
      clearTimeout(fieldControlsState.hideTimer);
    });
    fieldControlsEl.addEventListener('mouseleave', () => {
      scheduleHideFieldControls();
    });
    fieldControlsEl.addEventListener('mousedown', (e) => {
      e.preventDefault();
    });
    fieldControlsEl.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-field-action="remove"]');
      if (!btn || !fieldControlsState.field) return;
      const { editor, field } = fieldControlsState;
      removeContractField(editor, field);
    });

    window.addEventListener('scroll', repositionFieldControls, true);
    window.addEventListener('resize', repositionFieldControls);
    return fieldControlsEl;
  }

  function repositionFieldControls() {
    const { field } = fieldControlsState;
    const el = fieldControlsEl;
    if (!field || !el || el.hidden) return;
    if (!document.body.contains(field)) {
      hideFieldControls();
      return;
    }
    const rect = field.getBoundingClientRect();
    const barWidth = el.offsetWidth || 90;
    const left = Math.min(
      Math.max(8, rect.right - barWidth),
      window.innerWidth - barWidth - 8
    );
    const top = Math.max(8, rect.top - el.offsetHeight - 6);
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  }

  function showFieldControls(editor, field) {
    clearTimeout(fieldControlsState.hideTimer);
    hideTableControls();
    const el = ensureFieldControls();
    fieldControlsState.editor = editor;
    fieldControlsState.field = field;
    editor.querySelectorAll('.contract-field.is-field-hover').forEach((f) => {
      if (f !== field) f.classList.remove('is-field-hover');
    });
    field.classList.add('is-field-hover');
    el.hidden = false;
    repositionFieldControls();
  }

  function hideFieldControls() {
    clearTimeout(fieldControlsState.hideTimer);
    if (fieldControlsState.field) {
      fieldControlsState.field.classList.remove('is-field-hover');
    }
    fieldControlsState.editor = null;
    fieldControlsState.field = null;
    if (fieldControlsEl) fieldControlsEl.hidden = true;
  }

  function scheduleHideFieldControls() {
    clearTimeout(fieldControlsState.hideTimer);
    fieldControlsState.hideTimer = setTimeout(() => {
      hideFieldControls();
    }, 180);
  }

  function removeContractField(editor, field) {
    if (!editor || !field || !editor.contains(field)) return;
    const next = field.nextSibling;
    field.remove();
    hideFieldControls();
    editor.focus();
    // Place caret after the removed field when possible
    const sel = window.getSelection();
    const range = document.createRange();
    if (next && next.nodeType === Node.ELEMENT_NODE) {
      range.setStart(next, 0);
    } else if (next) {
      range.setStart(next, 0);
    } else {
      range.selectNodeContents(editor);
      range.collapse(false);
    }
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
  }

  function selectedContractField(editor) {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount || !editor) return null;
    const node = sel.getRangeAt(0).commonAncestorContainer;
    const el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    const field = el?.closest?.('.contract-field');
    if (field && editor.contains(field)) return field;
    // Fully selected field node
    if (sel.rangeCount === 1) {
      const range = sel.getRangeAt(0);
      const selected = range.cloneContents().querySelector?.('.contract-field')
        || (range.startContainer === range.endContainer
          && range.startContainer.nodeType === Node.ELEMENT_NODE
          && range.startContainer.classList?.contains('contract-field')
          ? range.startContainer
          : null);
      if (selected && editor.contains(selected)) return selected;
      const child = range.startContainer.childNodes?.[range.startOffset];
      if (child?.classList?.contains('contract-field')) return child;
    }
    return null;
  }

  function bindEditor(editor) {
    if (!editor || editor.dataset.contractEditorBound === '1') return;
    editor.dataset.contractEditorBound = '1';

    editor.addEventListener('paste', () => {
      setTimeout(() => normalizePastedTables(editor), 0);
    });

    editor.addEventListener('click', (e) => {
      const field = e.target.closest('.contract-field');
      if (field && editor.contains(field) && !e.target.closest('.contract-field-label')) {
        e.preventDefault();
        const sel = window.getSelection();
        const range = document.createRange();
        range.selectNode(field);
        sel.removeAllRanges();
        sel.addRange(range);
        showFieldControls(editor, field);
      }
    });

    editor.addEventListener('keydown', (e) => {
      if (e.key !== 'Backspace' && e.key !== 'Delete') return;
      const field = selectedContractField(editor);
      if (!field) return;
      // Don't steal Backspace while editing the label text
      if (e.target.closest?.('.contract-field-label') || document.activeElement?.closest?.('.contract-field-label')) {
        return;
      }
      e.preventDefault();
      removeContractField(editor, field);
    });

    editor.addEventListener('mouseover', (e) => {
      const field = e.target.closest?.('.contract-field');
      if (field && editor.contains(field)) {
        showFieldControls(editor, field);
        return;
      }
      const cell = e.target.closest?.('td, th');
      const table = cell?.closest?.('table.contract-table') || e.target.closest?.('table.contract-table');
      if (!table || !editor.contains(table)) return;
      hideFieldControls();
      const row = cell?.parentElement || null;
      showTableControls(editor, table, cell || null, row);
    });

    editor.addEventListener('mouseout', (e) => {
      const related = e.relatedTarget;
      if (related && (editor.contains(related) || tableControlsEl?.contains(related) || fieldControlsEl?.contains(related))) {
        const nextField = related.closest?.('.contract-field');
        if (nextField && editor.contains(nextField)) return;
        const nextTable = related.closest?.('table.contract-table');
        if (nextTable && editor.contains(nextTable)) return;
        if (tableControlsEl?.contains(related) || fieldControlsEl?.contains(related)) return;
      }
      scheduleHideTableControls();
      scheduleHideFieldControls();
    });
  }

  async function promptFields(options) {
    if (typeof window.showPromptModal === 'function') {
      return window.showPromptModal(options);
    }
    // Fallback if modals.js is unavailable
    const first = (options.fields || [])[0];
    if (!first) return {};
    const value = window.prompt(first.label || options.title || 'Input', first.value != null ? String(first.value) : '');
    if (value === null) return null;
    return { [first.name]: value };
  }

  function mountToolbar(container, { getEditorEl } = {}) {
    if (!container) return null;

    // Drop any prior listeners if this toolbar node is remounted
    if (container.dataset.contractToolbarBound === '1') {
      const clean = container.cloneNode(false);
      clean.id = container.id;
      clean.className = container.className;
      container.replaceWith(clean);
      container = clean;
    }
    container.dataset.contractToolbarBound = '1';

    const resolveEditor = typeof getEditorEl === 'function'
      ? getEditorEl
      : () => document.getElementById(getEditorEl);

    container.innerHTML = `
      <div class="contract-toolbar-group">
        <button type="button" data-cmd="bold" title="Bold"><strong>B</strong></button>
        <button type="button" data-cmd="italic" title="Italic"><em>I</em></button>
        <button type="button" data-cmd="underline" title="Underline"><u>U</u></button>
        <button type="button" data-cmd="formatBlock" data-value="h3" title="Heading">H</button>
        <button type="button" data-cmd="formatBlock" data-value="p" title="Paragraph">¶</button>
        <button type="button" data-cmd="insertUnorderedList" title="Bullet list">• List</button>
        <button type="button" data-cmd="undo" title="Undo">↩</button>
      </div>
      <div class="contract-toolbar-sep" aria-hidden="true"></div>
      <div class="contract-toolbar-group">
        <button type="button" data-insert="divider" title="Insert divider">Divider</button>
        <button type="button" data-insert="table" title="Insert table">Table</button>
        <button type="button" data-insert="initials" title="Insert initials field">Initials</button>
        <button type="button" data-insert="checkbox" title="Insert checkbox">Checkbox</button>
      </div>`;

    const api = {
      getEditor: resolveEditor,
      execCmd(command, value = null) {
        execCmd(resolveEditor(), command, value);
      },
      insertDivider() {
        insertDivider(resolveEditor());
      },
      insertTable(rows, cols) {
        insertTable(resolveEditor(), rows, cols);
      },
      insertInitials(opts) {
        insertInitials(resolveEditor(), opts);
      },
      insertCheckbox(opts) {
        insertCheckbox(resolveEditor(), opts);
      }
    };

    let insertInFlight = false;

    container.addEventListener('mousedown', (e) => {
      // Keep editor selection when clicking toolbar
      if (e.target.closest('button')) e.preventDefault();
    });

    container.addEventListener('click', async (e) => {
      const btn = e.target.closest('button');
      if (!btn || !container.contains(btn)) return;
      if (insertInFlight) return;
      const editor = resolveEditor();
      if (!editor) return;
      bindEditor(editor);

      if (btn.dataset.cmd) {
        execCmd(editor, btn.dataset.cmd, btn.dataset.value || null);
        return;
      }

      if (!btn.dataset.insert) return;

      insertInFlight = true;
      try {
        switch (btn.dataset.insert) {
          case 'divider':
            insertDivider(editor);
            break;
          case 'table': {
            const values = await promptFields({
              title: 'Insert table',
              message: 'Choose starting size. Hover the table afterward to add or remove rows and columns.',
              confirmText: 'Insert table',
              fields: [
                { name: 'rows', label: 'Rows', type: 'number', value: 3, min: 1, max: TABLE_MAX_ROWS, required: true },
                { name: 'cols', label: 'Columns', type: 'number', value: 3, min: 1, max: TABLE_MAX_COLS, required: true }
              ]
            });
            if (!values) break;
            insertTable(editor, Number(values.rows) || 3, Number(values.cols) || 3);
            const tables = editor.querySelectorAll('table.contract-table');
            const last = tables[tables.length - 1];
            const firstCell = last?.querySelector('th, td');
            if (last && firstCell) {
              editor.focus();
              focusCell(firstCell);
              showTableControls(editor, last, firstCell, firstCell.parentElement);
            }
            break;
          }
          case 'initials': {
            const values = await promptFields({
              title: 'Insert initials field',
              message: 'Label shown next to the initials box on the contract.',
              confirmText: 'Insert initials',
              fields: [
                { name: 'label', label: 'Label', type: 'text', value: 'Initials', required: true, placeholder: 'Initials' }
              ]
            });
            if (!values) break;
            insertInitials(editor, { label: (values.label || '').trim() || 'Initials' });
            break;
          }
          case 'checkbox': {
            const values = await promptFields({
              title: 'Insert checkbox',
              message: 'Acknowledgment text the client must check before signing.',
              confirmText: 'Insert checkbox',
              fields: [
                {
                  name: 'label',
                  label: 'Acknowledgment text',
                  type: 'text',
                  value: 'I acknowledge and agree to the above.',
                  required: true
                }
              ]
            });
            if (!values) break;
            insertCheckbox(editor, {
              label: (values.label || '').trim() || 'I acknowledge and agree to the above.'
            });
            break;
          }
          default:
            break;
        }
      } finally {
        insertInFlight = false;
      }
    });

    const editor = resolveEditor();
    if (editor) bindEditor(editor);

    return api;
  }

  /** Strip hover-only class before persisting editor HTML. */
  function getEditorHtml(editor) {
    if (!editor) return '';
    const clone = editor.cloneNode(true);
    clone.querySelectorAll('.is-table-hover, .is-field-hover').forEach((el) => {
      el.classList.remove('is-table-hover', 'is-field-hover');
    });
    clone.querySelectorAll(
      '#contractTableControls, .contract-table-controls, #contractFieldControls, .contract-field-controls'
    ).forEach((el) => el.remove());
    return clone.innerHTML;
  }

  /** Stamp completed field values onto DOM nodes (signed preview). */
  function applyFieldResponses(root, responses) {
    if (!root) return;
    const map = new Map((responses || []).map((r) => [String(r.fieldId), r]));
    root.querySelectorAll('.contract-field').forEach((field) => {
      const id = field.getAttribute('data-field-id');
      const response = map.get(String(id));
      const type = field.getAttribute('data-field-type');
      const box = field.querySelector('.contract-field-box');
      field.classList.toggle('is-complete', !!response);
      if (type === 'initials' && box) {
        box.textContent = response?.value || '';
        box.classList.toggle('is-filled', !!(response?.value));
      }
      if (type === 'checkbox') {
        const checked = response?.value === 'true' || response?.value === true;
        field.classList.toggle('is-checked', checked);
        if (box) box.classList.toggle('is-checked', checked);
      }
    });
  }

  global.ContractEditor = {
    uuid,
    mountToolbar,
    bindEditor,
    insertDivider,
    insertTable,
    insertInitials,
    insertCheckbox,
    addTableRow,
    addTableColumn,
    deleteTableRow,
    deleteTableColumn,
    getTableFromSelection,
    getEditorHtml,
    execCmd,
    normalizePastedTables,
    applyFieldResponses
  };
})(window);

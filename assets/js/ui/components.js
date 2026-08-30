/**
 * Component dùng chung: toast, modal, hộp xác nhận, badge trạng thái.
 * Mọi chuỗi động đều đi qua `html`/`escapeHtml` — không bao giờ nối chuỗi thô.
 */

import { html, escapeHtml, raw, formatMinutes, pct } from '../core/util.js';
import { on, EV } from '../core/bus.js';
import {
  STATUS_META, IDEA_META, SET_STATUS_META, ROLE_LABEL, HINT_LEVEL_META,
} from '../domain/constants.js';

/* =============================================================== toast == */

const TOAST_ICON = { ok: '✓', err: '✕', warn: '⚠', info: 'ℹ' };

export function toast(text, type = 'info', ms = 4200) {
  const root = document.getElementById('toast-root');
  if (!root) return;
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.innerHTML = html`<span aria-hidden="true">${TOAST_ICON[type] ?? 'ℹ'}</span><span>${text}</span>`;
  root.appendChild(el);
  const kill = () => { el.style.opacity = '0'; setTimeout(() => el.remove(), 200); };
  setTimeout(kill, ms);
  el.addEventListener('click', kill);
}

// Cho phép tầng dữ liệu bắn toast mà không phải import UI.
on(EV.TOAST, ({ type, text }) => toast(text, type));

/* =============================================================== modal == */

let openModal = null;

/**
 * Mở modal. `body` là chuỗi HTML đã an toàn.
 * @returns {{close:Function, el:HTMLElement}}
 */
export function modal({ title, body, actions = [], size = '', onMount = null, dismissible = true }) {
  closeModal();

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = html`
    <div class="modal ${size}" role="dialog" aria-modal="true" aria-label="${title}">
      <div class="modal-head">
        <h2>${title}</h2>
        <button class="btn btn-ghost btn-icon spacer" data-close aria-label="Đóng">✕</button>
      </div>
      <div class="modal-body">${raw(body)}</div>
      ${raw(actions.length ? '<div class="modal-foot"></div>' : '')}
    </div>`;

  const foot = backdrop.querySelector('.modal-foot');
  if (foot) {
    for (const a of actions) {
      const btn = document.createElement('button');
      btn.className = `btn ${a.variant ? `btn-${a.variant}` : ''}`;
      btn.textContent = a.label;
      if (a.disabled) btn.disabled = true;
      btn.addEventListener('click', () => a.onClick?.({ close, el: backdrop, btn }));
      foot.appendChild(btn);
    }
  }

  const onKey = e => {
    if (e.key === 'Escape' && dismissible) close();
    if (e.key === 'Tab') trapFocus(e, backdrop);
  };

  function close() {
    document.removeEventListener('keydown', onKey);
    backdrop.remove();
    if (openModal?.el === backdrop) openModal = null;
    lastFocus?.focus?.();
  }

  backdrop.querySelector('[data-close]').addEventListener('click', close);
  if (dismissible) {
    backdrop.addEventListener('mousedown', e => { if (e.target === backdrop) close(); });
  }
  document.addEventListener('keydown', onKey);

  const lastFocus = document.activeElement;
  document.getElementById('modal-root').appendChild(backdrop);
  onMount?.({ el: backdrop, close });

  // Đưa tiêu điểm vào modal cho người dùng bàn phím (NFR-A-03).
  const focusable = backdrop.querySelector('input, textarea, select, button:not([data-close])');
  (focusable ?? backdrop.querySelector('[data-close]'))?.focus();

  openModal = { el: backdrop, close };
  return openModal;
}

export function closeModal() {
  openModal?.close();
  openModal = null;
}

function trapFocus(e, container) {
  const items = [...container.querySelectorAll('a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])')]
    .filter(el => el.offsetParent !== null);
  if (!items.length) return;
  const first = items[0], last = items[items.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

/** UI-05: xác nhận cho thao tác không hoàn tác được. */
export function confirmDialog({ title, message, confirmLabel = 'Xác nhận', variant = 'primary', danger = false }) {
  return new Promise(resolve => {
    modal({
      title,
      body: html`<div>${message}</div>`,
      actions: [
        { label: 'Huỷ', onClick: ({ close }) => { close(); resolve(false); } },
        { label: confirmLabel, variant: danger ? 'danger' : variant, onClick: ({ close }) => { close(); resolve(true); } },
      ],
      onMount: ({ el }) => {
        el.addEventListener('keydown', e => { if (e.key === 'Escape') resolve(false); });
      },
    });
  });
}

/** Modal chứa form; `fields` là mảng mô tả. Trả về object giá trị hoặc null. */
export function formDialog({ title, fields, submitLabel = 'Lưu', size = '', validate = null, intro = '' }) {
  return new Promise(resolve => {
    const body = `
      ${intro ? `<div class="note note-info" style="margin-bottom:1rem">${intro}</div>` : ''}
      <form id="dlg-form" novalidate>${fields.map(fieldHtml).join('')}</form>
      <div class="field-error" id="dlg-error" hidden></div>`;

    let settled = false;
    const m = modal({
      title, body, size,
      actions: [
        { label: 'Huỷ', onClick: ({ close }) => { settled = true; close(); resolve(null); } },
        {
          label: submitLabel, variant: 'primary',
          onClick: ({ el, close }) => {
            const form = el.querySelector('#dlg-form');
            const values = readForm(form, fields);
            const errBox = el.querySelector('#dlg-error');
            const err = validate?.(values);
            if (err) {
              errBox.textContent = err;
              errBox.hidden = false;
              return;
            }
            settled = true;
            close();
            resolve(values);
          },
        },
      ],
      onMount: ({ el }) => {
        el.querySelector('#dlg-form')?.addEventListener('submit', e => e.preventDefault());
      },
    });

    // Đóng bằng Esc / nút X cũng phải giải phóng promise.
    const origClose = m.close;
    m.close = () => { origClose(); if (!settled) { settled = true; resolve(null); } };
  });
}

function fieldHtml(f) {
  const id = `f_${f.name}`;
  const req = f.required ? ' <span style="color:var(--danger)">*</span>' : '';
  let control;
  if (f.type === 'textarea') {
    control = html`<textarea id="${id}" name="${f.name}" rows="${f.rows ?? 5}" placeholder="${f.placeholder ?? ''}" class="${f.mono ? 'mono' : ''}">${f.value ?? ''}</textarea>`;
  } else if (f.type === 'select') {
    const opts = (f.options || []).map(o => {
      const val = typeof o === 'object' ? o.value : o;
      const label = typeof o === 'object' ? o.label : o;
      const sel = String(val) === String(f.value) ? ' selected' : '';
      return `<option value="${escapeHtml(val)}"${sel}>${escapeHtml(label)}</option>`;
    }).join('');
    control = `<select id="${id}" name="${escapeHtml(f.name)}">${opts}</select>`;
  } else if (f.type === 'checkbox') {
    return html`<div class="field"><label style="display:flex;gap:.5rem;align-items:center;font-weight:500">
      <input type="checkbox" id="${id}" name="${f.name}" ${raw(f.value ? 'checked' : '')} style="width:auto">
      ${f.label}</label>
      ${raw(f.hint ? `<div class="hint">${escapeHtml(f.hint)}</div>` : '')}</div>`;
  } else {
    control = html`<input type="${f.type ?? 'text'}" id="${id}" name="${f.name}" value="${f.value ?? ''}" placeholder="${f.placeholder ?? ''}" class="${f.mono ? 'mono' : ''}">`;
  }
  return `<div class="field">
      <label for="${id}">${escapeHtml(f.label)}${req}</label>
      ${control}
      ${f.hint ? `<div class="hint">${escapeHtml(f.hint)}</div>` : ''}
    </div>`;
}

function readForm(form, fields) {
  const out = {};
  for (const f of fields) {
    const el = form.elements[f.name];
    if (!el) continue;
    out[f.name] = f.type === 'checkbox' ? el.checked
      : f.type === 'number' ? (el.value === '' ? null : Number(el.value))
      : el.value;
  }
  return out;
}

/* ============================================================== badges == */

export function statusBadge(status) {
  const m = STATUS_META[status] ?? STATUS_META.NOT_STARTED;
  // Luôn kèm nhãn chữ + biểu tượng, không chỉ dựa vào màu (NFR-A-02).
  return `<span class="st st-${escapeHtml(status)}" title="${escapeHtml(m.label)}">${escapeHtml(m.label)}</span>`;
}

export function statusChip(status) {
  const m = STATUS_META[status] ?? STATUS_META.NOT_STARTED;
  return `<span class="badge ${m.badge}"><span aria-hidden="true">${m.icon}</span>${escapeHtml(m.label)}</span>`;
}

export function ideaBadge(status) {
  const m = IDEA_META[status];
  if (!m) return '';
  return `<span class="badge ${m.badge}">${escapeHtml(m.label)}</span>`;
}

export function setStatusBadge(status) {
  const m = SET_STATUS_META[status];
  if (!m) return '';
  return `<span class="badge ${m.badge}">${escapeHtml(m.label)}</span>`;
}

export function roleBadge(role) {
  return `<span class="badge ${role === 'ADMIN' ? 'badge-accent' : 'badge-neutral'}">${escapeHtml(ROLE_LABEL[role] ?? role)}</span>`;
}

export function levelBadge(level) {
  return `<span class="badge badge-neutral">Lv.${escapeHtml(level)}</span>`;
}

export function hintLevelLabel(level) {
  return HINT_LEVEL_META[level]?.label ?? `Cấp ${level}`;
}

/* ============================================================== blocks == */

export function progressBar(done, total, { ok = false } = {}) {
  const p = pct(done, total);
  return `<div class="bar ${ok ? 'ok' : ''}" role="progressbar" aria-valuenow="${p}" aria-valuemin="0" aria-valuemax="100">
    <span style="width:${p}%"></span></div>`;
}

export function emptyState({ title, message, actionHtml = '' }) {
  return html`<div class="empty">
    <h3>${title}</h3>
    <p class="muted">${message}</p>
    ${raw(actionHtml)}
  </div>`;
}

export function statTile(value, label, sub = '') {
  return html`<div class="stat">
    <div class="stat-val">${value}</div>
    <div class="stat-lbl">${label}</div>
    ${raw(sub ? `<div class="tiny faint" style="margin-top:.2rem">${escapeHtml(sub)}</div>` : '')}
  </div>`;
}

export function loadingBlock(text = 'Đang tải…') {
  return html`<div class="boot-splash"><div class="spinner" aria-hidden="true"></div><p>${text}</p></div>`;
}

export function timeChip(mins) {
  return mins ? `<span class="tag">⏱ ${escapeHtml(formatMinutes(mins))}</span>` : '';
}

/** Thanh cảnh báo dùng lại ở nhiều trang. */
export function noteBox(type, contentHtml) {
  return `<div class="note note-${escapeHtml(type)}">${contentHtml}</div>`;
}

/* ============================================================ tiện ích == */

/** Gắn handler cho mọi phần tử khớp selector trong một gốc. */
export function bind(root, selector, event, handler) {
  for (const el of root.querySelectorAll(selector)) el.addEventListener(event, handler);
}

/** Uỷ quyền sự kiện: bắt ở gốc, lọc theo selector. */
export function delegate(root, selector, event, handler) {
  root.addEventListener(event, e => {
    const target = e.target.closest(selector);
    if (target && root.contains(target)) handler(e, target);
  });
}

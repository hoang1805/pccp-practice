/**
 * Hiển thị và chỉnh sửa bộ đề 4 slot — dùng chung cho trang chủ,
 * trang bộ đề theo ngày, và màn hình quản trị.
 */

import { escapeHtml, html, raw } from '../core/util.js';
import { statusBadge, setStatusBadge, progressBar, modal, toast } from './components.js';
import { statusOf, scoreOfSet, slotSpecs, validateSet } from '../domain/rules.js';
import { matchesQuery } from '../core/util.js';

/** Một dòng slot trong bộ đề. */
export function slotRow(slot, problem, status, { href = null } = {}) {
  const inner = `
    <div class="slot-key">${escapeHtml(slot.slot)}<small>${escapeHtml(slot.points)}đ</small></div>
    <div class="slot-title">${problem
      ? escapeHtml(problem.title)
      : '<span class="slot-empty">— chưa ghim bài —</span>'}</div>
    <div>${problem ? statusBadge(status) : ''}</div>`;

  return problem && href
    ? `<a class="slot-row" href="${escapeHtml(href)}">${inner}</a>`
    : `<div class="slot-row">${inner}</div>`;
}

/**
 * Khối hiển thị một bộ đề đầy đủ: tiêu đề, thanh tiến độ, 4 slot.
 * @param {object} set
 * @param {object} progressDoc
 * @param {Map<string,object>} problemMap
 */
export function setCard(set, progressDoc, problemMap, { title = null, headerExtra = '', config = null } = {}) {
  if (!set) return '';
  const score = scoreOfSet(set, progressDoc, config);
  const rows = (set.slots || []).map(s => {
    const p = s.problemId ? problemMap.get(s.problemId) : null;
    return slotRow(s, p, s.problemId ? statusOf(progressDoc, s.problemId) : null,
      { href: s.problemId ? `#/problems/${encodeURIComponent(s.problemId)}` : null });
  }).join('');

  return `
    <div class="card">
      <div class="card-head">
        <h2>${escapeHtml(title ?? set.title ?? 'Bộ đề')}</h2>
        ${setStatusBadge(set.status)}
        <span class="spacer"></span>
        ${headerExtra}
      </div>
      <div class="card-pad" style="padding-bottom:.6rem">
        <div class="row" style="justify-content:space-between;margin-bottom:.4rem">
          <span class="small muted">${score.done}/${score.total} bài hoàn thành</span>
          <span class="strong">${score.earned} / ${score.max} điểm</span>
        </div>
        ${progressBar(score.earned, score.max, { ok: score.earned === score.max })}
      </div>
      <div class="slot-list">${rows}</div>
      ${set.noteMd ? `<div class="card-pad" style="border-top:1px solid var(--border)">
        <div class="small muted">${escapeHtml(set.noteMd)}</div></div>` : ''}
    </div>`;
}

/* ====================================================== trình chỉnh sửa == */

/**
 * Mở hộp thoại chọn bài cho 4 slot.
 * @param {object} opts
 * @param {Array} opts.slots     slot hiện tại
 * @param {Array} opts.problems  danh sách metadata bài tập
 * @param {Function} opts.onSave nhận {title, slots, noteMd}
 */
export function openSetEditor({
  title = '', slots = null, noteMd = '', problems = [], config = null,
  heading = 'Chỉnh sửa bộ đề', withNote = true, onSave,
}) {
  const specs = slotSpecs(config);
  const working = (slots ?? specs.map(s => ({ slot: s.slot, problemId: null, points: s.points })))
    .map(s => ({ ...s }));

  const body = `
    <div class="field">
      <label for="set-title">Tiêu đề bộ đề</label>
      <input type="text" id="set-title" value="${escapeHtml(title)}" placeholder="vd: Chủ đề đồ thị">
    </div>
    <div id="slot-editor" class="stack"></div>
    ${withNote ? `<div class="field" style="margin-top:1rem">
      <label for="set-note">Ghi chú cho học viên</label>
      <textarea id="set-note" rows="3" placeholder="vd: Cố gắng hoàn thành trong 120 phút.">${escapeHtml(noteMd)}</textarea>
    </div>` : ''}
    <div class="field-error" id="set-err" hidden></div>`;

  modal({
    title: heading,
    body,
    size: 'modal-lg',
    actions: [
      { label: 'Huỷ', onClick: ({ close }) => close() },
      {
        label: 'Lưu bộ đề', variant: 'primary',
        onClick: async ({ el, close }) => {
          const errBox = el.querySelector('#set-err');
          const problemMap = new Map(problems.map(p => [p.id, p]));
          const check = validateSet(working, problemMap, config);
          if (!check.ok) {
            errBox.innerHTML = check.errors.map(e => escapeHtml(e)).join('<br>');
            errBox.hidden = false;
            return;
          }
          try {
            await onSave({
              title: el.querySelector('#set-title').value.trim(),
              noteMd: withNote ? el.querySelector('#set-note').value : '',
              slots: working,
            });
            close();
          } catch (err) {
            errBox.textContent = err.message;
            errBox.hidden = false;
          }
        },
      },
    ],
    onMount: ({ el }) => {
      const host = el.querySelector('#slot-editor');
      const draw = () => {
        host.innerHTML = specs.map(spec => {
          const cur = working.find(w => w.slot === spec.slot) ?? { problemId: null };
          const candidates = problems.filter(p => Number(p.level) === Number(spec.level) && !p.archived);
          const picked = candidates.find(p => p.id === cur.problemId);
          return `
            <div class="field" style="margin-bottom:.75rem">
              <label for="slot-${spec.slot}">
                Slot ${escapeHtml(spec.slot)} — Level ${spec.level} — ${spec.points} điểm
              </label>
              <select id="slot-${spec.slot}" data-slot="${escapeHtml(spec.slot)}">
                <option value="">— để trống —</option>
                ${candidates.map(p =>
                  `<option value="${escapeHtml(p.id)}"${p.id === cur.problemId ? ' selected' : ''}>${escapeHtml(p.id)} · ${escapeHtml(p.title)}</option>`
                ).join('')}
              </select>
              ${!candidates.length
                ? `<div class="hint" style="color:var(--warn)">Chưa có bài Level ${spec.level} nào trong ngân hàng đề.</div>`
                : picked ? `<div class="hint">${escapeHtml((picked.tags || []).join(', '))}</div>` : ''}
            </div>`;
        }).join('');

        for (const sel of host.querySelectorAll('select[data-slot]')) {
          sel.addEventListener('change', () => {
            const key = sel.dataset.slot;
            const row = working.find(w => w.slot === key);
            if (row) row.problemId = sel.value || null;
            el.querySelector('#set-err').hidden = true;
          });
        }
      };
      draw();
    },
  });
}

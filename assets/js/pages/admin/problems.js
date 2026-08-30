/**
 * Quản lý ngân hàng đề: tạo, sửa, lưu trữ, nhập/xuất hàng loạt (FR-PROB-01/02/06).
 */

import { setMain, pageShell, globalBanners } from '../../ui/layout.js';
import {
  loadingBlock, emptyState, levelBadge, toast, confirmDialog, modal,
} from '../../ui/components.js';
import { adminNav } from './_nav.js';
import {
  escapeHtml, matchesQuery, debounce, downloadFile, pickFile, todayKey, formatDateTime,
} from '../../core/util.js';
import {
  listProblems, getProblem, saveProblem, archiveProblem, importProblems,
} from '../../domain/service.js';
import { LEVELS, LANGUAGES } from '../../domain/constants.js';
import { reload } from '../../core/router.js';

export async function render({ query }) {
  setMain(pageShell(loadingBlock()));

  const problems = await listProblems({ includeArchived: true });
  const state = { q: '', level: '', archived: 'active' };

  setMain(pageShell(`
    ${globalBanners()}
    ${adminNav('/admin/problems')}

    <div class="row" style="margin-bottom:1rem">
      <h1 style="margin:0">Ngân hàng đề</h1>
      <span class="badge badge-neutral">${problems.length}</span>
      <span class="spacer"></span>
      <button class="btn" id="import">Nhập JSON</button>
      <button class="btn" id="export">Xuất JSON</button>
      <button class="btn btn-primary" id="new">+ Bài tập mới</button>
    </div>

    <div class="note note-warn" style="margin-bottom:1rem">
      <strong>Bản quyền:</strong> chỉ nhập đề do bạn tự viết hoặc tự tóm tắt.
      Không sao chép nguyên văn đề của Programmers — hãy lưu link nguồn thay vì dán toàn văn.
    </div>

    <div class="card card-pad" style="margin-bottom:1rem">
      <div class="row">
        <input type="search" id="q" placeholder="Tìm theo mã hoặc tiêu đề…" style="flex:1 1 14rem">
        <select id="level" style="width:auto">
          <option value="">Mọi level</option>
          ${LEVELS.map(l => `<option value="${l}">Level ${l}</option>`).join('')}
        </select>
        <select id="archived" style="width:auto">
          <option value="active">Đang dùng</option>
          <option value="archived">Đã lưu trữ</option>
          <option value="">Tất cả</option>
        </select>
      </div>
    </div>

    <div id="list"></div>
  `));

  const listEl = document.getElementById('list');

  function draw() {
    const rows = problems.filter(p => {
      if (state.level && String(p.level) !== state.level) return false;
      if (state.archived === 'active' && p.archived) return false;
      if (state.archived === 'archived' && !p.archived) return false;
      if (state.q && !matchesQuery(`${p.id} ${p.title} ${(p.tags || []).join(' ')}`, state.q)) return false;
      return true;
    }).sort((a, b) => a.id.localeCompare(b.id));

    listEl.innerHTML = rows.length ? `<div class="card table-wrap"><table class="tbl">
      <thead><tr>
        <th style="width:5.5rem">Mã</th><th>Tiêu đề</th><th style="width:4.5rem">Level</th>
        <th>Chủ đề</th><th>Cập nhật</th><th style="width:1%"></th>
      </tr></thead>
      <tbody>${rows.map(p => `
        <tr>
          <td class="mono tiny">${escapeHtml(p.id)}</td>
          <td>
            <a href="#/problems/${encodeURIComponent(p.id)}">${escapeHtml(p.title)}</a>
            ${p.archived ? ' <span class="badge badge-neutral">lưu trữ</span>' : ''}
          </td>
          <td>${levelBadge(p.level)}</td>
          <td><div class="chip-row">${(p.tags || []).map(t => `<span class="tag">${escapeHtml(t)}</span>`).join('')}</div></td>
          <td class="tiny faint">${escapeHtml(formatDateTime(p.updatedAt))}</td>
          <td class="nowrap">
            <button class="btn btn-sm" data-edit="${escapeHtml(p.id)}">Sửa</button>
            <button class="btn btn-sm btn-ghost" data-archive="${escapeHtml(p.id)}" data-on="${p.archived ? '1' : '0'}">
              ${p.archived ? 'Khôi phục' : 'Lưu trữ'}
            </button>
          </td>
        </tr>`).join('')}</tbody>
    </table></div>` : emptyState({
      title: problems.length ? 'Không có bài nào khớp' : 'Ngân hàng đề đang trống',
      message: problems.length ? 'Thử đổi bộ lọc.' : 'Thêm bài tập đầu tiên để bắt đầu tạo bộ đề.',
      actionHtml: problems.length ? '' : `<button class="btn btn-primary" id="new-empty">+ Bài tập mới</button>`,
    });

    for (const b of listEl.querySelectorAll('[data-edit]')) {
      b.addEventListener('click', () => openEditor(b.dataset.edit));
    }
    for (const b of listEl.querySelectorAll('[data-archive]')) {
      b.addEventListener('click', async () => {
        const turningOn = b.dataset.on !== '1';
        if (turningOn) {
          const ok = await confirmDialog({
            title: 'Lưu trữ bài tập?',
            message: `<p>Bài sẽ không xuất hiện khi ghim bộ đề mới.</p>
              <p class="muted small">Các bộ đề đã phát hành vẫn giữ nguyên bài này — dữ liệu không bị mất.</p>`,
            confirmLabel: 'Lưu trữ',
          });
          if (!ok) return;
        }
        try {
          await archiveProblem(b.dataset.archive, turningOn);
          toast(turningOn ? 'Đã lưu trữ.' : 'Đã khôi phục.', 'ok');
          reload();
        } catch (err) { toast(err.message, 'err'); }
      });
    }
    listEl.querySelector('#new-empty')?.addEventListener('click', () => openEditor(null));
  }

  document.getElementById('q').addEventListener('input', debounce(e => { state.q = e.target.value; draw(); }, 200));
  for (const id of ['level', 'archived']) {
    document.getElementById(id).addEventListener('change', e => { state[id] = e.target.value; draw(); });
  }

  document.getElementById('new').addEventListener('click', () => openEditor(null));
  document.getElementById('export').addEventListener('click', () => exportAll(problems));
  document.getElementById('import').addEventListener('click', importJson);

  draw();

  // Mở thẳng trình soạn khi tới từ trang chi tiết bài (?edit=P-0001).
  if (query.edit) openEditor(query.edit);
}

/* ------------------------------------------------------------- trình soạn -- */

async function openEditor(id) {
  const p = id ? await getProblem(id) : null;
  if (id && !p) { toast('Không tìm thấy bài tập.', 'err'); return; }

  const samples = p?.samples ?? [];

  modal({
    title: p ? `Sửa · ${p.id}` : 'Bài tập mới',
    size: 'modal-lg',
    body: `
      <div class="grid-2">
        <div class="field">
          <label for="pf-title">Tiêu đề <span style="color:var(--danger)">*</span></label>
          <input type="text" id="pf-title" value="${escapeHtml(p?.title ?? '')}">
        </div>
        <div class="field">
          <label for="pf-level">Level <span style="color:var(--danger)">*</span></label>
          <select id="pf-level">
            ${LEVELS.map(l => `<option value="${l}"${Number(p?.level) === l ? ' selected' : ''}>Level ${l}</option>`).join('')}
          </select>
        </div>
      </div>

      <div class="field">
        <label for="pf-statement">Đề bài (Markdown) <span style="color:var(--danger)">*</span></label>
        <textarea id="pf-statement" rows="10" class="mono">${escapeHtml(p?.statementMd ?? '')}</textarea>
      </div>

      <div class="field">
        <label for="pf-constraints">Ràng buộc (Markdown)</label>
        <textarea id="pf-constraints" rows="4" class="mono">${escapeHtml(p?.constraintsMd ?? '')}</textarea>
      </div>

      <fieldset>
        <legend>Ví dụ</legend>
        <div id="pf-samples"></div>
        <button type="button" class="btn btn-sm" id="pf-add-sample">+ Thêm ví dụ</button>
      </fieldset>

      <div class="grid-2">
        <div class="field">
          <label for="pf-tags">Chủ đề (phân tách bằng dấu phẩy)</label>
          <input type="text" id="pf-tags" value="${escapeHtml((p?.tags ?? []).join(', '))}" placeholder="graph, bfs, dp">
        </div>
        <div class="field">
          <label for="pf-minutes">Thời gian ước lượng (phút)</label>
          <input type="number" id="pf-minutes" value="${escapeHtml(p?.estimatedMinutes ?? '')}">
        </div>
      </div>

      <div class="field">
        <label for="pf-source">Link nguồn</label>
        <input type="url" id="pf-source" value="${escapeHtml(p?.sourceUrl ?? '')}" placeholder="https://school.programmers.co.kr/...">
      </div>
      <div class="field">
        <label for="pf-sourcenote">Ghi chú nguồn</label>
        <input type="text" id="pf-sourcenote" value="${escapeHtml(p?.sourceNote ?? '')}" placeholder="vd: tự tóm tắt, không sao chép nguyên văn">
      </div>
      <div class="field">
        <label for="pf-difficulty">Lưu ý độ khó</label>
        <input type="text" id="pf-difficulty" value="${escapeHtml(p?.difficultyNote ?? '')}">
      </div>
      <div class="field">
        <label for="pf-langs">Ngôn ngữ khuyến nghị</label>
        <select id="pf-langs" multiple size="3">
          ${LANGUAGES.map(l => `<option value="${escapeHtml(l)}"${(p?.recommendedLanguages ?? []).includes(l) ? ' selected' : ''}>${escapeHtml(l)}</option>`).join('')}
        </select>
      </div>

      <div class="field-error" id="pf-err" hidden></div>`,
    actions: [
      { label: 'Huỷ', onClick: ({ close }) => close() },
      {
        label: p ? 'Lưu thay đổi' : 'Tạo bài tập', variant: 'primary',
        onClick: async ({ el, close }) => {
          const q = s => el.querySelector(s);
          const err = q('#pf-err');
          const title = q('#pf-title').value.trim();
          const statementMd = q('#pf-statement').value.trim();

          if (!title) { err.textContent = 'Tiêu đề không được để trống.'; err.hidden = false; return; }
          if (!statementMd) { err.textContent = 'Đề bài không được để trống.'; err.hidden = false; return; }

          const collected = [...el.querySelectorAll('[data-sample]')].map(row => ({
            input: row.querySelector('[data-k=input]').value,
            output: row.querySelector('[data-k=output]').value,
            explanation: row.querySelector('[data-k=explanation]').value,
          })).filter(s => s.input.trim() || s.output.trim());

          try {
            await saveProblem({
              id: p?.id,
              createdAt: p?.createdAt,
              createdBy: p?.createdBy,
              archived: p?.archived ?? false,
              title,
              level: Number(q('#pf-level').value),
              statementMd,
              constraintsMd: q('#pf-constraints').value,
              samples: collected,
              tags: q('#pf-tags').value.split(',').map(t => t.trim()).filter(Boolean),
              estimatedMinutes: q('#pf-minutes').value ? Number(q('#pf-minutes').value) : null,
              sourceUrl: q('#pf-source').value.trim(),
              sourceNote: q('#pf-sourcenote').value.trim(),
              difficultyNote: q('#pf-difficulty').value.trim(),
              recommendedLanguages: [...q('#pf-langs').selectedOptions].map(o => o.value),
            });
            toast(p ? 'Đã lưu bài tập.' : 'Đã tạo bài tập.', 'ok');
            close();
            reload();
          } catch (e) { err.textContent = e.message; err.hidden = false; }
        },
      },
    ],
    onMount: ({ el }) => {
      const host = el.querySelector('#pf-samples');
      const addRow = (s = { input: '', output: '', explanation: '' }) => {
        const div = document.createElement('div');
        div.dataset.sample = '1';
        div.style.cssText = 'border:1px solid var(--border);border-radius:var(--radius-sm);padding:.6rem;margin-bottom:.6rem';
        div.innerHTML = `
          <div class="grid-2">
            <div class="field" style="margin-bottom:.5rem">
              <label>Input</label><textarea data-k="input" rows="3" class="mono">${escapeHtml(s.input)}</textarea>
            </div>
            <div class="field" style="margin-bottom:.5rem">
              <label>Output</label><textarea data-k="output" rows="3" class="mono">${escapeHtml(s.output)}</textarea>
            </div>
          </div>
          <div class="field" style="margin-bottom:.5rem">
            <label>Giải thích</label><input type="text" data-k="explanation" value="${escapeHtml(s.explanation ?? '')}">
          </div>
          <button type="button" class="btn btn-sm btn-ghost" data-del>Xoá ví dụ</button>`;
        div.querySelector('[data-del]').addEventListener('click', () => div.remove());
        host.appendChild(div);
      };
      for (const s of samples) addRow(s);
      el.querySelector('#pf-add-sample').addEventListener('click', () => addRow());
    },
  });
}

/* ---------------------------------------------------------- nhập / xuất -- */

async function exportAll(index) {
  toast('Đang thu thập dữ liệu…', 'info');
  const full = [];
  for (const meta of index) {
    const p = await getProblem(meta.id);
    if (p) full.push(p);
  }
  downloadFile(`pccp-problems-${todayKey()}.json`, JSON.stringify(full, null, 2));
  toast(`Đã xuất ${full.length} bài tập.`, 'ok');
}

async function importJson() {
  const file = await pickFile('.json');
  if (!file) return;

  let list;
  try {
    const parsed = JSON.parse(file.text);
    list = Array.isArray(parsed) ? parsed : parsed.problems;
    if (!Array.isArray(list)) throw new Error('File phải chứa một mảng bài tập.');
  } catch (err) {
    toast(`File không hợp lệ: ${err.message}`, 'err', 6000);
    return;
  }

  const ok = await confirmDialog({
    title: 'Nhập bài tập',
    message: `<p>Sắp nhập <strong>${list.length}</strong> bài từ <code>${escapeHtml(file.name)}</code>.</p>
      <p class="muted small">Bài có sẵn <code>id</code> trùng với bài hiện có sẽ bị <strong>ghi đè</strong>.</p>`,
    confirmLabel: 'Nhập',
  });
  if (!ok) return;

  try {
    const res = await importProblems(list);
    const msg = `Đã tạo ${res.created}, cập nhật ${res.updated}.`;
    if (res.errors.length) {
      modal({
        title: 'Kết quả nhập',
        body: `<p>${escapeHtml(msg)}</p>
          <div class="note note-danger"><strong>${res.errors.length} lỗi:</strong>
          <ul>${res.errors.map(e => `<li>${escapeHtml(e)}</li>`).join('')}</ul></div>`,
        actions: [{ label: 'Đóng', onClick: ({ close }) => { close(); reload(); } }],
      });
    } else {
      toast(msg, 'ok');
      reload();
    }
  } catch (err) { toast(err.message, 'err'); }
}

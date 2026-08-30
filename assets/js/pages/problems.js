/**
 * Danh sách bài tập với bộ lọc và tìm kiếm (FR-PROB-03).
 */

import { setMain, pageShell, globalBanners } from '../ui/layout.js';
import { emptyState, loadingBlock, statusChip, levelBadge } from '../ui/components.js';
import { escapeHtml, matchesQuery, formatMinutes, debounce } from '../core/util.js';
import { isMember, isAdmin } from '../core/auth.js';
import { listProblems, getProgress, getAllProgress, getPersonal } from '../domain/service.js';
import { statusOf } from '../domain/rules.js';
import { problemStats } from '../domain/stats.js';
import { STATUS, STATUS_META, LEVELS } from '../domain/constants.js';
import { navigate, currentRoute } from '../core/router.js';

export async function render({ query }) {
  setMain(pageShell(loadingBlock()));

  const [problems, progress, personal] = await Promise.all([
    listProblems({ includeArchived: isAdmin() }),
    getProgress(),
    isMember() ? getPersonal() : Promise.resolve({ bookmarks: [] }),
  ]);

  // Số liệu tổng hợp mỗi bài chỉ có ý nghĩa với admin (FR-PROB-07).
  let stats = new Map();
  if (isAdmin()) {
    try { stats = problemStats(await getAllProgress()); } catch { /* không chặn trang */ }
  }

  const bookmarks = new Set((personal.bookmarks || []).map(b => b.problemId));
  const allTags = [...new Set(problems.flatMap(p => p.tags || []))].sort();

  const state = {
    q: query.q ?? '',
    level: query.level ?? '',
    status: query.status ?? '',
    tag: query.tag ?? '',
    sort: query.sort ?? 'id',
  };

  setMain(pageShell(`
    ${globalBanners()}
    <div class="row" style="margin-bottom:1rem">
      <h1 style="margin:0">Ngân hàng đề</h1>
      <span class="badge badge-neutral">${problems.length} bài</span>
      <span class="spacer"></span>
      ${isAdmin() ? `<a class="btn btn-primary" href="#/admin/problems">Quản lý bài tập</a>` : ''}
    </div>

    <div class="card card-pad" style="margin-bottom:1rem">
      <div class="row">
        <input type="search" id="q" placeholder="Tìm theo tiêu đề hoặc mã bài…  (phím /)"
               value="${escapeHtml(state.q)}" style="flex:1 1 16rem">
        <select id="level" style="width:auto">
          <option value="">Mọi level</option>
          ${LEVELS.map(l => `<option value="${l}"${state.level === String(l) ? ' selected' : ''}>Level ${l}</option>`).join('')}
        </select>
        ${isMember() ? `
        <select id="status" style="width:auto">
          <option value="">Mọi trạng thái</option>
          ${Object.entries(STATUS_META).map(([k, m]) =>
            `<option value="${k}"${state.status === k ? ' selected' : ''}>${escapeHtml(m.label)}</option>`).join('')}
          <option value="__bookmarked"${state.status === '__bookmarked' ? ' selected' : ''}>Đã ghim</option>
        </select>` : ''}
        <select id="tag" style="width:auto">
          <option value="">Mọi chủ đề</option>
          ${allTags.map(t => `<option value="${escapeHtml(t)}"${state.tag === t ? ' selected' : ''}>${escapeHtml(t)}</option>`).join('')}
        </select>
        <select id="sort" style="width:auto">
          <option value="id"${state.sort === 'id' ? ' selected' : ''}>Sắp xếp: mã bài</option>
          <option value="title"${state.sort === 'title' ? ' selected' : ''}>Sắp xếp: tiêu đề</option>
          <option value="level"${state.sort === 'level' ? ' selected' : ''}>Sắp xếp: level</option>
          <option value="updated"${state.sort === 'updated' ? ' selected' : ''}>Sắp xếp: mới cập nhật</option>
        </select>
      </div>
    </div>

    <div id="list"></div>
  `));

  const listEl = document.getElementById('list');

  function apply() {
    let rows = problems.filter(p => {
      if (state.level && String(p.level) !== state.level) return false;
      if (state.tag && !(p.tags || []).includes(state.tag)) return false;
      if (state.status === '__bookmarked') { if (!bookmarks.has(p.id)) return false; }
      else if (state.status && statusOf(progress, p.id) !== state.status) return false;
      if (state.q && !matchesQuery(`${p.id} ${p.title} ${(p.tags || []).join(' ')}`, state.q)) return false;
      return true;
    });

    const cmp = {
      id: (a, b) => a.id.localeCompare(b.id),
      title: (a, b) => a.title.localeCompare(b.title, 'vi'),
      level: (a, b) => a.level - b.level || a.id.localeCompare(b.id),
      updated: (a, b) => String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')),
    }[state.sort] ?? ((a, b) => a.id.localeCompare(b.id));
    rows = rows.sort(cmp);

    listEl.innerHTML = rows.length ? tableHtml(rows) : emptyState({
      title: 'Không có bài nào khớp',
      message: problems.length
        ? 'Thử bỏ bớt bộ lọc hoặc đổi từ khoá tìm kiếm.'
        : 'Ngân hàng đề đang trống.',
      actionHtml: isAdmin() && !problems.length
        ? `<a class="btn btn-primary" href="#/admin/problems">Thêm bài tập đầu tiên</a>` : '',
    });
  }

  function tableHtml(rows) {
    return `<div class="card table-wrap"><table class="tbl">
      <thead><tr>
        <th style="width:5.5rem">Mã</th>
        <th>Tiêu đề</th>
        <th style="width:4.5rem">Level</th>
        <th>Chủ đề</th>
        ${isMember() ? '<th style="width:9rem">Trạng thái</th>' : ''}
        ${isAdmin() ? '<th style="width:8rem">Số liệu</th>' : ''}
      </tr></thead>
      <tbody>${rows.map(p => {
        const st = stats.get(p.id);
        return `<tr style="cursor:pointer" data-id="${escapeHtml(p.id)}">
          <td class="mono tiny">${escapeHtml(p.id)}</td>
          <td>
            <a href="#/problems/${encodeURIComponent(p.id)}">${escapeHtml(p.title)}</a>
            ${p.archived ? ' <span class="badge badge-neutral">đã lưu trữ</span>' : ''}
            ${bookmarks.has(p.id) ? ' <span title="Đã ghim" aria-label="Đã ghim">📌</span>' : ''}
            ${p.estimatedMinutes ? `<div class="tiny faint">~${escapeHtml(formatMinutes(p.estimatedMinutes))}</div>` : ''}
          </td>
          <td>${levelBadge(p.level)}</td>
          <td><div class="chip-row">${(p.tags || []).map(t => `<span class="tag">${escapeHtml(t)}</span>`).join('')}</div></td>
          ${isMember() ? `<td>${statusChip(statusOf(progress, p.id))}</td>` : ''}
          ${isAdmin() ? `<td class="tiny faint">${st
            ? `${st.completed} xong · ${st.stuckRate}% vướng`
            : '—'}</td>` : ''}
        </tr>`;
      }).join('')}</tbody>
    </table></div>`;
  }

  function syncUrl() {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(state)) if (v && !(k === 'sort' && v === 'id')) params.set(k, v);
    const qs = params.toString();
    history.replaceState(null, '', `#/problems${qs ? `?${qs}` : ''}`);
  }

  const onChange = () => { apply(); syncUrl(); };
  document.getElementById('q').addEventListener('input', debounce(e => {
    state.q = e.target.value; onChange();
  }, 200));
  for (const id of ['level', 'status', 'tag', 'sort']) {
    document.getElementById(id)?.addEventListener('change', e => {
      state[id] = e.target.value; onChange();
    });
  }

  // Bấm vào bất kỳ đâu trên dòng cũng mở bài (tăng vùng bấm trên di động).
  listEl.addEventListener('click', e => {
    if (e.target.closest('a')) return;
    const tr = e.target.closest('tr[data-id]');
    if (tr) navigate(`/problems/${encodeURIComponent(tr.dataset.id)}`);
  });

  apply();
}

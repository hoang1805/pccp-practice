/**
 * Nhật ký hoạt động (FR-ADMIN-02/03).
 *
 * Nguồn dữ liệu là file JSONL theo tháng. Ngoài ra lịch sử Git của repo
 * cũng là một nhật ký đầy đủ và không thể sửa — link tới đó cho các trường hợp
 * cần điều tra sâu hơn.
 */

import { setMain, pageShell, globalBanners } from '../../ui/layout.js';
import { loadingBlock, emptyState } from '../../ui/components.js';
import { adminNav } from './_nav.js';
import { escapeHtml, formatDateTime, monthKey, matchesQuery, debounce } from '../../core/util.js';
import { getAuditLog, getUserMap } from '../../domain/service.js';
import { AUDIT_ACTION_LABEL } from '../../domain/constants.js';
import { gh } from '../../core/auth.js';

export async function render({ query }) {
  setMain(pageShell(loadingBlock()));

  const ym = query.m || monthKey();
  const [entries, userMap] = await Promise.all([
    getAuditLog(ym).catch(() => []),
    getUserMap().catch(() => new Map()),
  ]);

  const actions = [...new Set(entries.map(e => e.action))].sort();
  const months = recentMonths(6);
  const state = { q: '', action: '' };

  const commitsUrl = gh
    ? `https://github.com/${gh.owner}/${gh.repo}/commits/${gh.branch}/data`
    : null;

  setMain(pageShell(`
    ${globalBanners()}
    ${adminNav('/admin/audit')}

    <div class="row" style="margin-bottom:1rem">
      <h1 style="margin:0">Nhật ký</h1>
      <span class="badge badge-neutral">${entries.length} bản ghi</span>
      <span class="spacer"></span>
      ${commitsUrl ? `<a class="btn btn-sm" href="${escapeHtml(commitsUrl)}" target="_blank" rel="noopener noreferrer">
        Xem lịch sử Git ↗</a>` : ''}
    </div>

    <div class="note note-info" style="margin-bottom:1rem">
      Mỗi thay đổi dữ liệu đều tạo một commit trong repo, nên
      <strong>lịch sử Git là nhật ký đầy đủ và không sửa được</strong>.
      Bảng dưới đây là bản tóm tắt cho dễ tra cứu.
    </div>

    <div class="card card-pad" style="margin-bottom:1rem">
      <div class="row">
        <input type="search" id="q" placeholder="Tìm theo người thực hiện hoặc đối tượng…" style="flex:1 1 14rem">
        <select id="action" style="width:auto">
          <option value="">Mọi hành động</option>
          ${actions.map(a => `<option value="${escapeHtml(a)}">${escapeHtml(AUDIT_ACTION_LABEL[a] ?? a)}</option>`).join('')}
        </select>
        <select id="month" style="width:auto">
          ${months.map(m => `<option value="${m}"${m === ym ? ' selected' : ''}>Tháng ${m.slice(5)}/${m.slice(0, 4)}</option>`).join('')}
        </select>
      </div>
    </div>

    <div id="list"></div>
  `));

  const listEl = document.getElementById('list');

  function draw() {
    const rows = entries.filter(e => {
      if (state.action && e.action !== state.action) return false;
      if (state.q) {
        const actor = userMap.get(e.actor)?.displayName ?? e.actor ?? '';
        return matchesQuery(`${actor} ${e.target ?? ''} ${e.action}`, state.q);
      }
      return true;
    });

    listEl.innerHTML = rows.length ? `<div class="card table-wrap"><table class="tbl">
      <thead><tr>
        <th style="width:12rem">Thời điểm</th><th>Người thực hiện</th>
        <th>Hành động</th><th>Đối tượng</th><th>Chi tiết</th>
      </tr></thead>
      <tbody>${rows.map(e => {
        const actor = userMap.get(e.actor);
        const detail = [];
        if (e.from) detail.push(`từ ${e.from}`);
        if (e.to) detail.push(`→ ${e.to}`);
        if (e.helpful != null) detail.push(e.helpful ? 'hữu ích' : 'không hữu ích');
        return `<tr>
          <td class="tiny faint nowrap">${escapeHtml(formatDateTime(e.at))}</td>
          <td class="tiny">${escapeHtml(actor?.displayName ?? e.actor ?? '—')}</td>
          <td><span class="badge badge-neutral">${escapeHtml(AUDIT_ACTION_LABEL[e.action] ?? e.action)}</span></td>
          <td class="mono tiny">${escapeHtml(e.target ?? '—')}</td>
          <td class="tiny faint">${escapeHtml(detail.join(' '))}</td>
        </tr>`;
      }).join('')}</tbody>
    </table></div>` : emptyState({
      title: entries.length ? 'Không có bản ghi nào khớp' : 'Chưa có nhật ký cho tháng này',
      message: entries.length
        ? 'Thử đổi bộ lọc hoặc chọn tháng khác.'
        : 'Nhật ký được tạo khi có thao tác ghi dữ liệu.',
    });
  }

  document.getElementById('q').addEventListener('input', debounce(e => { state.q = e.target.value; draw(); }, 200));
  document.getElementById('action').addEventListener('change', e => { state.action = e.target.value; draw(); });
  document.getElementById('month').addEventListener('change', e => {
    location.hash = `#/admin/audit?m=${e.target.value}`;
  });

  draw();
}

function recentMonths(n) {
  const out = [];
  const d = new Date();
  for (let i = 0; i < n; i++) {
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    d.setMonth(d.getMonth() - 1);
  }
  return out;
}

/**
 * Bảng theo dõi hard stuck và gửi gợi ý (FR-HINT-01/02/03, FR-STAT-08/09).
 */

import { setMain, pageShell, globalBanners, renderHeader } from '../../ui/layout.js';
import { loadingBlock, emptyState, toast, modal, statusChip } from '../../ui/components.js';
import { renderMarkdown } from '../../ui/markdown.js';
import { adminNav } from './_nav.js';
import { escapeHtml, durationSince, timeAgo, matchesQuery } from '../../core/util.js';
import {
  getStuckBoard, createHint, getHints, refreshNavCounters, getConfig,
  getAllProgress, getUsers, getProblemMap, activeUsers,
} from '../../domain/service.js';
import { isStuckTooLong, visibleHints } from '../../domain/rules.js';
import { STATUS, STATUS_META } from '../../domain/constants.js';
import { reload } from '../../core/router.js';

export async function render({ query }) {
  setMain(pageShell(loadingBlock()));

  const view = query.view === 'matrix' ? 'matrix' : 'stuck';
  const [rows, config] = await Promise.all([getStuckBoard(), getConfig()]);
  const threshold = config?.features?.hardStuckAlertHours ?? 48;

  // Nạp hint của từng bài để biết học viên đã được hỗ trợ chưa (FR-STAT-09).
  const hintsByProblem = new Map();
  await Promise.all([...new Set(rows.map(r => r.item.problemId))].map(async pid => {
    try { hintsByProblem.set(pid, await getHints(pid)); } catch { /* chưa có file */ }
  }));

  const enriched = rows.map(r => ({
    ...r,
    overdue: isStuckTooLong(r.item, hintsByProblem.get(r.item.problemId), r.user.id, threshold),
    hintCount: visibleHints(hintsByProblem.get(r.item.problemId) ?? { hints: [] }, r.user.id).length,
  }));
  const overdueCount = enriched.filter(r => r.overdue).length;

  setMain(pageShell(`
    ${globalBanners()}
    ${adminNav('/admin/stuck')}

    <div class="row" style="margin-bottom:1rem">
      <h1 style="margin:0">Hard stuck</h1>
      ${enriched.length ? `<span class="badge badge-warn">${enriched.length}</span>` : ''}
      ${overdueCount ? `<span class="badge badge-danger">${overdueCount} quá ${threshold}h chưa có gợi ý</span>` : ''}
      <span class="spacer"></span>
      <a class="btn btn-sm${view === 'stuck' ? ' btn-primary' : ''}" href="#/admin/stuck">Đang vướng</a>
      <a class="btn btn-sm${view === 'matrix' ? ' btn-primary' : ''}" href="#/admin/stuck?view=matrix">Ma trận tiến độ</a>
    </div>

    <div id="host">${view === 'stuck' ? loadingBlock() : loadingBlock()}</div>
  `));

  const host = document.getElementById('host');

  if (view === 'matrix') {
    host.innerHTML = await matrixHtml();
    return;
  }

  if (!enriched.length) {
    host.innerHTML = emptyState({
      title: 'Không có ai đang vướng',
      message: 'Khi học viên chuyển bài sang trạng thái Hard stuck, họ sẽ xuất hiện ở đây kèm mô tả điểm kẹt.',
    });
    return;
  }

  host.innerHTML = `
    <div class="card card-pad" style="margin-bottom:1rem">
      <input type="search" id="q" placeholder="Lọc theo học viên hoặc tên bài…">
    </div>
    <div class="stack" id="list"></div>`;

  const listEl = document.getElementById('list');

  function draw(q = '') {
    const filtered = enriched.filter(r =>
      matchesQuery(`${r.user.displayName} ${r.user.githubLogin} ${r.problem?.title ?? ''}`, q));

    listEl.innerHTML = filtered.map(r => `
      <div class="card${r.overdue ? ' ' : ''}" ${r.overdue ? 'style="border-color:var(--danger)"' : ''}>
        <div class="card-head">
          <div>
            <div class="strong">${escapeHtml(r.user.displayName ?? r.user.githubLogin)}</div>
            <div class="tiny faint">
              <a href="#/problems/${encodeURIComponent(r.item.problemId)}">${escapeHtml(r.problem?.title ?? r.item.problemId)}</a>
              ${r.problem ? ` · Level ${escapeHtml(r.problem.level)}` : ''}
            </div>
          </div>
          <span class="spacer"></span>
          <span class="badge ${r.overdue ? 'badge-danger' : 'badge-warn'}">
            vướng ${escapeHtml(durationSince(r.item.stuckSince))}
          </span>
          ${r.hintCount ? `<span class="badge badge-info">${r.hintCount} gợi ý</span>`
                        : '<span class="badge badge-neutral">chưa có gợi ý</span>'}
        </div>
        <div class="card-pad">
          <div class="tiny strong faint" style="margin-bottom:.25rem">Học viên mô tả</div>
          <div class="note note-warn">${escapeHtml(r.item.stuckReason || '(không có mô tả)')}</div>
          <div class="row" style="margin-top:.75rem">
            ${[1, 2, 3].map(lv =>
              `<button class="btn btn-sm${lv === 1 ? ' btn-primary' : ''}"
                data-hint="${escapeHtml(r.user.id)}|${escapeHtml(r.item.problemId)}|${lv}">
                Gửi gợi ý cấp ${lv}</button>`).join('')}
            <span class="spacer"></span>
            <span class="tiny faint">
              ${r.item.timeSpentMinutes ? `đã bỏ ra ${r.item.timeSpentMinutes} phút` : ''}
            </span>
          </div>
        </div>
      </div>`).join('') || emptyState({ title: 'Không có kết quả', message: 'Thử từ khoá khác.' });

    for (const b of listEl.querySelectorAll('[data-hint]')) {
      b.addEventListener('click', () => {
        const [uid, pid, lv] = b.dataset.hint.split('|');
        const row = enriched.find(r => r.user.id === uid && r.item.problemId === pid);
        openHintDialog(uid, pid, Number(lv), row);
      });
    }
  }

  document.getElementById('q').addEventListener('input', e => draw(e.target.value));
  draw();
}

/* ------------------------------------------------------- ma trận tiến độ -- */

async function matrixHtml() {
  const [usersDoc, allProgress, problemMap] = await Promise.all([
    getUsers(), getAllProgress(), getProblemMap(),
  ]);
  const members = activeUsers(usersDoc);

  // Chỉ hiện những bài đã có ít nhất một người đụng tới, để bảng không quá rộng.
  const touched = new Set();
  for (const doc of allProgress.values()) {
    for (const i of doc.items || []) if (i.status !== STATUS.NOT_STARTED) touched.add(i.problemId);
  }
  const problems = [...touched].map(id => problemMap.get(id) ?? { id, title: id, level: '?' })
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));

  if (!problems.length || !members.length) {
    return emptyState({ title: 'Chưa có dữ liệu', message: 'Cần ít nhất một học viên đã bắt đầu làm bài.' });
  }

  const cell = (uid, pid) => {
    const st = (allProgress.get(uid)?.items || []).find(i => i.problemId === pid)?.status ?? STATUS.NOT_STARTED;
    const m = STATUS_META[st];
    return `<td title="${escapeHtml(m.label)}" style="text-align:center">
      <span class="st st-${st}" style="gap:0"><span class="visually-hidden"></span></span>
      <span class="tiny faint">${m.icon}</span></td>`;
  };

  return `<div class="card table-wrap"><table class="tbl">
    <thead><tr>
      <th style="position:sticky;left:0;background:var(--bg-elev)">Học viên</th>
      ${problems.map(p => `<th style="writing-mode:vertical-rl;text-orientation:mixed;height:8rem">
        ${escapeHtml(p.id)}</th>`).join('')}
    </tr></thead>
    <tbody>${members.map(u => `<tr>
      <td style="position:sticky;left:0;background:var(--bg-elev)" class="nowrap">
        ${escapeHtml(u.displayName ?? u.githubLogin)}</td>
      ${problems.map(p => cell(u.id, p.id)).join('')}
    </tr>`).join('')}</tbody>
  </table></div>
  <div class="card card-pad" style="margin-top:1rem">
    <div class="row small muted">
      ${Object.entries(STATUS_META).map(([k, m]) =>
        `<span class="st st-${k}">${m.icon} ${escapeHtml(m.label)}</span>`).join('')}
    </div>
  </div>`;
}

/* ------------------------------------------------------------- gửi gợi ý -- */

function openHintDialog(targetUserId, problemId, level, row) {
  const placeholder = {
    1: 'Định hướng chung, không nói tên thuật toán.\nvd: Hãy nghĩ xem chi phí di chuyển có luôn bằng nhau không.',
    2: 'Nêu tên thuật toán hoặc kỹ thuật cần dùng.\nvd: TLE đến từ việc duyệt lại ô đã thăm. Thử deque và 0-1 BFS.',
    3: 'Mô tả chi tiết các bước, gần như lời giải.',
  }[level];

  modal({
    title: `Gửi gợi ý cấp ${level}`,
    size: 'modal-lg',
    body: `
      <div class="note note-info" style="margin-bottom:1rem">
        Gợi ý này chỉ hiển thị cho <strong>${escapeHtml(row?.user.displayName ?? 'học viên này')}</strong>.
        Học viên phải mở gợi ý cấp thấp hơn trước khi thấy được cấp này.
      </div>
      ${row?.item.stuckReason ? `
        <div class="field">
          <label>Điểm vướng học viên mô tả</label>
          <div class="note note-warn">${escapeHtml(row.item.stuckReason)}</div>
        </div>` : ''}
      <div class="field">
        <label for="h-content">Nội dung gợi ý (Markdown) <span style="color:var(--danger)">*</span></label>
        <textarea id="h-content" rows="7" placeholder="${escapeHtml(placeholder)}"></textarea>
      </div>
      <div class="field-error" id="h-err" hidden></div>`,
    actions: [
      { label: 'Huỷ', onClick: ({ close }) => close() },
      {
        label: 'Gửi gợi ý', variant: 'primary',
        onClick: async ({ el, close }) => {
          const content = el.querySelector('#h-content').value;
          const err = el.querySelector('#h-err');
          if (!content.trim()) { err.textContent = 'Nội dung không được để trống.'; err.hidden = false; return; }
          try {
            await createHint(problemId, {
              level, contentMd: content, targetUserId,
              inResponseToStuck: row?.item.stuckReason ?? '',
            });
            await refreshNavCounters(); renderHeader();
            toast('Đã gửi gợi ý.', 'ok');
            close();
            reload();
          } catch (e) { err.textContent = e.message; err.hidden = false; }
        },
      },
    ],
  });
}

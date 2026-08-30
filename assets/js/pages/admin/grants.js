/**
 * Cấp và thu hồi quyền xem lời giải; xử lý hàng chờ yêu cầu (FR-SOL-04/05/06).
 */

import { setMain, pageShell, globalBanners, renderHeader } from '../../ui/layout.js';
import { loadingBlock, emptyState, toast, confirmDialog, formDialog } from '../../ui/components.js';
import { adminNav } from './_nav.js';
import { escapeHtml, timeAgo, formatDateTime, matchesQuery } from '../../core/util.js';
import {
  getSolutionRequests, grantSolution, revokeGrant, getProblemMap,
  getUsers, getGrants, getAllProgress, refreshNavCounters, activeUsers,
} from '../../domain/service.js';
import { STATUS } from '../../domain/constants.js';
import { reload } from '../../core/router.js';

export async function render() {
  setMain(pageShell(loadingBlock()));

  const [requests, problemMap, usersDoc, allProgress] = await Promise.all([
    getSolutionRequests(), getProblemMap(), getUsers(), getAllProgress(),
  ]);
  const members = activeUsers(usersDoc);

  // Toàn bộ grant đang có hiệu lực, để admin nhìn thấy bức tranh chung.
  const grantRows = [];
  await Promise.all(members.map(async u => {
    try {
      const doc = await getGrants(u.id);
      for (const g of doc.grants || []) grantRows.push({ ...g, user: u });
    } catch { /* chưa có file */ }
  }));

  setMain(pageShell(`
    ${globalBanners()}
    ${adminNav('/admin/grants')}

    <h1>Quyền xem lời giải</h1>
    <p class="muted small">
      Học viên chỉ xem được lời giải khi <strong>đã hoàn thành bài</strong> và
      <strong>được cấp quyền</strong>. Thiếu một trong hai thì vẫn khoá.
    </p>

    ${requestsCard(requests, problemMap)}

    <div class="card" style="margin-top:1.5rem">
      <div class="card-head"><h2>Quyền đã cấp</h2>
        <span class="badge badge-neutral">${grantRows.filter(g => !g.revokedAt).length}</span>
        <span class="spacer"></span>
        <button class="btn btn-sm btn-primary" id="grant-manual">Cấp quyền thủ công</button>
      </div>
      ${grantRows.length ? `<div class="table-wrap"><table class="tbl">
        <thead><tr><th>Học viên</th><th>Bài</th><th>Cấp lúc</th><th>Lý do</th><th style="width:1%"></th></tr></thead>
        <tbody>${grantRows.map(g => `
          <tr${g.revokedAt ? ' style="opacity:.55"' : ''}>
            <td>${escapeHtml(g.user.displayName ?? g.user.githubLogin)}</td>
            <td><a href="#/problems/${encodeURIComponent(g.problemId)}">${escapeHtml(problemMap.get(g.problemId)?.title ?? g.problemId)}</a></td>
            <td class="tiny faint">${escapeHtml(formatDateTime(g.grantedAt))}</td>
            <td class="tiny">${escapeHtml(g.reason || '—')}
              ${g.revokedAt ? '<span class="badge badge-danger">đã thu hồi</span>' : ''}</td>
            <td class="nowrap">
              ${g.revokedAt
                ? `<button class="btn btn-sm" data-grant="${escapeHtml(g.user.id)}|${escapeHtml(g.problemId)}">Cấp lại</button>`
                : `<button class="btn btn-sm btn-ghost" data-revoke="${escapeHtml(g.user.id)}|${escapeHtml(g.problemId)}">Thu hồi</button>`}
            </td>
          </tr>`).join('')}</tbody>
      </table></div>` : `<div class="card-pad"><p class="muted small" style="margin:0">
        Chưa cấp quyền cho ai.</p></div>`}
    </div>
  `));

  wire(members, problemMap, allProgress);
}

function requestsCard(requests, problemMap) {
  if (!requests.length) {
    return `<div class="card card-pad" style="margin-top:1.25rem">
      <h2 style="margin-top:0">Yêu cầu chờ duyệt</h2>
      <p class="muted small" style="margin:0">Không có yêu cầu nào.</p>
    </div>`;
  }
  return `<div class="card" style="margin-top:1.25rem;border-color:var(--warn)">
    <div class="card-head"><h2>Yêu cầu chờ duyệt</h2>
      <span class="badge badge-warn">${requests.length}</span>
      <span class="spacer"></span>
      <button class="btn btn-sm btn-primary" id="approve-all">Duyệt tất cả</button>
    </div>
    <div class="table-wrap"><table class="tbl">
      <thead><tr><th>Học viên</th><th>Bài</th><th>Lý do</th><th>Gửi lúc</th><th style="width:1%"></th></tr></thead>
      <tbody>${requests.map(r => `
        <tr>
          <td>${escapeHtml(r.user.displayName ?? r.user.githubLogin)}</td>
          <td><a href="#/problems/${encodeURIComponent(r.problemId)}">${escapeHtml(problemMap.get(r.problemId)?.title ?? r.problemId)}</a></td>
          <td class="tiny">${escapeHtml(r.messageMd || '—')}</td>
          <td class="tiny faint">${escapeHtml(timeAgo(r.requestedAt))}</td>
          <td class="nowrap">
            <button class="btn btn-sm btn-primary" data-grant="${escapeHtml(r.user.id)}|${escapeHtml(r.problemId)}">Cấp quyền</button>
          </td>
        </tr>`).join('')}</tbody>
    </table></div>
  </div>`;
}

function wire(members, problemMap, allProgress) {
  const doGrant = async (uid, pid, reason = '') => {
    try {
      await grantSolution(uid, pid, reason);
      await refreshNavCounters(); renderHeader();
      toast('Đã cấp quyền.', 'ok');
      reload();
    } catch (err) { toast(err.message, 'err', 6000); }
  };

  for (const b of document.querySelectorAll('[data-grant]')) {
    b.addEventListener('click', () => {
      const [uid, pid] = b.dataset.grant.split('|');
      doGrant(uid, pid, 'Duyệt từ hàng chờ');
    });
  }

  for (const b of document.querySelectorAll('[data-revoke]')) {
    b.addEventListener('click', async () => {
      const [uid, pid] = b.dataset.revoke.split('|');
      const ok = await confirmDialog({
        title: 'Thu hồi quyền xem lời giải?',
        message: 'Học viên sẽ không mở được lời giải bài này nữa.',
        confirmLabel: 'Thu hồi', danger: true,
      });
      if (!ok) return;
      try {
        await revokeGrant(uid, pid);
        toast('Đã thu hồi quyền.', 'ok');
        reload();
      } catch (err) { toast(err.message, 'err'); }
    });
  }

  document.getElementById('approve-all')?.addEventListener('click', async () => {
    const rows = [...document.querySelectorAll('[data-grant]')]
      .map(b => b.dataset.grant.split('|'));
    const ok = await confirmDialog({
      title: `Duyệt ${rows.length} yêu cầu?`,
      message: 'Tất cả học viên trong hàng chờ sẽ được cấp quyền xem lời giải tương ứng.',
      confirmLabel: 'Duyệt tất cả',
    });
    if (!ok) return;

    let done = 0; const errors = [];
    for (const [uid, pid] of rows) {
      try { await grantSolution(uid, pid, 'Duyệt hàng loạt'); done++; }
      catch (err) { errors.push(err.message); }
    }
    await refreshNavCounters(); renderHeader();
    toast(errors.length ? `Đã cấp ${done}, lỗi ${errors.length}.` : `Đã cấp ${done} quyền.`,
      errors.length ? 'warn' : 'ok', 6000);
    reload();
  });

  // Cấp quyền thủ công — chỉ liệt kê những bài học viên đã hoàn thành (INT-08).
  document.getElementById('grant-manual')?.addEventListener('click', async () => {
    const userOpts = members.map(u => ({ value: u.id, label: u.displayName ?? u.githubLogin }));
    if (!userOpts.length) { toast('Chưa có thành viên nào.', 'warn'); return; }

    const first = await formDialog({
      title: 'Cấp quyền — chọn học viên',
      fields: [{ name: 'userId', label: 'Học viên', type: 'select', options: userOpts, value: userOpts[0].value }],
      submitLabel: 'Tiếp tục',
    });
    if (!first) return;

    const doneIds = (allProgress.get(first.userId)?.items || [])
      .filter(i => i.status === STATUS.COMPLETED)
      .map(i => ({ value: i.problemId, label: problemMap.get(i.problemId)?.title ?? i.problemId }));

    if (!doneIds.length) {
      toast('Học viên này chưa hoàn thành bài nào — chưa thể cấp quyền.', 'warn', 6000);
      return;
    }

    const second = await formDialog({
      title: 'Cấp quyền — chọn bài',
      intro: 'Chỉ hiện những bài học viên đã đánh dấu hoàn thành.',
      fields: [
        { name: 'problemId', label: 'Bài tập', type: 'select', options: doneIds, value: doneIds[0].value },
        { name: 'reason', label: 'Lý do (tuỳ chọn)', placeholder: 'vd: Đã trao đổi trực tiếp' },
      ],
      submitLabel: 'Cấp quyền',
    });
    if (!second) return;
    doGrant(first.userId, second.problemId, second.reason);
  });
}

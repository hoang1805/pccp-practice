/**
 * Tổng quan quản trị — việc cần xử lý và sức khoẻ của nhóm (FR-DASH-05).
 */

import { setMain, pageShell, globalBanners, renderHeader } from '../../ui/layout.js';
import { loadingBlock, statTile, emptyState } from '../../ui/components.js';
import { adminNav } from './_nav.js';
import { escapeHtml, formatMinutes, timeAgo, formatDateKey } from '../../core/util.js';
import {
  getUsers, getAllProgress, getProblemMap, refreshNavCounters, activeUsers,
  getTodaySet, getConfig,
} from '../../domain/service.js';
import { navCounters } from '../../domain/counters.js';
import { summarize, problemStats, inactiveUsers } from '../../domain/stats.js';
import { scoreOfSet } from '../../domain/rules.js';

export async function render() {
  setMain(pageShell(loadingBlock()));

  await refreshNavCounters();
  renderHeader();

  const [usersDoc, allProgress, problemMap, todaySet, config] = await Promise.all([
    getUsers(), getAllProgress(), getProblemMap(), getTodaySet(), getConfig(),
  ]);

  const members = activeUsers(usersDoc);
  const stats = problemStats(allProgress);
  const inactive = inactiveUsers(allProgress, members, 7);

  // Tiến độ trung bình của nhóm trên bộ đề hôm nay.
  let todayAvg = null;
  if (todaySet) {
    const scores = members.map(u => scoreOfSet(todaySet, allProgress.get(u.id), config).earned);
    todayAvg = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
  }

  const totals = members.reduce((acc, u) => {
    const s = summarize(allProgress.get(u.id), problemMap);
    acc.completed += s.completed;
    acc.minutes += s.minutes;
    acc.stuck += s.stuck;
    return acc;
  }, { completed: 0, minutes: 0, stuck: 0 });

  // Bài có tỉ lệ vướng cao nhất — dấu hiệu đề quá khó hoặc mô tả chưa rõ.
  const hardest = [...stats.entries()]
    .filter(([, v]) => v.attempts >= 2)
    .sort((a, b) => b[1].stuckRate - a[1].stuckRate)
    .slice(0, 5);

  setMain(pageShell(`
    ${globalBanners()}
    ${adminNav('/admin')}

    <h1>Tổng quan</h1>

    ${queueCard()}

    <div class="grid-4" style="margin-top:1.25rem">
      ${statTile(members.length, 'Thành viên')}
      ${statTile(totals.completed, 'Lượt hoàn thành')}
      ${statTile(totals.stuck, 'Đang hard stuck')}
      ${statTile(formatMinutes(totals.minutes), 'Tổng thời gian nhóm')}
    </div>

    ${todaySet ? `<div class="card card-pad" style="margin-top:1.25rem">
      <h2 style="margin-top:0">Bộ đề hôm nay</h2>
      <p class="muted small">${escapeHtml(todaySet.title || '')} — điểm trung bình của nhóm:
        <strong>${todayAvg}</strong> / ${config?.exam?.totalPoints ?? 1000}</p>
    </div>` : `<div class="note note-warn" style="margin-top:1.25rem">
      Hôm nay chưa có bộ đề chính thức. <a href="#/admin/sets">Đăng bộ đề ngay</a>.
    </div>`}

    <div class="grid-2" style="margin-top:1.25rem">
      ${hardestCard(hardest, problemMap)}
      ${inactiveCard(inactive)}
    </div>
  `));
}

function queueCard() {
  const rows = [
    { n: navCounters.joinRequests,     label: 'Yêu cầu tham gia',      href: '#/admin/users' },
    { n: navCounters.pendingIdeas,     label: 'Ý tưởng chờ duyệt',     href: '#/admin/ideas' },
    { n: navCounters.stuck,            label: 'Học viên đang vướng',   href: '#/admin/stuck' },
    { n: navCounters.solutionRequests, label: 'Xin xem lời giải',      href: '#/admin/grants' },
  ];
  const total = rows.reduce((a, r) => a + r.n, 0);

  if (!total) {
    return `<div class="card card-pad">
      <h2 style="margin-top:0">Hàng chờ</h2>
      <p class="muted" style="margin:0">Không có việc nào đang chờ bạn. 🎉</p>
    </div>`;
  }

  return `<div class="card">
    <div class="card-head"><h2>Hàng chờ</h2><span class="badge badge-danger">${total}</span></div>
    <div class="slot-list">
      ${rows.filter(r => r.n).map(r => `
        <a class="slot-row" href="${r.href}" style="grid-template-columns:3rem 1fr auto">
          <div class="strong" style="font-size:1.2rem">${r.n}</div>
          <div>${escapeHtml(r.label)}</div>
          <div class="faint">→</div>
        </a>`).join('')}
    </div>
  </div>`;
}

function hardestCard(hardest, problemMap) {
  return `<div class="card">
    <div class="card-head"><h2>Bài gây vướng nhiều nhất</h2></div>
    ${hardest.length ? `<div class="table-wrap"><table class="tbl">
      <thead><tr><th>Bài</th><th>Tỉ lệ vướng</th><th>Đã xong</th><th>TB</th></tr></thead>
      <tbody>${hardest.map(([id, v]) => `
        <tr>
          <td><a href="#/problems/${encodeURIComponent(id)}">${escapeHtml(problemMap.get(id)?.title ?? id)}</a></td>
          <td class="strong">${v.stuckRate}%</td>
          <td>${v.completed}/${v.attempts}</td>
          <td class="faint">${escapeHtml(formatMinutes(v.avgMinutes))}</td>
        </tr>`).join('')}</tbody>
    </table></div>` : `<div class="card-pad"><p class="muted small" style="margin:0">
      Chưa đủ dữ liệu (cần ít nhất 2 học viên đã thử cùng một bài).</p></div>`}
  </div>`;
}

function inactiveCard(inactive) {
  return `<div class="card">
    <div class="card-head"><h2>Không hoạt động &gt; 7 ngày</h2>
      ${inactive.length ? `<span class="badge badge-warn">${inactive.length}</span>` : ''}</div>
    ${inactive.length ? `<div class="table-wrap"><table class="tbl">
      <thead><tr><th>Thành viên</th><th>Hoạt động gần nhất</th></tr></thead>
      <tbody>${inactive.map(r => `
        <tr>
          <td>${escapeHtml(r.user.displayName ?? r.user.githubLogin)}</td>
          <td class="faint">${r.lastActive ? escapeHtml(formatDateKey(r.lastActive)) : 'chưa từng'}</td>
        </tr>`).join('')}</tbody>
    </table></div>` : `<div class="card-pad"><p class="muted small" style="margin:0">
      Cả nhóm đều đang hoạt động đều đặn.</p></div>`}
  </div>`;
}

/**
 * Hồ sơ & thống kê cá nhân (FR-USER-06, FR-DASH-02/03/04/06, FR-EXAM-06).
 */

import { setMain, pageShell, globalBanners, renderHeader } from '../ui/layout.js';
import { loadingBlock, statTile, formDialog, toast, emptyState } from '../ui/components.js';
import {
  escapeHtml, formatMinutes, formatDateKey, formatDateTime, downloadFile, todayKey, pct,
} from '../core/util.js';
import { session, userId } from '../core/auth.js';
import {
  getProgress, getProblemMap, getConfig, getExams, getUsers, getAllProgress,
  updateProfile, activeUsers,
} from '../domain/service.js';
import {
  summarize, computeStreak, longestStreak, heatmapData, buildLeaderboard, examTrend,
} from '../domain/stats.js';
import { gradeForScore } from '../domain/rules.js';
import { STATUS } from '../domain/constants.js';
import { reload } from '../core/router.js';

export async function render() {
  setMain(pageShell(loadingBlock()));

  const me = userId();
  const [config, progress, problemMap, exams] = await Promise.all([
    getConfig(), getProgress(), getProblemMap(), getExams(),
  ]);

  const s = summarize(progress, problemMap);
  const streak = computeStreak(progress);
  const best = longestStreak(progress);
  const heat = heatmapData(progress);
  const trend = examTrend(exams);

  let leaderboardHtml = '';
  if (config?.features?.leaderboardEnabled) {
    try {
      const usersDoc = await getUsers();
      const all = await getAllProgress();
      leaderboardHtml = leaderboardCard(buildLeaderboard(all, activeUsers(usersDoc), problemMap), me);
    } catch { /* xếp hạng là phần phụ, lỗi không chặn trang */ }
  }

  setMain(pageShell(`
    ${globalBanners()}

    <div class="row" style="margin-bottom:1.25rem">
      <div>
        <h1 style="margin:0">${escapeHtml(session.user?.displayName ?? session.githubLogin)}</h1>
        <p class="muted small" style="margin:.2rem 0 0">
          ${escapeHtml(session.githubLogin)} ·
          tham gia ${escapeHtml(formatDateKey((session.user?.joinedAt ?? '').slice(0, 10)))}
        </p>
      </div>
      <span class="spacer"></span>
      <button class="btn" id="edit-profile">Sửa hồ sơ</button>
      <button class="btn btn-ghost" id="export">Xuất dữ liệu</button>
    </div>

    <div class="grid-4">
      ${statTile(s.completed, 'Bài hoàn thành',
        `Lv1: ${s.byLevel[1]} · Lv2: ${s.byLevel[2]} · Lv3: ${s.byLevel[3]}`)}
      ${statTile(formatMinutes(s.minutes), 'Tổng thời gian',
        s.avgMinutes ? `TB ${formatMinutes(s.avgMinutes)}/bài` : '')}
      ${statTile(`${streak} ngày`, 'Chuỗi hiện tại', `Dài nhất: ${best} ngày`)}
      ${statTile(`${s.stuckRate}%`, 'Tỉ lệ hard stuck', `${s.stuck}/${s.touched} bài đã đụng tới`)}
    </div>

    <div class="grid-2" style="margin-top:1rem">
      ${statTile(s.selfSolved, 'Tự lực hoàn toàn', 'Không dùng gợi ý, không xem lời giải')}
      ${statTile(`${s.hintsUsed} · ${s.solutionsViewed}`, 'Gợi ý đã mở · Lời giải đã xem')}
    </div>

    ${heatmapCard(heat)}
    ${goalCard(session.user, s, config)}
    ${examCard(trend, config)}
    ${leaderboardHtml}
  `));

  wire(progress, problemMap, exams);
}

/* ------------------------------------------------------------- heatmap -- */

function heatmapCard(heat) {
  const today = todayKey();
  return `
    <div class="card" style="margin-top:1.25rem">
      <div class="card-head"><h2>Hoạt động 12 tháng qua</h2>
        <span class="spacer"></span>
        <span class="small muted">${heat.total} lượt hoạt động</span>
      </div>
      <div class="card-pad">
        <div class="heat">
          ${heat.weeks.map(col => `<div class="heat-col">
            ${col.map(d => d.date > today
              ? '<div class="heat-cell" style="visibility:hidden"></div>'
              : `<div class="heat-cell heat-l${d.level}" title="${escapeHtml(formatDateKey(d.date))}: ${d.count} lượt"></div>`
            ).join('')}
          </div>`).join('')}
        </div>
        <div class="row small faint" style="margin-top:.5rem;justify-content:flex-end">
          <span>ít</span>
          <span class="heat-cell"></span>
          <span class="heat-cell heat-l1"></span>
          <span class="heat-cell heat-l2"></span>
          <span class="heat-cell heat-l3"></span>
          <span class="heat-cell heat-l4"></span>
          <span>nhiều</span>
        </div>
      </div>
    </div>`;
}

/* ---------------------------------------------------------------- mục tiêu -- */

function goalCard(user, s, config) {
  const target = user?.targetScore;
  if (!target) return '';
  const totalPts = config?.exam?.totalPoints ?? 1000;
  return `
    <div class="card card-pad" style="margin-top:1.25rem">
      <h2 style="margin-top:0">Mục tiêu</h2>
      <p class="muted small">Bạn đặt mục tiêu <strong>${escapeHtml(target)}</strong> / ${totalPts} điểm.</p>
    </div>`;
}

/* ------------------------------------------------------------- thi thử -- */

function examCard(trend, config) {
  if (!trend.length) {
    return `<div class="card card-pad" style="margin-top:1.25rem">
      <h2 style="margin-top:0">Lịch sử thi thử</h2>
      <p class="muted small" style="margin:0">Chưa có phiên thi thử nào.
        <a href="#/exam">Bắt đầu phiên đầu tiên</a>.</p>
    </div>`;
  }

  const maxScore = config?.exam?.totalPoints ?? 1000;
  const w = 100 / Math.max(trend.length, 1);

  return `
    <div class="card" style="margin-top:1.25rem">
      <div class="card-head"><h2>Lịch sử thi thử</h2>
        <span class="spacer"></span>
        <span class="small muted">${trend.length} phiên</span></div>
      <div class="card-pad">
        <div style="display:flex;align-items:flex-end;gap:4px;height:120px;margin-bottom:.75rem">
          ${trend.slice(-24).map(t => {
            const h = Math.max(2, Math.round((t.score / maxScore) * 100));
            return `<div style="flex:1;min-width:6px;background:var(--accent);border-radius:3px 3px 0 0;height:${h}%"
                         title="${escapeHtml(formatDateTime(t.at))}: ${t.score}/${maxScore}"></div>`;
          }).join('')}
        </div>
        <div class="table-wrap"><table class="tbl">
          <thead><tr><th>Thời điểm</th><th>Điểm</th><th>Hạng</th><th>Gợi ý đã dùng</th></tr></thead>
          <tbody>${[...trend].reverse().slice(0, 10).map(t => `
            <tr>
              <td>${escapeHtml(formatDateTime(t.at))}</td>
              <td class="strong">${t.score} / ${maxScore}</td>
              <td>${t.grade ? escapeHtml(t.grade) : '<span class="faint">—</span>'}</td>
              <td class="faint">—</td>
            </tr>`).join('')}</tbody>
        </table></div>
      </div>
    </div>`;
}

/* --------------------------------------------------------------- xếp hạng -- */

function leaderboardCard(rows, meId) {
  if (rows.length < 2) return '';
  return `
    <div class="card" style="margin-top:1.25rem">
      <div class="card-head"><h2>Bảng xếp hạng nhóm</h2></div>
      <div class="table-wrap"><table class="tbl">
        <thead><tr>
          <th style="width:3rem">#</th><th>Thành viên</th>
          <th>Hoàn thành</th><th>Tự lực</th><th>Chuỗi</th><th>Thời gian</th>
        </tr></thead>
        <tbody>${rows.map((r, i) => `
          <tr${r.user.id === meId ? ' style="background:var(--accent-soft)"' : ''}>
            <td class="strong">${i + 1}</td>
            <td>${escapeHtml(r.user.displayName ?? r.user.githubLogin)}
              ${r.user.id === meId ? '<span class="badge badge-accent">bạn</span>' : ''}</td>
            <td class="strong">${r.completed}</td>
            <td>${r.selfSolved}</td>
            <td>${r.streak} ngày</td>
            <td class="faint">${escapeHtml(formatMinutes(r.minutes))}</td>
          </tr>`).join('')}</tbody>
      </table></div>
    </div>`;
}

/* ---------------------------------------------------------------- sự kiện -- */

function wire(progress, problemMap, exams) {
  document.getElementById('edit-profile')?.addEventListener('click', async () => {
    const config = await getConfig();
    const values = await formDialog({
      title: 'Sửa hồ sơ',
      fields: [
        { name: 'displayName', label: 'Tên hiển thị', required: true,
          value: session.user?.displayName ?? '' },
        { name: 'primaryLanguage', label: 'Ngôn ngữ chính', type: 'select',
          value: session.user?.primaryLanguage ?? '',
          options: ['', ...(config?.exam?.languages ?? [])] },
        { name: 'targetScore', label: 'Mục tiêu điểm', type: 'number',
          value: session.user?.targetScore ?? '',
          hint: `Trên thang ${config?.exam?.totalPoints ?? 1000} điểm.` },
        { name: 'timezone', label: 'Múi giờ', value: session.user?.timezone ?? '' },
      ],
      validate: v => !v.displayName.trim() ? 'Tên hiển thị không được để trống.' : null,
    });
    if (!values) return;
    try {
      await updateProfile(userId(), values);
      toast('Đã cập nhật hồ sơ.', 'ok');
      renderHeader();
      reload();
    } catch (err) { toast(err.message, 'err'); }
  });

  // FR-DASH-06: xuất báo cáo tiến độ cá nhân.
  document.getElementById('export')?.addEventListener('click', () => {
    const rows = [['problemId', 'title', 'level', 'status', 'timeSpentMinutes',
                   'language', 'selfScore', 'completedAt', 'hintsUsed', 'solutionViewed']];
    for (const i of progress.items || []) {
      const p = problemMap.get(i.problemId);
      rows.push([
        i.problemId, p?.title ?? '', p?.level ?? '', i.status, i.timeSpentMinutes || 0,
        i.language ?? '', i.selfScore ?? '', i.completedAt ?? '',
        (i.hintsRevealed || []).length, i.solutionViewedAt ? 'yes' : 'no',
      ]);
    }
    const csv = rows.map(r => r.map(cell => {
      const v = String(cell ?? '');
      return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
    }).join(',')).join('\n');
    downloadFile(`pccp-progress-${todayKey()}.csv`, '﻿' + csv, 'text/csv;charset=utf-8');
    toast('Đã tải file CSV.', 'ok');
  });
}

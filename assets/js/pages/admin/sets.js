/**
 * Lên lịch và phát hành bộ đề chính thức (FR-SET-01…04, 09).
 */

import { setMain, pageShell, globalBanners } from '../../ui/layout.js';
import { loadingBlock, emptyState, setStatusBadge, toast } from '../../ui/components.js';
import { openSetEditor } from '../../ui/set-view.js';
import { adminNav } from './_nav.js';
import { escapeHtml, todayKey, addDays, formatDateKey, formatDateTime } from '../../core/util.js';
import {
  getDailySetsInRange, publishDailySet, listProblems, getProblemMap, getConfig,
} from '../../domain/service.js';
import { isSetVisible, emptySlots } from '../../domain/rules.js';
import { reload } from '../../core/router.js';

const WINDOW_BACK = 14;
const WINDOW_FWD = 14;

export async function render({ query }) {
  setMain(pageShell(loadingBlock()));

  const today = todayKey();
  const dates = [];
  for (let i = -WINDOW_BACK; i <= WINDOW_FWD; i++) dates.push(addDays(today, i));

  const [config, sets, problems, problemMap] = await Promise.all([
    getConfig(),
    getDailySetsInRange(dates),
    listProblems(),
    getProblemMap(),
  ]);

  const byLevel = { 1: 0, 2: 0, 3: 0 };
  for (const p of problems) byLevel[p.level] = (byLevel[p.level] || 0) + 1;
  const canBuildFullSet = byLevel[1] >= 1 && byLevel[2] >= 1 && byLevel[3] >= 2;

  setMain(pageShell(`
    ${globalBanners()}
    ${adminNav('/admin/sets')}

    <div class="row" style="margin-bottom:1rem">
      <h1 style="margin:0">Bộ đề chính thức</h1>
      <span class="spacer"></span>
      <button class="btn btn-primary" id="new-today">Đăng bộ đề hôm nay</button>
    </div>

    ${!canBuildFullSet ? `<div class="note note-warn" style="margin-bottom:1rem">
      Ngân hàng đề chưa đủ để tạo bộ đề đầy đủ. Cần tối thiểu
      <strong>1 bài Lv.1</strong> (hiện ${byLevel[1] || 0}),
      <strong>1 bài Lv.2</strong> (hiện ${byLevel[2] || 0}),
      <strong>2 bài Lv.3</strong> (hiện ${byLevel[3] || 0}).
      <a href="#/admin/problems">Thêm bài tập</a>.
    </div>` : ''}

    <div class="card table-wrap">
      <table class="tbl">
        <thead><tr>
          <th style="width:11rem">Ngày</th><th>Bộ đề</th>
          <th style="width:8rem">Trạng thái</th><th>Cập nhật</th><th style="width:1%"></th>
        </tr></thead>
        <tbody>${dates.slice().reverse().map(d => row(d, sets.get(d), today, problemMap)).join('')}</tbody>
      </table>
    </div>
  `));

  const openFor = async date => {
    const existing = sets.get(date);
    openSetEditor({
      heading: `Bộ đề ngày ${formatDateKey(date)}`,
      title: existing?.title ?? '',
      slots: existing?.slots ?? emptySlots(config),
      noteMd: existing?.noteMd ?? '',
      problems, config,
      onSave: async ({ title, slots, noteMd }) => {
        await publishDailySet({ date, title, slots, noteMd, publishAt: existing?.publishAt ?? null });
        toast(`Đã lưu bộ đề ngày ${formatDateKey(date)}.`, 'ok');
        reload();
      },
    });
  };

  document.getElementById('new-today').addEventListener('click', () => openFor(today));
  for (const b of document.querySelectorAll('[data-edit-date]')) {
    b.addEventListener('click', () => openFor(b.dataset.editDate));
  }

  if (query.date) openFor(query.date);
}

function row(date, set, today, problemMap) {
  const isToday = date === today;
  const isPast = date < today;
  const scheduled = set && !isSetVisible(set);

  const titles = set
    ? (set.slots || []).map(s => s.problemId
        ? escapeHtml(problemMap.get(s.problemId)?.title ?? s.problemId)
        : '<span class="faint">—</span>').join(' · ')
    : '<span class="faint">chưa có bộ đề</span>';

  return `<tr${isToday ? ' style="background:var(--accent-soft)"' : ''}>
    <td>
      <a href="#/sets/${date}" class="strong">${escapeHtml(formatDateKey(date))}</a>
      ${isToday ? ' <span class="badge badge-accent">hôm nay</span>' : ''}
      <div class="tiny faint">${escapeHtml(formatDateKey(date, { withDow: true }).split(',')[0])}</div>
    </td>
    <td>
      ${set ? `<div class="strong small">${escapeHtml(set.title ?? '')}</div>` : ''}
      <div class="tiny">${titles}</div>
    </td>
    <td>
      ${set ? setStatusBadge(set.status) : ''}
      ${scheduled ? '<div class="tiny faint">hẹn giờ</div>' : ''}
    </td>
    <td class="tiny faint">${set ? escapeHtml(formatDateTime(set.updatedAt)) : '—'}</td>
    <td class="nowrap">
      <button class="btn btn-sm${set ? '' : ' btn-primary'}" data-edit-date="${escapeHtml(date)}"
        ${isPast && !set ? 'title="Ngày đã qua — vẫn sửa được để bổ sung dữ liệu"' : ''}>
        ${set ? 'Sửa' : 'Tạo'}
      </button>
    </td>
  </tr>`;
}

/**
 * Bộ đề của một ngày — hiển thị song song bộ đề chính thức và bộ đề cá nhân.
 */

import { setMain, pageShell, globalBanners } from '../ui/layout.js';
import { loadingBlock, emptyState, toast } from '../ui/components.js';
import { setCard, openSetEditor } from '../ui/set-view.js';
import { escapeHtml, formatDateKey, todayKey, addDays } from '../core/util.js';
import { isMember, isAdmin } from '../core/auth.js';
import {
  getDailySet, getPersonalSet, savePersonalSet, getProgress,
  getProblemMap, listProblems, getConfig,
} from '../domain/service.js';
import { isSetVisible } from '../domain/rules.js';
import { reload } from '../core/router.js';

export async function render({ params }) {
  const date = params.date;
  setMain(pageShell(loadingBlock()));

  const [config, officialRaw, personalSet, progress, problemMap] = await Promise.all([
    getConfig(),
    getDailySet(date),
    isMember() ? getPersonalSet(date) : Promise.resolve(null),
    getProgress(),
    getProblemMap(),
  ]);

  // Bộ đề hẹn giờ chưa tới hạn thì học viên chưa được thấy (FR-SET-09).
  const official = officialRaw && (isSetVisible(officialRaw) || isAdmin()) ? officialRaw : null;
  const scheduled = officialRaw && !isSetVisible(officialRaw);

  const officialHtml = official
    ? setCard(official, progress, problemMap, {
        title: official.title || 'Bộ đề chính thức',
        config,
        headerExtra: `
          ${scheduled ? '<span class="badge badge-warn">chưa tới giờ phát hành</span>' : ''}
          ${isMember() ? `<button class="btn btn-sm" id="copy-set">Sao chép</button>` : ''}
          ${isAdmin() ? `<a class="btn btn-sm" href="#/admin/sets?date=${encodeURIComponent(date)}">Sửa</a>` : ''}`,
      })
    : emptyState({
        title: 'Không có bộ đề chính thức cho ngày này',
        message: isAdmin() ? 'Bạn có thể đăng bộ đề cho ngày này.' : 'Quản trị viên chưa đăng bộ đề cho ngày này.',
        actionHtml: isAdmin()
          ? `<a class="btn btn-primary" href="#/admin/sets?date=${encodeURIComponent(date)}">Đăng bộ đề</a>` : '',
      });

  const personalHtml = !isMember() ? '' : personalSet
    ? setCard(personalSet, progress, problemMap, {
        title: personalSet.title || 'Bộ đề cá nhân',
        config,
        headerExtra: `<button class="btn btn-sm" id="edit-personal">Sửa</button>`,
      })
    : `<div class="card card-pad row">
         <div>
           <h2 style="margin:0">Bộ đề cá nhân</h2>
           <p class="muted small" style="margin:.25rem 0 0">Chưa ghim bộ đề nào cho ngày này.</p>
         </div>
         <span class="spacer"></span>
         <button class="btn btn-primary" id="new-personal">Tạo bộ đề</button>
       </div>`;

  setMain(pageShell(`
    ${globalBanners()}
    <div class="row" style="margin-bottom:1rem">
      <div>
        <a href="#/calendar" class="small muted">← Lịch</a>
        <h1 style="margin:.2rem 0 0">${escapeHtml(formatDateKey(date, { withDow: true }))}</h1>
      </div>
      <span class="spacer"></span>
      <a class="btn btn-sm" href="#/sets/${addDays(date, -1)}">← Hôm trước</a>
      <a class="btn btn-sm" href="#/sets/${todayKey()}">Hôm nay</a>
      <a class="btn btn-sm" href="#/sets/${addDays(date, 1)}">Hôm sau →</a>
    </div>

    <div class="stack">
      ${officialHtml}
      ${personalHtml}
    </div>
  `));

  const openEditor = async (base, heading) => {
    const problems = await listProblems();
    if (!problems.length) { toast('Ngân hàng đề đang trống.', 'warn'); return; }
    openSetEditor({
      heading, title: base?.title ?? '', slots: base?.slots ?? null,
      problems, config, withNote: false,
      onSave: async ({ title, slots }) => {
        await savePersonalSet({ date, title, slots, copiedFrom: base?.id ?? null });
        toast('Đã lưu bộ đề cá nhân.', 'ok');
        reload();
      },
    });
  };

  document.getElementById('new-personal')?.addEventListener('click', () => openEditor(null, 'Tạo bộ đề cá nhân'));
  document.getElementById('edit-personal')?.addEventListener('click', () => openEditor(personalSet, 'Sửa bộ đề cá nhân'));
  document.getElementById('copy-set')?.addEventListener('click', () => openEditor(official, 'Sao chép thành bộ đề cá nhân'));
}

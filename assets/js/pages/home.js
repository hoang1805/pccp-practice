/**
 * Trang chủ — bộ đề hôm nay, tiến độ, và việc cần xử lý (FR-DASH-01).
 */

import { setMain, pageShell, globalBanners } from '../ui/layout.js';
import { emptyState, loadingBlock, statTile, ideaBadge, toast } from '../ui/components.js';
import { setCard, openSetEditor } from '../ui/set-view.js';
import { escapeHtml, todayKey, formatDateKey, timeAgo, formatMinutes } from '../core/util.js';
import { session, isMember, isAdmin, userId } from '../core/auth.js';
import {
  getConfig, getTodaySet, getProgress, getProblemMap, listProblems,
  getPersonalSet, savePersonalSet, getIdeas, getHints, refreshNavCounters,
} from '../domain/service.js';
import { IDEA_STATUS, STATUS } from '../domain/constants.js';
import { computeStreak } from '../domain/stats.js';
import { reload } from '../core/router.js';

export async function render() {
  setMain(pageShell(loadingBlock()));

  const today = todayKey();
  const me = userId();

  const [config, officialSet, progress, problemMap, personalSet] = await Promise.all([
    getConfig(),
    getTodaySet(),
    getProgress(),
    getProblemMap(),
    me ? getPersonalSet(today) : Promise.resolve(null),
  ]);

  const todo = isMember() ? await buildTodoList(progress, problemMap) : [];
  const streak = isMember() ? computeStreak(progress) : 0;

  const officialHtml = officialSet
    ? setCard(officialSet, progress, problemMap, {
        title: officialSet.title || `Bộ đề ngày ${formatDateKey(today)}`,
        config,
        headerExtra: isMember()
          ? `<button class="btn btn-sm" id="copy-set">Sao chép thành bộ đề cá nhân</button>` : '',
      })
    : emptyState({
        title: 'Hôm nay chưa có bộ đề chính thức',
        message: isAdmin()
          ? 'Bạn có thể đăng bộ đề cho hôm nay ngay bây giờ.'
          : 'Quản trị viên chưa đăng bộ đề. Bạn vẫn có thể tự ghim bộ đề cá nhân.',
        actionHtml: isAdmin()
          ? `<a class="btn btn-primary" href="#/admin/sets">Đăng bộ đề</a>`
          : (isMember() ? `<button class="btn btn-primary" id="new-personal">Tạo bộ đề cá nhân</button>` : ''),
      });

  const personalHtml = !isMember() ? '' : personalSet
    ? setCard(personalSet, progress, problemMap, {
        title: personalSet.title || 'Bộ đề cá nhân',
        config,
        headerExtra: `<button class="btn btn-sm" id="edit-personal">Sửa</button>`,
      })
    : `<div class="card card-pad">
         <div class="row">
           <div>
             <h2 style="margin:0">Bộ đề cá nhân</h2>
             <p class="muted small" style="margin:.25rem 0 0">
               Tự chọn 4 bài theo cấu trúc PCCP để luyện riêng.</p>
           </div>
           <span class="spacer"></span>
           <button class="btn btn-primary" id="new-personal">Tạo bộ đề</button>
         </div>
       </div>`;

  const stats = isMember() ? statsRow(progress, streak) : '';

  setMain(pageShell(`
    ${globalBanners()}

    <div class="row" style="margin-bottom:1rem">
      <div>
        <h1 style="margin:0">${escapeHtml(formatDateKey(today, { withDow: true }))}</h1>
        <p class="muted small" style="margin:.2rem 0 0">
          ${session.isGuest
            ? 'Bạn đang xem với tư cách khách.'
            : `Chào ${escapeHtml(session.user?.displayName ?? session.githubLogin)} 👋`}
        </p>
      </div>
      <span class="spacer"></span>
      ${isMember() ? `<a class="btn btn-primary" href="#/exam">Bắt đầu thi thử 120′</a>` : ''}
    </div>

    ${stats}

    <div class="stack" style="margin-top:1.25rem">
      ${officialHtml}
      ${personalHtml}
      ${todoCard(todo)}
    </div>
  `));

  wire({ today, config, personalSet, officialSet });
}

/* ------------------------------------------------------------- thống kê -- */

function statsRow(progress, streak) {
  const items = progress.items || [];
  const done = items.filter(i => i.status === STATUS.COMPLETED).length;
  const stuck = items.filter(i => i.status === STATUS.HARD_STUCK).length;
  const mins = items.reduce((s, i) => s + (i.timeSpentMinutes || 0), 0);
  return `<div class="grid-4">
    ${statTile(done, 'Bài đã hoàn thành')}
    ${statTile(stuck, 'Đang hard stuck')}
    ${statTile(formatMinutes(mins), 'Tổng thời gian')}
    ${statTile(`${streak} ngày`, 'Chuỗi luyện tập')}
  </div>`;
}

/* ------------------------------------------------------- việc cần xử lý -- */

async function buildTodoList(progress, problemMap) {
  const todo = [];
  const me = userId();

  const ideas = await getIdeas();
  for (const idea of ideas.ideas || []) {
    const title = problemMap.get(idea.problemId)?.title ?? idea.problemId;
    if (idea.status === IDEA_STATUS.NEEDS_REVISION) {
      todo.push({
        icon: '✎',
        html: `Ý tưởng bài <strong>${escapeHtml(title)}</strong> bị yêu cầu sửa`,
        note: idea.review?.commentMd ?? '',
        href: `#/problems/${encodeURIComponent(idea.problemId)}`,
        badge: ideaBadge(idea.status),
      });
    }
  }

  // Gợi ý mới mà user chưa mở, chỉ xét những bài đang hard stuck.
  const stuckItems = (progress.items || []).filter(i => i.status === STATUS.HARD_STUCK);
  await Promise.all(stuckItems.map(async item => {
    try {
      const hintsDoc = await getHints(item.problemId);
      const revealed = new Set((item.hintsRevealed || []).map(r => r.hintId));
      const fresh = (hintsDoc.hints || []).filter(h =>
        (h.targetUserId === me || !h.targetUserId) && !revealed.has(h.id));
      if (fresh.length) {
        const title = problemMap.get(item.problemId)?.title ?? item.problemId;
        todo.push({
          icon: '💡',
          html: `Có <strong>${fresh.length}</strong> gợi ý chưa mở cho bài <strong>${escapeHtml(title)}</strong>`,
          note: '',
          href: `#/problems/${encodeURIComponent(item.problemId)}`,
          badge: '',
        });
      }
    } catch { /* bài chưa có file hint */ }
  }));

  for (const item of stuckItems) {
    const title = problemMap.get(item.problemId)?.title ?? item.problemId;
    todo.push({
      icon: '⚠',
      html: `Đang vướng ở bài <strong>${escapeHtml(title)}</strong>`,
      note: item.stuckSince ? `Đã vướng ${timeAgo(item.stuckSince)}` : '',
      href: `#/problems/${encodeURIComponent(item.problemId)}`,
      badge: '',
    });
  }

  return todo;
}

function todoCard(todo) {
  if (!isMember()) return '';
  if (!todo.length) {
    return `<div class="card card-pad">
      <h2 style="margin-top:0">Cần xử lý</h2>
      <p class="muted" style="margin:0">Không có việc nào đang chờ bạn. 🎉</p>
    </div>`;
  }
  return `<div class="card">
    <div class="card-head"><h2>Cần xử lý</h2>
      <span class="badge badge-warn">${todo.length}</span></div>
    <div class="slot-list">
      ${todo.map(t => `
        <a class="slot-row" href="${escapeHtml(t.href)}" style="grid-template-columns:24px 1fr auto">
          <div aria-hidden="true">${t.icon}</div>
          <div>
            <div>${t.html}</div>
            ${t.note ? `<div class="tiny faint">${escapeHtml(t.note)}</div>` : ''}
          </div>
          <div>${t.badge}</div>
        </a>`).join('')}
    </div>
  </div>`;
}

/* --------------------------------------------------------------- sự kiện -- */

function wire({ today, config, personalSet, officialSet }) {
  const openEditor = async (base, heading) => {
    const problems = await listProblems();
    if (!problems.length) {
      toast('Ngân hàng đề đang trống. Hãy nhờ quản trị viên thêm bài tập.', 'warn');
      return;
    }
    openSetEditor({
      heading,
      title: base?.title ?? '',
      slots: base?.slots ?? null,
      problems,
      config,
      withNote: false,
      onSave: async ({ title, slots }) => {
        await savePersonalSet({ date: today, title, slots, copiedFrom: base?.id ?? null });
        toast('Đã lưu bộ đề cá nhân.', 'ok');
        reload();
      },
    });
  };

  document.getElementById('new-personal')?.addEventListener('click',
    () => openEditor(null, 'Tạo bộ đề cá nhân'));

  document.getElementById('edit-personal')?.addEventListener('click',
    () => openEditor(personalSet, 'Sửa bộ đề cá nhân'));

  // FR-SET-10: sao chép bộ đề chính thức thành bộ đề cá nhân để tuỳ biến.
  document.getElementById('copy-set')?.addEventListener('click',
    () => openEditor(officialSet, 'Sao chép thành bộ đề cá nhân'));

  if (isAdmin()) refreshNavCounters().catch(() => {});
}

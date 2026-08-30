/**
 * Hàng chờ duyệt ý tưởng (FR-IDEA-03, 06, 07, 08).
 */

import { setMain, pageShell, globalBanners, renderHeader } from '../../ui/layout.js';
import { loadingBlock, emptyState, ideaBadge, toast, modal } from '../../ui/components.js';
import { renderMarkdown } from '../../ui/markdown.js';
import { adminNav } from './_nav.js';
import { escapeHtml, timeAgo, formatDateTime, matchesQuery } from '../../core/util.js';
import {
  getPendingIdeas, reviewIdea, getProblemMap, refreshNavCounters, getConfig,
} from '../../domain/service.js';
import { IDEA_STATUS } from '../../domain/constants.js';
import { reload } from '../../core/router.js';

export async function render() {
  setMain(pageShell(loadingBlock()));

  const [pending, problemMap, config] = await Promise.all([
    getPendingIdeas(), getProblemMap(), getConfig(),
  ]);

  setMain(pageShell(`
    ${globalBanners()}
    ${adminNav('/admin/ideas')}

    <div class="row" style="margin-bottom:1rem">
      <h1 style="margin:0">Duyệt ý tưởng</h1>
      ${pending.length ? `<span class="badge badge-warn">${pending.length} chờ duyệt</span>` : ''}
    </div>

    ${pending.length ? `
      <div class="card card-pad" style="margin-bottom:1rem">
        <input type="search" id="q" placeholder="Lọc theo học viên hoặc tên bài…">
      </div>
      <div class="stack" id="list"></div>`
    : emptyState({
        title: 'Không có ý tưởng nào chờ duyệt',
        message: 'Khi học viên nộp ý tưởng, chúng sẽ xuất hiện ở đây.',
        actionHtml: `<a class="btn" href="#/admin">Về tổng quan</a>`,
      })}
  `));

  if (!pending.length) return;

  const listEl = document.getElementById('list');

  function draw(q = '') {
    const rows = pending.filter(i => {
      const title = problemMap.get(i.problemId)?.title ?? i.problemId;
      return matchesQuery(`${i.user.displayName} ${i.user.githubLogin} ${title}`, q);
    });

    listEl.innerHTML = rows.map(i => {
      const title = problemMap.get(i.problemId)?.title ?? i.problemId;
      const resubmit = (i.version ?? 1) > 1;
      return `<div class="card">
        <div class="card-head">
          <div>
            <div class="strong">${escapeHtml(i.user.displayName ?? i.user.githubLogin)}</div>
            <div class="tiny faint">
              <a href="#/problems/${encodeURIComponent(i.problemId)}">${escapeHtml(title)}</a>
              · nộp ${escapeHtml(timeAgo(i.submittedAt))}
              ${resubmit ? ` · <span class="badge badge-info">nộp lại lần ${i.version}</span>` : ''}
            </div>
          </div>
          <span class="spacer"></span>
          ${ideaBadge(i.status)}
        </div>
        <div class="card-pad">
          <div class="md" data-idea-md="${escapeHtml(i.id)}">${renderMarkdown(i.contentMd)}</div>
          ${(i.history || []).length ? `
            <details style="margin-top:.75rem">
              <summary class="small muted" style="cursor:pointer">Xem ${i.history.length} phiên bản trước</summary>
              ${i.history.map(h => `
                <div style="margin-top:.75rem;padding-left:.75rem;border-left:2px solid var(--border)">
                  <div class="tiny faint">v${escapeHtml(h.version)} · ${escapeHtml(formatDateTime(h.submittedAt))}</div>
                  ${h.review?.commentMd ? `<div class="note note-warn" style="margin:.35rem 0">${escapeHtml(h.review.commentMd)}</div>` : ''}
                  <div class="md">${renderMarkdown(h.contentMd)}</div>
                </div>`).join('')}
            </details>` : ''}
        </div>
        <div class="card-pad" style="border-top:1px solid var(--border)">
          <div class="row">
            <button class="btn btn-primary" data-decide="${escapeHtml(i.user.id)}|${escapeHtml(i.id)}|APPROVED">Duyệt</button>
            <button class="btn" data-decide="${escapeHtml(i.user.id)}|${escapeHtml(i.id)}|NEEDS_REVISION">Yêu cầu sửa</button>
            <button class="btn btn-ghost" data-decide="${escapeHtml(i.user.id)}|${escapeHtml(i.id)}|REJECTED">Từ chối</button>
          </div>
        </div>
      </div>`;
    }).join('') || emptyState({ title: 'Không có kết quả', message: 'Thử từ khoá khác.' });

    for (const b of listEl.querySelectorAll('[data-decide]')) {
      b.addEventListener('click', () => {
        const [uid, ideaId, decision] = b.dataset.decide.split('|');
        openReview(uid, ideaId, decision, config);
      });
    }
  }

  document.getElementById('q').addEventListener('input', e => draw(e.target.value));
  draw();
}

function openReview(targetUserId, ideaId, decision, config) {
  const isApprove = decision === IDEA_STATUS.APPROVED;
  const label = {
    APPROVED: 'Duyệt ý tưởng',
    NEEDS_REVISION: 'Yêu cầu sửa lại',
    REJECTED: 'Từ chối ý tưởng',
  }[decision];

  modal({
    title: label,
    body: `
      ${isApprove
        ? `<div class="note note-ok" style="margin-bottom:1rem">
             Nhận xét là tuỳ chọn khi duyệt.
             ${config?.features?.autoGrantOnApprovedIdea
               ? '<br><strong>Lưu ý:</strong> chế độ tự cấp quyền đang bật — nếu học viên đã hoàn thành bài, họ sẽ được mở lời giải ngay.'
               : ''}
           </div>`
        : `<div class="note note-warn" style="margin-bottom:1rem">
             Nhận xét là <strong>bắt buộc</strong> — học viên cần biết phải sửa gì.
           </div>`}
      <div class="field">
        <label for="rv-comment">Nhận xét (Markdown)${isApprove ? '' : ' <span style="color:var(--danger)">*</span>'}</label>
        <textarea id="rv-comment" rows="6" placeholder="${isApprove
          ? 'vd: Ý tưởng tốt, độ phức tạp phân tích chính xác.'
          : 'vd: Chưa xử lý trường hợp trọng số 0. Bổ sung phần chứng minh tính đúng.'}"></textarea>
      </div>
      <div class="field-error" id="rv-err" hidden></div>`,
    actions: [
      { label: 'Huỷ', onClick: ({ close }) => close() },
      {
        label: label, variant: isApprove ? 'primary' : (decision === 'REJECTED' ? 'danger' : 'primary'),
        onClick: async ({ el, close }) => {
          const comment = el.querySelector('#rv-comment').value;
          const err = el.querySelector('#rv-err');
          try {
            await reviewIdea(targetUserId, ideaId, decision, comment);
            await refreshNavCounters(); renderHeader();
            toast('Đã ghi nhận quyết định.', 'ok');
            close();
            reload();
          } catch (e) { err.textContent = e.message; err.hidden = false; }
        },
      },
    ],
  });
}

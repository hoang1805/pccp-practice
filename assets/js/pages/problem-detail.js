/**
 * Chi tiết bài tập — màn hình làm việc chính của học viên.
 * Gộp FR-PROB-04, FR-STAT-*, FR-IDEA-*, FR-HINT-*, FR-SOL-*.
 */

import { setMain, pageShell, globalBanners } from '../ui/layout.js';
import {
  loadingBlock, statusChip, levelBadge, ideaBadge, toast, modal,
  confirmDialog, formDialog, emptyState, hintLevelLabel,
} from '../ui/components.js';
import { renderMarkdown, mountMarkdown } from '../ui/markdown.js';
import {
  escapeHtml, html, formatMinutes, timeAgo, formatDateTime, durationSince, nowIso,
} from '../core/util.js';
import { session, isMember, isAdmin, userId } from '../core/auth.js';
import {
  getProblem, getProgress, getIdeas, getHints, getGrants, getConfig,
  setProblemStatus, patchProgress, saveIdea, revealHint, rateHint,
  getSolutionFor, markSolutionViewed, requestSolutionAccess, toggleBookmark,
  getPersonal, createHint, saveSolution, getSolutionRaw, decodeSolution,
} from '../domain/service.js';
import {
  progressOf, visibleHints, canRevealHint, isHintRevealed, ideaFor,
  SOLUTION_REASON_TEXT, nextRevealableLevel,
} from '../domain/rules.js';
import { STATUS, STATUS_META, STATUS_ORDER, IDEA_STATUS, MIN_STUCK_REASON } from '../domain/constants.js';
import { reload, navigate } from '../core/router.js';

export async function render({ params }) {
  const id = params.id;
  setMain(pageShell(loadingBlock()));

  const problem = await getProblem(id);
  if (!problem) {
    setMain(pageShell(emptyState({
      title: 'Không tìm thấy bài tập',
      message: `Mã bài "${id}" không tồn tại hoặc đã bị xoá.`,
      actionHtml: `<a class="btn btn-primary" href="#/problems">Về danh sách bài tập</a>`,
    }), { narrow: true }));
    return;
  }

  const me = userId();
  const [config, progressDoc, ideasDoc, hintsDoc, grantsDoc, personal] = await Promise.all([
    getConfig(),
    getProgress(),
    isMember() ? getIdeas() : Promise.resolve({ ideas: [] }),
    getHints(id),
    isMember() ? getGrants() : Promise.resolve({ grants: [], requests: [] }),
    isMember() ? getPersonal() : Promise.resolve({ bookmarks: [] }),
  ]);

  const item = progressOf(progressDoc, id);
  const idea = ideaFor(ideasDoc, id);
  const myHints = visibleHints(hintsDoc, me, { isAdmin: isAdmin() });
  const bookmarked = (personal.bookmarks || []).some(b => b.problemId === id);
  const solution = isMember() ? await getSolutionFor(id) : { allowed: false, reason: 'need_both', exists: false };
  const pendingRequest = (grantsDoc.requests || []).find(r => r.problemId === id && r.status === 'PENDING');

  setMain(pageShell(`
    ${globalBanners()}

    <div class="row" style="margin-bottom:.35rem">
      <a href="#/problems" class="small muted">← Ngân hàng đề</a>
    </div>

    <div class="row" style="margin-bottom:1rem;align-items:flex-start">
      <div style="flex:1 1 20rem">
        <div class="row-tight" style="margin-bottom:.35rem">
          <span class="mono tiny faint">${escapeHtml(problem.id)}</span>
          ${levelBadge(problem.level)}
          ${problem.archived ? '<span class="badge badge-neutral">đã lưu trữ</span>' : ''}
        </div>
        <h1 style="margin:0">${escapeHtml(problem.title)}</h1>
        <div class="chip-row" style="margin-top:.45rem">
          ${(problem.tags || []).map(t => `<span class="tag">${escapeHtml(t)}</span>`).join('')}
          ${problem.estimatedMinutes ? `<span class="tag">~${escapeHtml(formatMinutes(problem.estimatedMinutes))}</span>` : ''}
        </div>
      </div>
      <div class="row-tight">
        ${isMember() ? `<button class="btn btn-sm" id="bookmark">${bookmarked ? '📌 Bỏ ghim' : '📌 Ghim'}</button>` : ''}
        ${isAdmin() ? `<button class="btn btn-sm" id="admin-solution">Soạn lời giải</button>` : ''}
        ${isAdmin() ? `<a class="btn btn-sm" href="#/admin/problems?edit=${encodeURIComponent(id)}">Sửa bài</a>` : ''}
      </div>
    </div>

    <div class="split">
      <div class="stack">
        ${statementCard(problem)}
        ${samplesCard(problem)}
        ${sourceCard(problem)}
      </div>

      <div class="stack sticky-side">
        ${statusCard(item)}
        ${isMember() ? ideaCard(idea) : ''}
        ${isMember() ? hintsCard(myHints, item) : ''}
        ${isMember() ? solutionCard(solution, pendingRequest) : ''}
        ${isAdmin() ? adminHintCard(hintsDoc) : ''}
      </div>
    </div>
  `));

  mountMarkdown(document.getElementById('statement-md'), problem.statementMd);
  if (problem.constraintsMd) mountMarkdown(document.getElementById('constraints-md'), problem.constraintsMd);

  wire({ problem, item, idea, myHints, hintsDoc, solution, bookmarked, config });
}

/* ============================================================ cột trái == */

function statementCard(problem) {
  return `
    <div class="card">
      <div class="card-head"><h2>Đề bài</h2></div>
      <div class="card-pad">
        <div class="md" id="statement-md"></div>
        ${problem.constraintsMd ? `
          <h3 style="margin-top:1.5rem">Ràng buộc</h3>
          <div class="md" id="constraints-md"></div>` : ''}
      </div>
    </div>`;
}

function samplesCard(problem) {
  const samples = problem.samples || [];
  if (!samples.length) return '';
  return `
    <div class="card">
      <div class="card-head"><h2>Ví dụ</h2></div>
      <div class="card-pad stack">
        ${samples.map((s, i) => `
          <div>
            <div class="strong small" style="margin-bottom:.4rem">Ví dụ ${i + 1}</div>
            <div class="grid-2">
              <div>
                <div class="tiny faint" style="margin-bottom:.2rem">Input</div>
                <pre class="md"><code>${escapeHtml(s.input ?? '')}</code></pre>
              </div>
              <div>
                <div class="tiny faint" style="margin-bottom:.2rem">Output</div>
                <pre class="md"><code>${escapeHtml(s.output ?? '')}</code></pre>
              </div>
            </div>
            ${s.explanation ? `<div class="small muted">${escapeHtml(s.explanation)}</div>` : ''}
          </div>`).join('<hr>')}
      </div>
    </div>`;
}

function sourceCard(problem) {
  if (!problem.sourceUrl && !problem.difficultyNote && !problem.sourceNote) return '';
  return `
    <div class="card card-pad">
      ${problem.difficultyNote ? `<p class="small"><strong>Lưu ý độ khó:</strong> ${escapeHtml(problem.difficultyNote)}</p>` : ''}
      ${problem.sourceUrl ? `<p class="small" style="margin-bottom:0">
        <strong>Nguồn:</strong>
        <a href="${escapeHtml(problem.sourceUrl)}" target="_blank" rel="noopener noreferrer nofollow">${escapeHtml(problem.sourceUrl)}</a>
        ${problem.sourceNote ? `<br><span class="faint tiny">${escapeHtml(problem.sourceNote)}</span>` : ''}
      </p>` : ''}
    </div>`;
}

/* =========================================================== cột phải == */

function statusCard(item) {
  if (!isMember()) {
    return `<div class="card card-pad">
      <h3 style="margin-top:0">Trạng thái của bạn</h3>
      <p class="muted small" style="margin:0">
        <a href="#/login">Đăng nhập</a> để theo dõi tiến độ của riêng bạn.</p>
    </div>`;
  }

  const opts = STATUS_ORDER.map((s, i) => {
    const m = STATUS_META[s];
    const checked = item.status === s ? ' checked' : '';
    return `<label style="display:flex;gap:.5rem;align-items:center;font-weight:500;cursor:pointer;padding:.3rem 0">
      <input type="radio" name="status" value="${s}"${checked} style="width:auto">
      <span class="st st-${s}">${escapeHtml(m.label)}</span>
      <span class="spacer"></span>
      <span class="kbd">${i + 1}</span>
    </label>`;
  }).join('');

  const meta = [];
  if (item.timeSpentMinutes) meta.push(`⏱ ${formatMinutes(item.timeSpentMinutes)}`);
  if (item.language) meta.push(escapeHtml(item.language));
  if (item.selfScore != null) meta.push(`${item.selfScore} điểm tự chấm`);

  return `
    <div class="card">
      <div class="card-head"><h3>Trạng thái của bạn</h3></div>
      <div class="card-pad">
        <form id="status-form">${opts}</form>
        ${item.status === STATUS.HARD_STUCK && item.stuckReason ? `
          <div class="note note-warn" style="margin-top:.75rem">
            <div class="tiny strong" style="margin-bottom:.2rem">Điểm vướng bạn đã mô tả
              ${item.stuckSince ? `· ${escapeHtml(durationSince(item.stuckSince))}` : ''}</div>
            ${escapeHtml(item.stuckReason)}
            <div style="margin-top:.5rem"><button class="btn btn-sm" id="edit-stuck">Cập nhật mô tả</button></div>
          </div>` : ''}
        ${meta.length ? `<div class="chip-row" style="margin-top:.75rem">
          ${meta.map(m => `<span class="tag">${m}</span>`).join('')}</div>` : ''}
        ${item.status === STATUS.COMPLETED ? `
          <div style="margin-top:.75rem">
            <button class="btn btn-sm btn-block" id="edit-result">Sửa thông tin hoàn thành</button>
          </div>` : ''}
      </div>
    </div>`;
}

function ideaCard(idea) {
  const body = !idea
    ? `<p class="muted small">Chưa nộp ý tưởng nào. Trình bày hướng tiếp cận trước khi code
         giúp bạn nhìn ra lỗ hổng sớm — và quản trị viên có thể góp ý.</p>
       <button class="btn btn-primary btn-block" id="write-idea">Viết ý tưởng</button>`
    : `
      <div class="row-tight" style="margin-bottom:.5rem">
        ${ideaBadge(idea.status)}
        <span class="tiny faint">phiên bản ${escapeHtml(idea.version ?? 1)}</span>
      </div>
      ${idea.review?.commentMd ? `
        <div class="note ${idea.status === IDEA_STATUS.APPROVED ? 'note-ok' : idea.status === IDEA_STATUS.REJECTED ? 'note-danger' : 'note-warn'}"
             style="margin-bottom:.6rem">
          <div class="tiny strong" style="margin-bottom:.2rem">Nhận xét của quản trị viên</div>
          ${escapeHtml(idea.review.commentMd)}
          <div class="tiny faint" style="margin-top:.3rem">${escapeHtml(timeAgo(idea.review.reviewedAt))}</div>
        </div>` : ''}
      <div class="row-tight">
        <button class="btn btn-sm" id="view-idea">Xem</button>
        ${idea.status !== IDEA_STATUS.APPROVED
          ? `<button class="btn btn-sm btn-primary" id="write-idea">${
              idea.status === IDEA_STATUS.NEEDS_REVISION ? 'Sửa &amp; nộp lại' : 'Sửa'}</button>` : ''}
        ${(idea.history || []).length
          ? `<button class="btn btn-sm btn-ghost" id="idea-history">Lịch sử (${idea.history.length})</button>` : ''}
      </div>`;

  return `<div class="card">
    <div class="card-head"><h3>Ý tưởng giải</h3></div>
    <div class="card-pad">${body}</div>
  </div>`;
}

function hintsCard(hints, item) {
  if (!hints.length) {
    return `<div class="card card-pad">
      <h3 style="margin-top:0">Gợi ý</h3>
      <p class="muted small" style="margin:0">
        Chưa có gợi ý nào. Nếu bị vướng, hãy chuyển trạng thái sang
        <strong>Hard stuck</strong> và mô tả điểm kẹt — quản trị viên sẽ gửi gợi ý cho bạn.</p>
    </div>`;
  }

  const sorted = [...hints].sort((a, b) => a.level - b.level);
  const nextLevel = nextRevealableLevel(hints, (item.hintsRevealed || []).map(r => r.hintId));

  return `<div class="card">
    <div class="card-head"><h3>Gợi ý</h3>
      <span class="badge badge-neutral">${sorted.length}</span></div>
    <div class="card-pad">
      ${sorted.map(h => {
        const revealed = isHintRevealed(item, h.id);
        const openable = canRevealHint(h, hints, item);
        if (revealed) {
          const fb = h.feedback;
          return `<div class="hint-item">
            <div class="row-tight" style="margin-bottom:.35rem">
              <span class="badge badge-info">${escapeHtml(hintLevelLabel(h.level))}</span>
              ${h.targetUserId ? '' : '<span class="tag">chung</span>'}
              <span class="spacer"></span>
              <span class="tiny faint">${escapeHtml(timeAgo(h.createdAt))}</span>
            </div>
            <div class="md" data-hint-md="${escapeHtml(h.id)}"></div>
            <div class="row-tight" style="margin-top:.5rem">
              <span class="tiny faint">Gợi ý này có ích không?</span>
              <button class="btn btn-sm btn-ghost" data-rate="${escapeHtml(h.id)}" data-helpful="1"
                ${fb?.helpful === true ? 'disabled' : ''}>👍</button>
              <button class="btn btn-sm btn-ghost" data-rate="${escapeHtml(h.id)}" data-helpful="0"
                ${fb?.helpful === false ? 'disabled' : ''}>👎</button>
            </div>
          </div>`;
        }
        return `<div class="hint-item hint-locked">
          <div class="row-tight">
            <span aria-hidden="true">🔒</span>
            <span class="strong small">${escapeHtml(hintLevelLabel(h.level))}</span>
            <span class="spacer"></span>
            ${openable
              ? `<button class="btn btn-sm" data-reveal="${escapeHtml(h.id)}" data-level="${escapeHtml(h.level)}">Mở gợi ý</button>`
              : `<span class="tiny faint">mở cấp ${nextLevel ?? '?'} trước</span>`}
          </div>
        </div>`;
      }).join('')}
    </div>
  </div>`;
}

function solutionCard(solution, pendingRequest) {
  if (solution.allowed) {
    return `<div class="card">
      <div class="card-head"><h3>Lời giải</h3><span class="badge badge-ok">đã mở</span></div>
      <div class="card-pad">
        ${solution.exists
          ? `<p class="muted small">Bạn đã đủ điều kiện xem lời giải chi tiết.</p>
             <button class="btn btn-primary btn-block" id="open-solution">Xem lời giải</button>`
          : `<p class="muted small" style="margin:0">Quản trị viên chưa soạn lời giải cho bài này.</p>`}
      </div>
    </div>`;
  }

  const text = SOLUTION_REASON_TEXT[solution.reason] ?? '';
  return `<div class="card">
    <div class="card-head"><h3>Lời giải</h3><span class="badge badge-neutral">🔒 khoá</span></div>
    <div class="card-pad">
      <p class="muted small">${escapeHtml(text)}</p>
      ${solution.reason === 'need_grant'
        ? (pendingRequest
            ? `<div class="note note-info">Đã gửi yêu cầu ${escapeHtml(timeAgo(pendingRequest.requestedAt))}. Đang chờ duyệt.</div>`
            : `<button class="btn btn-block" id="request-solution">Yêu cầu xem lời giải</button>`)
        : ''}
    </div>
  </div>`;
}

function adminHintCard(hintsDoc) {
  const all = hintsDoc.hints || [];
  return `<div class="card">
    <div class="card-head"><h3>Quản trị · Gợi ý</h3>
      <span class="badge badge-neutral">${all.length}</span></div>
    <div class="card-pad">
      <p class="muted tiny">Gợi ý chung áp dụng cho mọi học viên. Gợi ý riêng gửi từ
        <a href="#/admin/stuck">bảng theo dõi hard stuck</a>.</p>
      <button class="btn btn-block" id="add-hint">Thêm gợi ý chung</button>
    </div>
  </div>`;
}

/* ============================================================= sự kiện == */

function wire({ problem, item, idea, myHints, hintsDoc, solution, bookmarked, config }) {
  const id = problem.id;
  const $ = sel => document.querySelector(sel);

  /* --- trạng thái --- */
  const form = $('#status-form');
  form?.addEventListener('change', async e => {
    if (e.target.name !== 'status') return;
    const to = e.target.value;
    if (to === item.status) return;

    if (to === STATUS.HARD_STUCK) {
      const ok = await askStuckReason(id, item.stuckReason);
      if (!ok) { form.querySelector(`input[value="${item.status}"]`).checked = true; }
      return;
    }
    if (to === STATUS.COMPLETED) {
      const details = await askCompletion(config, item);
      if (details === null) { form.querySelector(`input[value="${item.status}"]`).checked = true; return; }
      await applyStatus(id, to, { extra: details });
      return;
    }
    await applyStatus(id, to);
  });

  // Phím tắt 1–4 đổi trạng thái (UI-08).
  const onKey = e => {
    if (!isMember()) return;
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    const idx = ['1', '2', '3', '4'].indexOf(e.key);
    if (idx < 0) return;
    const radio = form?.querySelector(`input[value="${STATUS_ORDER[idx]}"]`);
    if (radio && !radio.checked) { radio.checked = true; radio.dispatchEvent(new Event('change', { bubbles: true })); }
  };
  document.addEventListener('keydown', onKey);
  // Gỡ listener khi rời trang để không tích luỹ qua các lần điều hướng.
  window.addEventListener('hashchange', () => document.removeEventListener('keydown', onKey), { once: true });

  $('#edit-stuck')?.addEventListener('click', () => askStuckReason(id, item.stuckReason));
  $('#edit-result')?.addEventListener('click', async () => {
    const details = await askCompletion(config, item);
    if (details === null) return;
    await patchProgress(id, details);
    toast('Đã cập nhật.', 'ok');
    reload();
  });

  /* --- ghim --- */
  $('#bookmark')?.addEventListener('click', async () => {
    try {
      const now = await toggleBookmark(id);
      toast(now ? 'Đã ghim bài.' : 'Đã bỏ ghim.', 'ok');
      reload();
    } catch (err) { toast(err.message, 'err'); }
  });

  /* --- ý tưởng --- */
  $('#write-idea')?.addEventListener('click', () => openIdeaEditor(id, idea));
  $('#view-idea')?.addEventListener('click', () => {
    modal({
      title: `Ý tưởng · phiên bản ${idea.version ?? 1}`,
      size: 'modal-lg',
      body: `<div class="md">${renderMarkdown(idea.contentMd)}</div>`,
      actions: [{ label: 'Đóng', onClick: ({ close }) => close() }],
    });
  });
  $('#idea-history')?.addEventListener('click', () => {
    modal({
      title: 'Lịch sử ý tưởng',
      size: 'modal-lg',
      body: (idea.history || []).map(h => `
        <div style="margin-bottom:1.5rem">
          <div class="row-tight" style="margin-bottom:.4rem">
            <span class="badge badge-neutral">phiên bản ${escapeHtml(h.version)}</span>
            <span class="tiny faint">${escapeHtml(formatDateTime(h.submittedAt))}</span>
          </div>
          ${h.review?.commentMd
            ? `<div class="note note-warn" style="margin-bottom:.5rem">${escapeHtml(h.review.commentMd)}</div>` : ''}
          <div class="md">${renderMarkdown(h.contentMd)}</div>
        </div>`).join('<hr>'),
      actions: [{ label: 'Đóng', onClick: ({ close }) => close() }],
    });
  });

  /* --- gợi ý --- */
  for (const el of document.querySelectorAll('[data-hint-md]')) {
    const h = myHints.find(x => x.id === el.dataset.hintMd);
    if (h) mountMarkdown(el, h.contentMd);
  }

  for (const btn of document.querySelectorAll('[data-reveal]')) {
    btn.addEventListener('click', async () => {
      const level = Number(btn.dataset.level);
      // FR-HINT-04: mở cấp cao hơn cần xác nhận có cảnh báo.
      if (level >= 2) {
        const ok = await confirmDialog({
          title: `Mở ${hintLevelLabel(level)}?`,
          message: `<p>Gợi ý cấp ${level} tiết lộ nhiều hơn về hướng giải.
            Lượt mở này được ghi nhận và ảnh hưởng tới thống kê tự lực của bạn.</p>
            <p class="muted small">Hãy thử tự nghĩ thêm một chút trước khi mở nhé.</p>`,
          confirmLabel: 'Vẫn mở',
        });
        if (!ok) return;
      }
      try {
        await revealHint(id, btn.dataset.reveal);
        toast('Đã mở gợi ý.', 'ok');
        reload();
      } catch (err) { toast(err.message, 'err'); }
    });
  }

  for (const btn of document.querySelectorAll('[data-rate]')) {
    btn.addEventListener('click', async () => {
      try {
        await rateHint(id, btn.dataset.rate, btn.dataset.helpful === '1');
        toast('Cảm ơn phản hồi của bạn.', 'ok');
        reload();
      } catch (err) { toast(err.message, 'err'); }
    });
  }

  /* --- lời giải --- */
  $('#open-solution')?.addEventListener('click', async () => {
    // FR-SOL-07: cảnh báo trước khi mở.
    const ok = await confirmDialog({
      title: 'Xem lời giải?',
      message: `<p>Lượt xem này sẽ được ghi nhận và ảnh hưởng đến thống kê tự lực của bạn.</p>`,
      confirmLabel: 'Xem lời giải',
    });
    if (!ok) return;
    await markSolutionViewed(id);
    showSolution(solution.solution, problem);
  });

  $('#request-solution')?.addEventListener('click', async () => {
    const values = await formDialog({
      title: 'Yêu cầu xem lời giải',
      intro: 'Quản trị viên sẽ thấy yêu cầu này trong hàng chờ duyệt.',
      fields: [{ name: 'messageMd', label: 'Lý do (tuỳ chọn)', type: 'textarea', rows: 3,
                 placeholder: 'vd: Em muốn đối chiếu cách làm của mình với lời giải chuẩn.' }],
      submitLabel: 'Gửi yêu cầu',
    });
    if (!values) return;
    try {
      await requestSolutionAccess(id, values.messageMd);
      toast('Đã gửi yêu cầu.', 'ok');
      reload();
    } catch (err) { toast(err.message, 'err'); }
  });

  /* --- admin --- */
  $('#add-hint')?.addEventListener('click', async () => {
    const values = await formDialog({
      title: 'Thêm gợi ý chung',
      intro: 'Gợi ý chung hiển thị cho mọi học viên, theo đúng thứ tự cấp độ.',
      fields: [
        { name: 'level', label: 'Cấp độ', type: 'select', value: '1',
          options: [
            { value: '1', label: 'Cấp 1 — Định hướng chung' },
            { value: '2', label: 'Cấp 2 — Gợi ý thuật toán' },
            { value: '3', label: 'Cấp 3 — Gần như lời giải' },
          ] },
        { name: 'contentMd', label: 'Nội dung (Markdown)', type: 'textarea', rows: 6, required: true },
      ],
      validate: v => !v.contentMd.trim() ? 'Nội dung không được để trống.' : null,
      submitLabel: 'Thêm gợi ý',
    });
    if (!values) return;
    try {
      await createHint(id, { level: Number(values.level), contentMd: values.contentMd });
      toast('Đã thêm gợi ý chung.', 'ok');
      reload();
    } catch (err) { toast(err.message, 'err'); }
  });

  $('#admin-solution')?.addEventListener('click', () => openSolutionEditor(problem));
}

/* ========================================================= hộp thoại == */

async function applyStatus(problemId, to, opts = {}) {
  try {
    await setProblemStatus(problemId, to, opts);
    toast(`Đã chuyển sang "${STATUS_META[to].label}".`, 'ok');
    reload();
  } catch (err) {
    toast(err.message, 'err');
    reload();
  }
}

/** FR-STAT-03: bắt buộc mô tả điểm vướng ≥ 20 ký tự. */
async function askStuckReason(problemId, current = '') {
  const values = await formDialog({
    title: 'Bạn đang vướng ở đâu?',
    intro: `Mô tả càng cụ thể, quản trị viên càng gợi ý đúng chỗ. Tối thiểu ${MIN_STUCK_REASON} ký tự.`,
    fields: [{
      name: 'stuckReason', label: 'Điểm vướng', type: 'textarea', rows: 5, required: true,
      value: current,
      placeholder: 'vd: Em cài BFS nhưng bị TLE ở n=1000, không rõ nên nén trạng thái thế nào.',
    }],
    validate: v => {
      const len = v.stuckReason.trim().length;
      return len < MIN_STUCK_REASON
        ? `Cần ít nhất ${MIN_STUCK_REASON} ký tự (hiện ${len}).` : null;
    },
    submitLabel: 'Báo hard stuck',
  });
  if (!values) return false;

  try {
    await setProblemStatus(problemId, STATUS.HARD_STUCK, { stuckReason: values.stuckReason });
    toast('Đã ghi nhận. Quản trị viên sẽ thấy điểm vướng của bạn.', 'ok');
    reload();
    return true;
  } catch (err) {
    toast(err.message, 'err');
    return false;
  }
}

/** FR-STAT-06: thông tin kèm khi đánh dấu hoàn thành. */
async function askCompletion(config, item) {
  const langs = config?.exam?.languages ?? [];
  return formDialog({
    title: 'Hoàn thành bài',
    intro: 'Các thông tin dưới đây đều tuỳ chọn, nhưng giúp thống kê của bạn chính xác hơn.',
    fields: [
      { name: 'selfScore', label: 'Điểm tự chấm', type: 'number',
        value: item.selfScore ?? '', hint: 'Theo thang điểm của slot, ví dụ 0–300.' },
      { name: 'language', label: 'Ngôn ngữ đã dùng', type: 'select',
        value: item.language ?? '', options: ['', ...langs] },
      { name: 'timeSpentMinutes', label: 'Tổng thời gian (phút)', type: 'number',
        value: item.timeSpentMinutes || '', hint: 'Hệ thống đã tự đo, bạn có thể chỉnh lại.' },
      { name: 'perceivedDifficulty', label: 'Độ khó cảm nhận', type: 'select',
        value: String(item.perceivedDifficulty ?? ''),
        options: [
          { value: '', label: '—' },
          { value: '1', label: '1 — Rất dễ' }, { value: '2', label: '2 — Dễ' },
          { value: '3', label: '3 — Vừa' }, { value: '4', label: '4 — Khó' },
          { value: '5', label: '5 — Rất khó' },
        ] },
      { name: 'codeUrl', label: 'Link code (gist/repo)', type: 'url', value: item.codeUrl ?? '' },
    ],
    submitLabel: 'Đánh dấu hoàn thành',
  }).then(v => v && {
    selfScore: v.selfScore,
    language: v.language || null,
    timeSpentMinutes: v.timeSpentMinutes ?? 0,
    perceivedDifficulty: v.perceivedDifficulty ? Number(v.perceivedDifficulty) : null,
    codeUrl: v.codeUrl,
  });
}

function openIdeaEditor(problemId, idea) {
  const isResubmit = idea?.status === IDEA_STATUS.NEEDS_REVISION;
  const template = `## Hướng tiếp cận\n\n\n## Độ phức tạp\n- Thời gian: \n- Bộ nhớ: \n\n## Trường hợp biên\n- `;

  modal({
    title: isResubmit ? 'Sửa & nộp lại ý tưởng' : 'Ý tưởng giải',
    size: 'modal-lg',
    body: `
      ${isResubmit ? `<div class="note note-warn" style="margin-bottom:1rem">
        Nộp lại sẽ tạo phiên bản mới; phiên bản cũ vẫn được lưu lại.</div>` : ''}
      <div class="field">
        <label for="idea-md">Nội dung (Markdown)</label>
        <textarea id="idea-md" rows="14" class="mono">${escapeHtml(idea?.contentMd || template)}</textarea>
        <div class="hint">Trình bày hướng tiếp cận, độ phức tạp và các trường hợp biên bạn đã nghĩ tới.</div>
      </div>
      <div class="field-error" id="idea-err" hidden></div>`,
    actions: [
      { label: 'Huỷ', onClick: ({ close }) => close() },
      {
        label: 'Lưu nháp',
        onClick: async ({ el, close }) => {
          try {
            await saveIdea(problemId, el.querySelector('#idea-md').value, { submit: false });
            toast('Đã lưu nháp.', 'ok');
            close(); reload();
          } catch (err) { showErr(el, err); }
        },
      },
      {
        label: isResubmit ? 'Nộp lại' : 'Nộp cho quản trị viên', variant: 'primary',
        onClick: async ({ el, close }) => {
          const text = el.querySelector('#idea-md').value;
          if (!text.trim()) return showErr(el, new Error('Nội dung không được để trống.'));
          try {
            await saveIdea(problemId, text, { submit: true });
            toast('Đã nộp ý tưởng. Chờ quản trị viên duyệt.', 'ok');
            close(); reload();
          } catch (err) { showErr(el, err); }
        },
      },
    ],
  });
}

function showErr(el, err) {
  const box = el.querySelector('#idea-err') ?? el.querySelector('.field-error');
  if (box) { box.textContent = err.message; box.hidden = false; }
  else toast(err.message, 'err');
}

function showSolution(sol, problem) {
  if (!sol) {
    toast('Không đọc được nội dung lời giải.', 'err');
    return;
  }
  const codeBlocks = (sol.referenceCode || []).map(c => `
    <h3>${escapeHtml(c.language)}</h3>
    <pre class="md"><code>${escapeHtml(c.code)}</code></pre>`).join('');

  modal({
    title: `Lời giải · ${problem.title}`,
    size: 'modal-lg',
    body: `
      <div class="md">${renderMarkdown(sol.approachMd || '')}</div>
      ${sol.complexity ? `<p class="small"><strong>Độ phức tạp:</strong>
        thời gian ${escapeHtml(sol.complexity.time ?? '—')},
        bộ nhớ ${escapeHtml(sol.complexity.space ?? '—')}</p>` : ''}
      ${codeBlocks ? `<hr><h3 style="margin-top:0">Code tham khảo</h3>${codeBlocks}` : ''}
      ${sol.pitfallsMd ? `<hr><h3>Lỗi thường gặp</h3><div class="md">${renderMarkdown(sol.pitfallsMd)}</div>` : ''}`,
    actions: [{ label: 'Đóng', onClick: ({ close }) => close() }],
  });
}

/** FR-SOL-01: admin soạn lời giải. */
async function openSolutionEditor(problem) {
  const raw = await getSolutionRaw(problem.id);
  const cur = raw ? decodeSolution(raw.contentB64) : null;

  modal({
    title: `Soạn lời giải · ${problem.title}`,
    size: 'modal-lg',
    body: `
      <div class="note note-info" style="margin-bottom:1rem">
        Lời giải lưu dạng base64 trong repo — chỉ để học viên không vô tình thấy đáp án
        khi duyệt repo. <strong>Đây không phải mã hoá.</strong>
      </div>
      <div class="field">
        <label for="sol-approach">Ý tưởng chính (Markdown)</label>
        <textarea id="sol-approach" rows="8" class="mono">${escapeHtml(cur?.approachMd ?? '')}</textarea>
      </div>
      <div class="grid-2">
        <div class="field">
          <label for="sol-time">Độ phức tạp thời gian</label>
          <input type="text" id="sol-time" class="mono" value="${escapeHtml(cur?.complexity?.time ?? '')}" placeholder="O(n log n)">
        </div>
        <div class="field">
          <label for="sol-space">Độ phức tạp bộ nhớ</label>
          <input type="text" id="sol-space" class="mono" value="${escapeHtml(cur?.complexity?.space ?? '')}" placeholder="O(n)">
        </div>
      </div>
      <div class="field">
        <label for="sol-lang">Ngôn ngữ của code mẫu</label>
        <input type="text" id="sol-lang" value="${escapeHtml(cur?.referenceCode?.[0]?.language ?? 'Python')}">
      </div>
      <div class="field">
        <label for="sol-code">Code tham khảo</label>
        <textarea id="sol-code" rows="12" class="mono">${escapeHtml(cur?.referenceCode?.[0]?.code ?? '')}</textarea>
      </div>
      <div class="field">
        <label for="sol-pitfalls">Lỗi thường gặp (Markdown)</label>
        <textarea id="sol-pitfalls" rows="4" class="mono">${escapeHtml(cur?.pitfallsMd ?? '')}</textarea>
      </div>
      <div class="field-error" id="sol-err" hidden></div>`,
    actions: [
      { label: 'Huỷ', onClick: ({ close }) => close() },
      {
        label: 'Lưu lời giải', variant: 'primary',
        onClick: async ({ el, close }) => {
          const q = s => el.querySelector(s).value;
          try {
            await saveSolution(problem.id, {
              approachMd: q('#sol-approach'),
              complexity: { time: q('#sol-time'), space: q('#sol-space') },
              referenceCode: q('#sol-code').trim()
                ? [{ language: q('#sol-lang') || 'Python', code: q('#sol-code') }] : [],
              pitfallsMd: q('#sol-pitfalls'),
            });
            toast('Đã lưu lời giải.', 'ok');
            close(); reload();
          } catch (err) { showErr(el, err); }
        },
      },
    ],
  });
}

/**
 * Cấu hình hệ thống, sao lưu/khôi phục, và tình trạng hệ thống
 * (FR-ADMIN-01/04/05).
 */

import { setMain, pageShell, globalBanners } from '../../ui/layout.js';
import { loadingBlock, toast, confirmDialog, modal } from '../../ui/components.js';
import { adminNav } from './_nav.js';
import {
  escapeHtml, downloadFile, pickFile, todayKey, timeAgo, formatDateTime, deepClone,
} from '../../core/util.js';
import { store, P } from '../../core/store.js';
import { gh, session } from '../../core/auth.js';
import {
  getConfig, saveConfig, getUsers, listProblems, getProblem, activeUsers,
  getProgress, getIdeas, getGrants, getExams, getPersonal, getHints, getSolutionRaw,
} from '../../domain/service.js';
import { DEFAULT_SLOTS } from '../../domain/constants.js';
import { reload } from '../../core/router.js';

export async function render() {
  setMain(pageShell(loadingBlock()));

  const config = await getConfig();
  const slots = config?.exam?.slots ?? DEFAULT_SLOTS;
  const total = slots.reduce((a, s) => a + (s.points || 0), 0);
  const thresholds = config?.exam?.gradeThresholds ?? [];
  const f = config?.features ?? {};

  setMain(pageShell(`
    ${globalBanners()}
    ${adminNav('/admin/settings')}

    <h1>Cấu hình</h1>

    <div class="card" style="margin-bottom:1.25rem">
      <div class="card-head"><h2>Kỳ thi</h2></div>
      <div class="card-pad">
        <div class="grid-2">
          <div class="field">
            <label for="cf-duration">Thời lượng thi thử (phút)</label>
            <input type="number" id="cf-duration" value="${escapeHtml(config?.exam?.durationMinutes ?? 120)}" min="1">
            <div class="hint">Kỳ thi PCCP thật kéo dài 120 phút.</div>
          </div>
          <div class="field">
            <label>Tổng điểm</label>
            <input type="text" value="${total}" disabled>
            <div class="hint">Tính tự động từ điểm của 4 slot.</div>
          </div>
        </div>

        <fieldset>
          <legend>Điểm từng slot</legend>
          <div class="grid-4">
            ${slots.map(s => `
              <div class="field" style="margin-bottom:0">
                <label for="cf-slot-${escapeHtml(s.slot)}">${escapeHtml(s.slot)} (Level ${escapeHtml(s.level)})</label>
                <input type="number" id="cf-slot-${escapeHtml(s.slot)}" data-slot="${escapeHtml(s.slot)}"
                       value="${escapeHtml(s.points)}" min="0">
              </div>`).join('')}
          </div>
        </fieldset>

        <fieldset>
          <legend>Ngưỡng quy đổi hạng</legend>
          <div class="note note-warn" style="margin-bottom:.75rem">
            Trang giới thiệu PCCP <strong>không công bố</strong> ngưỡng điểm cho từng hạng.
            Hãy tự nhập theo thông báo chính thức. Để trống thì hệ thống chỉ hiện điểm thô,
            không quy đổi hạng.
          </div>
          <div class="grid-4">
            ${thresholds.map(g => `
              <div class="field" style="margin-bottom:0">
                <label for="cf-grade-${escapeHtml(g.grade)}">${escapeHtml(g.grade)} từ</label>
                <input type="number" id="cf-grade-${escapeHtml(g.grade)}" data-grade="${escapeHtml(g.grade)}"
                       value="${g.minScore ?? ''}" min="0" max="${total}" placeholder="chưa đặt">
              </div>`).join('')}
          </div>
        </fieldset>
      </div>
    </div>

    <div class="card" style="margin-bottom:1.25rem">
      <div class="card-head"><h2>Tính năng</h2></div>
      <div class="card-pad">
        ${toggle('leaderboardEnabled', 'Bật bảng xếp hạng nhóm', f.leaderboardEnabled,
          'Hiển thị bảng so sánh tiến độ giữa các thành viên.')}
        ${toggle('autoGrantOnApprovedIdea', 'Tự cấp quyền xem lời giải', f.autoGrantOnApprovedIdea,
          'Khi học viên đã hoàn thành bài VÀ ý tưởng được duyệt, tự động mở lời giải mà không cần thao tác thủ công.')}
        ${toggle('publicApprovedIdeas', 'Công khai ý tưởng đã duyệt', f.publicApprovedIdeas,
          'Cho phép học viên khác đọc ý tưởng đã được duyệt để học hỏi.')}
        <div class="field" style="margin-top:1rem">
          <label for="cf-stuck-hours">Cảnh báo hard stuck sau (giờ)</label>
          <input type="number" id="cf-stuck-hours" value="${escapeHtml(f.hardStuckAlertHours ?? 48)}" min="1" style="max-width:12rem">
          <div class="hint">Bài vướng quá lâu mà chưa có gợi ý sẽ được tô đỏ trong bảng theo dõi.</div>
        </div>
      </div>
    </div>

    <div class="row" style="margin-bottom:2rem">
      <button class="btn btn-primary" id="save">Lưu cấu hình</button>
      <span class="spacer"></span>
      <span class="tiny faint">
        ${config?.updatedAt ? `Cập nhật lần cuối ${escapeHtml(timeAgo(config.updatedAt))}` : ''}
      </span>
    </div>

    ${systemStatusCard()}

    <div class="card" style="margin-top:1.25rem">
      <div class="card-head"><h2>Sao lưu &amp; khôi phục</h2></div>
      <div class="card-pad">
        <p class="muted small">
          Lịch sử Git đã là bản sao lưu đầy đủ, nhưng file JSON gộp tiện cho việc
          lưu ngoài hoặc chuyển sang repo khác.
        </p>
        <div class="row">
          <button class="btn" id="backup">Tải bản sao lưu đầy đủ</button>
          <button class="btn btn-ghost" id="restore">Khôi phục từ file</button>
        </div>
      </div>
    </div>
  `));

  wire(config, slots, thresholds);
}

function toggle(name, label, checked, hint) {
  return `<div class="field">
    <label style="display:flex;gap:.5rem;align-items:flex-start;font-weight:500;cursor:pointer">
      <input type="checkbox" data-feature="${escapeHtml(name)}"${checked ? ' checked' : ''} style="width:auto;margin-top:.25rem">
      <span>
        <span class="strong">${escapeHtml(label)}</span>
        <span class="hint" style="display:block;margin-top:.1rem">${escapeHtml(hint)}</span>
      </span>
    </label>
  </div>`;
}

/* --------------------------------------------------- tình trạng hệ thống -- */

function systemStatusCard() {
  const rate = gh?.rateLimit ?? {};
  const rows = [
    ['Repository', gh ? `${gh.owner}/${gh.repo}` : '—'],
    ['Nhánh', gh?.branch ?? '—'],
    ['Tài khoản', session.githubLogin ?? '—'],
    ['Quyền ghi', session.canWrite ? 'Có' : 'Không'],
    ['Quota API còn lại', rate.remaining != null ? `${rate.remaining} / ${rate.limit ?? '?'}` : 'chưa rõ'],
    ['Quota khôi phục lúc', rate.resetAt ? formatDateTime(rate.resetAt) : '—'],
    ['Đồng bộ gần nhất', store.lastSyncAt ? `${formatDateTime(store.lastSyncAt)} (${timeAgo(store.lastSyncAt)})` : 'chưa có'],
    ['Thay đổi đang chờ', String(store.pendingCount)],
    ['Lỗi gần nhất', store.lastError ? store.lastError.message : 'không có'],
  ];
  return `<div class="card">
    <div class="card-head"><h2>Tình trạng hệ thống</h2></div>
    <div class="table-wrap"><table class="tbl">
      <tbody>${rows.map(([k, v]) =>
        `<tr><th style="text-transform:none;width:14rem">${escapeHtml(k)}</th>
             <td class="mono tiny">${escapeHtml(v)}</td></tr>`).join('')}</tbody>
    </table></div>
  </div>`;
}

/* ---------------------------------------------------------------- sự kiện -- */

function wire(config, slots, thresholds) {
  document.getElementById('save').addEventListener('click', async () => {
    const $ = s => document.querySelector(s);

    const nextSlots = slots.map(s => ({
      ...s,
      points: Number($(`#cf-slot-${s.slot}`).value) || 0,
    }));
    const totalPoints = nextSlots.reduce((a, s) => a + s.points, 0);

    const nextThresholds = thresholds.map(g => {
      const raw = $(`#cf-grade-${g.grade}`).value;
      return { ...g, minScore: raw === '' ? null : Number(raw) };
    });

    // Ngưỡng phải giảm dần theo thứ tự hạng, nếu không quy đổi sẽ sai.
    const filled = nextThresholds.filter(g => g.minScore != null);
    for (let i = 1; i < filled.length; i++) {
      if (filled[i].minScore >= filled[i - 1].minScore) {
        toast(`Ngưỡng ${filled[i].grade} phải nhỏ hơn ngưỡng ${filled[i - 1].grade}.`, 'err', 6000);
        return;
      }
    }

    const features = {};
    for (const el of document.querySelectorAll('[data-feature]')) {
      features[el.dataset.feature] = el.checked;
    }
    features.hardStuckAlertHours = Number($('#cf-stuck-hours').value) || 48;

    try {
      await saveConfig({
        exam: {
          ...config.exam,
          durationMinutes: Number($('#cf-duration').value) || 120,
          slots: nextSlots,
          totalPoints,
          gradeThresholds: nextThresholds,
        },
        features,
      });
      toast('Đã lưu cấu hình.', 'ok');
      reload();
    } catch (err) { toast(err.message, 'err'); }
  });

  document.getElementById('backup').addEventListener('click', doBackup);
  document.getElementById('restore').addEventListener('click', doRestore);
}

/* -------------------------------------------------------- sao lưu / phục -- */

async function doBackup() {
  toast('Đang thu thập dữ liệu…', 'info');
  try {
    const [config, usersDoc, index] = await Promise.all([getConfig(), getUsers(), listProblems({ includeArchived: true })]);
    const members = activeUsers(usersDoc);

    const problems = [];
    const solutions = [];
    const hints = [];
    for (const meta of index) {
      const p = await getProblem(meta.id);
      if (p) problems.push(p);
      const sol = await getSolutionRaw(meta.id).catch(() => null);
      if (sol) solutions.push(sol);
      const h = await getHints(meta.id).catch(() => null);
      if (h?.hints?.length) hints.push(h);
    }

    const perUser = {};
    for (const u of members) {
      perUser[u.id] = {
        progress: await getProgress(u.id).catch(() => null),
        ideas: await getIdeas(u.id).catch(() => null),
        grants: await getGrants(u.id).catch(() => null),
        exams: await getExams(u.id).catch(() => null),
        personal: await getPersonal(u.id).catch(() => null),
      };
    }

    const backup = {
      exportedAt: new Date().toISOString(),
      exportedBy: session.githubLogin,
      repo: gh ? `${gh.owner}/${gh.repo}` : null,
      config, users: usersDoc, problems, solutions, hints, perUser,
    };

    downloadFile(`pccp-backup-${todayKey()}.json`, JSON.stringify(backup, null, 2));
    toast(`Đã sao lưu ${problems.length} bài, ${members.length} thành viên.`, 'ok', 6000);
  } catch (err) {
    toast(`Sao lưu thất bại: ${err.message}`, 'err', 6000);
  }
}

async function doRestore() {
  const file = await pickFile('.json');
  if (!file) return;

  let backup;
  try {
    backup = JSON.parse(file.text);
    if (!backup.config || !backup.users) throw new Error('Thiếu phần config hoặc users.');
  } catch (err) {
    toast(`File sao lưu không hợp lệ: ${err.message}`, 'err', 6000);
    return;
  }

  const ok = await confirmDialog({
    title: 'Khôi phục dữ liệu?',
    message: `
      <p>Bản sao lưu tạo lúc <strong>${escapeHtml(formatDateTime(backup.exportedAt))}</strong>
      từ repo <code>${escapeHtml(backup.repo ?? '—')}</code>.</p>
      <div class="note note-danger">
        <strong>Thao tác này ghi đè dữ liệu hiện tại</strong> bằng nội dung trong file:
        cấu hình, danh bạ thành viên, ${(backup.problems || []).length} bài tập,
        và tiến độ của ${Object.keys(backup.perUser || {}).length} thành viên.
      </div>
      <p class="muted small">Lịch sử Git vẫn giữ bản cũ nên bạn có thể quay lại nếu cần.</p>`,
    confirmLabel: 'Ghi đè & khôi phục', danger: true,
  });
  if (!ok) return;

  try {
    await store.save(P.config(), backup.config, 'data(config): khôi phục từ bản sao lưu');
    await store.save(P.users(), backup.users, 'data(user): khôi phục từ bản sao lưu');

    for (const p of backup.problems || []) {
      await store.save(P.problem(p.id), p, `data(problem): khôi phục ${p.id}`);
    }
    if ((backup.problems || []).length) {
      await store.save(P.problemIndex(), {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        problems: backup.problems.map(p => ({
          id: p.id, title: p.title, level: p.level, tags: p.tags ?? [],
          estimatedMinutes: p.estimatedMinutes ?? null,
          archived: Boolean(p.archived), updatedAt: p.updatedAt,
        })),
      }, 'data(problem): khôi phục index');
    }
    for (const s of backup.solutions || []) {
      await store.save(P.solution(s.problemId), s, `data(solution): khôi phục ${s.problemId}`);
    }
    for (const h of backup.hints || []) {
      await store.save(P.hints(h.problemId), h, `data(hint): khôi phục ${h.problemId}`);
    }
    for (const [uid, blob] of Object.entries(backup.perUser || {})) {
      if (blob.progress) await store.save(P.progress(uid), blob.progress, `data(progress): khôi phục ${uid}`);
      if (blob.ideas)    await store.save(P.ideas(uid), blob.ideas, `data(idea): khôi phục ${uid}`);
      if (blob.grants)   await store.save(P.grants(uid), blob.grants, `data(grant): khôi phục ${uid}`);
      if (blob.exams)    await store.save(P.exams(uid), blob.exams, `data(exam): khôi phục ${uid}`);
      if (blob.personal) await store.save(P.personal(uid), blob.personal, `data(personal): khôi phục ${uid}`);
    }

    toast('Đang đẩy dữ liệu lên GitHub…', 'info');
    await store.flushAll();
    store.audit(session.user?.id, 'DATA_IMPORT', file.name);
    toast('Đã khôi phục xong. Tải lại trang để thấy dữ liệu mới.', 'ok', 8000);
  } catch (err) {
    toast(`Khôi phục thất bại: ${err.message}`, 'err', 8000);
  }
}

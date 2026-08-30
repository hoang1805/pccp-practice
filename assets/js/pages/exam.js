/**
 * Chế độ thi thử — 4 bài, đếm ngược 120 phút, tự chấm theo thang 1000 (FR-EXAM-*).
 *
 * Đề bài được hiển thị ngay trong trang này thay vì điều hướng sang trang chi tiết,
 * nhờ đó gợi ý và lời giải chắc chắn không lộ ra trong lúc thi (FR-EXAM-02).
 */

import { setMain, pageShell, globalBanners } from '../ui/layout.js';
import { loadingBlock, emptyState, toast, confirmDialog, modal } from '../ui/components.js';
import { mountMarkdown } from '../ui/markdown.js';
import { escapeHtml, formatClock, todayKey, formatDateKey, nowIso } from '../core/util.js';
import {
  getConfig, getTodaySet, getPersonalSet, getProblem, getProblemMap, saveExamSession,
} from '../domain/service.js';
import { gradeForScore, slotSpecs } from '../domain/rules.js';
import { navigate, reload } from '../core/router.js';

const K_SESSION = 'pccp.exam.active';

export async function render() {
  setMain(pageShell(loadingBlock()));

  const config = await getConfig();
  const active = loadActive();

  if (active) return renderRunning(config, active);
  return renderPicker(config);
}

/* ============================================================= chọn đề == */

async function renderPicker(config) {
  const today = todayKey();
  const [official, personal, problemMap] = await Promise.all([
    getTodaySet(), getPersonalSet(today), getProblemMap(),
  ]);

  const candidates = [];
  if (official) candidates.push({ key: 'official', set: official, label: 'Bộ đề chính thức hôm nay' });
  if (personal) candidates.push({ key: 'personal', set: personal, label: 'Bộ đề cá nhân hôm nay' });

  const usable = candidates.filter(c => (c.set.slots || []).every(s => s.problemId));
  const partial = candidates.filter(c => !(c.set.slots || []).every(s => s.problemId));

  const duration = config?.exam?.durationMinutes ?? 120;

  setMain(pageShell(`
    ${globalBanners()}
    <h1>Thi thử</h1>
    <p class="muted">
      Mô phỏng kỳ thi PCCP: <strong>4 bài</strong> (1 × Lv.1, 1 × Lv.2, 2 × Lv.3),
      thang điểm <strong>${config?.exam?.totalPoints ?? 1000}</strong>,
      thời lượng <strong>${duration} phút</strong>.
      Trong lúc thi, gợi ý và lời giải sẽ bị ẩn.
    </p>

    ${usable.length ? `
      <div class="stack">
        ${usable.map(c => `
          <div class="card card-pad row">
            <div style="flex:1 1 16rem">
              <h2 style="margin:0 0 .25rem">${escapeHtml(c.set.title || c.label)}</h2>
              <p class="muted small" style="margin:0">${escapeHtml(c.label)} ·
                ${(c.set.slots || []).map(s => escapeHtml(problemMap.get(s.problemId)?.title ?? '?')).join(' · ')}</p>
            </div>
            <span class="spacer"></span>
            <button class="btn btn-primary" data-start="${escapeHtml(c.key)}">Bắt đầu ${duration}′</button>
          </div>`).join('')}
      </div>` : emptyState({
        title: 'Chưa có bộ đề đủ 4 bài',
        message: partial.length
          ? 'Bộ đề hôm nay chưa ghim đủ 4 bài nên chưa thi thử được.'
          : 'Hãy chờ quản trị viên đăng bộ đề, hoặc tự tạo một bộ đề cá nhân đủ 4 bài.',
        actionHtml: `<a class="btn btn-primary" href="#/">Về trang chủ</a>`,
      })}

    <div class="note note-info" style="margin-top:1.25rem">
      Điểm do bạn <strong>tự chấm</strong> sau khi hết giờ — hệ thống không chạy test case.
      Vì vậy kết quả chỉ mang tính tham khảo cho việc luyện tập.
    </div>
  `, { narrow: true }));

  for (const btn of document.querySelectorAll('[data-start]')) {
    btn.addEventListener('click', async () => {
      const c = usable.find(x => x.key === btn.dataset.start);
      if (!c) return;
      const ok = await confirmDialog({
        title: `Bắt đầu thi thử ${duration} phút?`,
        message: `<p>Đồng hồ sẽ chạy ngay khi bạn xác nhận. Gợi ý và lời giải của 4 bài này sẽ bị ẩn cho tới khi kết thúc.</p>
                  <p class="muted small">Bạn có thể nộp sớm bất cứ lúc nào.</p>`,
        confirmLabel: 'Bắt đầu',
      });
      if (!ok) return;
      saveActive({
        setId: c.set.id,
        setTitle: c.set.title || c.label,
        slots: c.set.slots,
        startedAt: nowIso(),
        durationMinutes: duration,
      });
      reload();
    });
  }
}

/* ============================================================ đang thi == */

async function renderRunning(config, active) {
  const problems = await Promise.all(
    (active.slots || []).map(s => s.problemId ? getProblem(s.problemId) : Promise.resolve(null)));

  const tabs = active.slots.map((s, i) => {
    const p = problems[i];
    return `<button class="btn btn-sm" data-tab="${i}">${escapeHtml(s.slot)} · ${escapeHtml(s.points)}đ</button>`;
  }).join('');

  setMain(pageShell(`
    <div class="card card-pad" style="margin-bottom:1rem;position:sticky;top:calc(var(--header-h) + .5rem);z-index:20">
      <div class="row">
        <div>
          <div class="tiny faint">Còn lại</div>
          <div class="exam-timer" id="timer">--:--</div>
        </div>
        <div style="flex:1 1 12rem">
          <div class="strong">${escapeHtml(active.setTitle)}</div>
          <div class="tiny faint">Bắt đầu lúc ${escapeHtml(new Date(active.startedAt).toLocaleTimeString('vi-VN'))}</div>
        </div>
        <span class="spacer"></span>
        <button class="btn btn-primary" id="finish">Nộp bài &amp; tự chấm</button>
        <button class="btn btn-ghost" id="abandon">Huỷ phiên</button>
      </div>
    </div>

    <div class="row" style="margin-bottom:1rem" id="tabs">${tabs}</div>

    <div id="problem-host"></div>
  `));

  let current = 0;
  const host = document.getElementById('problem-host');

  function drawProblem(i) {
    current = i;
    const slot = active.slots[i];
    const p = problems[i];
    for (const b of document.querySelectorAll('[data-tab]')) {
      b.classList.toggle('btn-primary', Number(b.dataset.tab) === i);
    }
    if (!p) {
      host.innerHTML = `<div class="note note-danger">Không tải được bài của slot ${escapeHtml(slot.slot)}.</div>`;
      return;
    }
    host.innerHTML = `
      <div class="card">
        <div class="card-head">
          <span class="badge badge-neutral">${escapeHtml(slot.slot)} · Level ${escapeHtml(p.level)} · ${escapeHtml(slot.points)} điểm</span>
          <h2 style="margin:0">${escapeHtml(p.title)}</h2>
        </div>
        <div class="card-pad">
          <div class="md" id="exam-statement"></div>
          ${p.constraintsMd ? `<h3>Ràng buộc</h3><div class="md" id="exam-constraints"></div>` : ''}
          ${(p.samples || []).length ? `<h3>Ví dụ</h3>${(p.samples || []).map((s, k) => `
            <div class="grid-2" style="margin-bottom:.75rem">
              <div><div class="tiny faint">Input ${k + 1}</div>
                <pre class="md"><code>${escapeHtml(s.input ?? '')}</code></pre></div>
              <div><div class="tiny faint">Output ${k + 1}</div>
                <pre class="md"><code>${escapeHtml(s.output ?? '')}</code></pre></div>
            </div>`).join('')}` : ''}
        </div>
      </div>`;
    mountMarkdown(document.getElementById('exam-statement'), p.statementMd);
    if (p.constraintsMd) mountMarkdown(document.getElementById('exam-constraints'), p.constraintsMd);
  }

  for (const b of document.querySelectorAll('[data-tab]')) {
    b.addEventListener('click', () => drawProblem(Number(b.dataset.tab)));
  }
  drawProblem(0);

  /* --- đồng hồ --- */
  const endsAt = new Date(active.startedAt).getTime() + active.durationMinutes * 60_000;
  const timerEl = document.getElementById('timer');
  let warned15 = false;
  let finished = false;

  const tick = () => {
    const left = Math.round((endsAt - Date.now()) / 1000);
    timerEl.textContent = formatClock(left);
    timerEl.classList.toggle('warn', left <= 900 && left > 300);
    timerEl.classList.toggle('danger', left <= 300);

    if (left <= 900 && !warned15) {          // FR-EXAM-07
      warned15 = true;
      toast('Còn 15 phút.', 'warn', 6000);
    }
    if (left <= 0 && !finished) {
      finished = true;
      clearInterval(timerId);
      toast('Hết giờ!', 'warn', 8000);
      openScoring(config, active, { timedOut: true });
    }
  };
  const timerId = setInterval(tick, 1000);
  tick();
  window.addEventListener('hashchange', () => clearInterval(timerId), { once: true });

  document.getElementById('finish').addEventListener('click', () => {
    finished = true;
    clearInterval(timerId);
    openScoring(config, active, { timedOut: false });
  });

  document.getElementById('abandon').addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: 'Huỷ phiên thi?',
      message: 'Phiên này sẽ bị bỏ và không được lưu vào lịch sử.',
      confirmLabel: 'Huỷ phiên', danger: true,
    });
    if (!ok) return;
    clearInterval(timerId);
    clearActive();
    reload();
  });
}

/* ============================================================== tự chấm == */

function openScoring(config, active, { timedOut }) {
  const maxTotal = config?.exam?.totalPoints ?? 1000;

  const fields = active.slots.map(s => `
    <div class="field">
      <label for="sc-${escapeHtml(s.slot)}">Slot ${escapeHtml(s.slot)} — tối đa ${escapeHtml(s.points)} điểm</label>
      <div class="row">
        <input type="number" id="sc-${escapeHtml(s.slot)}" min="0" max="${escapeHtml(s.points)}" value="0" style="flex:0 0 8rem">
        <button class="btn btn-sm" data-quick="${escapeHtml(s.slot)}" data-val="${escapeHtml(s.points)}">Đúng hết</button>
        <button class="btn btn-sm" data-quick="${escapeHtml(s.slot)}" data-val="${Math.round(s.points / 2)}">Một nửa</button>
        <button class="btn btn-sm" data-quick="${escapeHtml(s.slot)}" data-val="0">Không được</button>
      </div>
    </div>`).join('');

  modal({
    title: timedOut ? 'Hết giờ — tự chấm điểm' : 'Nộp bài — tự chấm điểm',
    size: 'modal-lg',
    dismissible: false,
    body: `
      <div class="note note-info" style="margin-bottom:1rem">
        Chấm theo mức độ vượt qua test case của bạn. Đây là <strong>tự đánh giá</strong>,
        chỉ dùng để theo dõi tiến bộ.
      </div>
      ${fields}
      <div class="field">
        <label for="sc-note">Ghi chú</label>
        <textarea id="sc-note" rows="2" placeholder="vd: Hết giờ ở bài L3B."></textarea>
      </div>
      <div class="card card-pad center">
        <div class="tiny faint">Tổng điểm</div>
        <div class="stat-val" id="sc-total">0 / ${maxTotal}</div>
        <div id="sc-grade" class="small muted"></div>
      </div>`,
    actions: [
      {
        label: 'Lưu kết quả', variant: 'primary',
        onClick: async ({ el, close }) => {
          const scores = active.slots.map(s => ({
            slot: s.slot,
            problemId: s.problemId,
            maxPoints: s.points,
            score: clampScore(el.querySelector(`#sc-${s.slot}`).value, s.points),
          }));
          const totalScore = scores.reduce((a, b) => a + b.score, 0);
          try {
            await saveExamSession({
              setId: active.setId,
              startedAt: active.startedAt,
              endedAt: nowIso(),
              durationMinutes: active.durationMinutes,
              scores,
              totalScore,
              grade: gradeForScore(totalScore, config),
              hintsUsed: 0,
              noteMd: el.querySelector('#sc-note').value,
              timedOut,
            });
            clearActive();
            close();
            toast(`Đã lưu kết quả: ${totalScore}/${maxTotal} điểm.`, 'ok', 6000);
            navigate('/me');
          } catch (err) {
            toast(err.message, 'err');
          }
        },
      },
    ],
    onMount: ({ el }) => {
      const recompute = () => {
        let total = 0;
        for (const s of active.slots) {
          total += clampScore(el.querySelector(`#sc-${s.slot}`).value, s.points);
        }
        el.querySelector('#sc-total').textContent = `${total} / ${maxTotal}`;
        const grade = gradeForScore(total, config);
        el.querySelector('#sc-grade').textContent = grade
          ? `Tương đương hạng ${grade}`
          : 'Chưa cấu hình ngưỡng quy đổi hạng';
      };
      for (const inp of el.querySelectorAll('input[type=number]')) {
        inp.addEventListener('input', recompute);
      }
      for (const b of el.querySelectorAll('[data-quick]')) {
        b.addEventListener('click', () => {
          el.querySelector(`#sc-${b.dataset.quick}`).value = b.dataset.val;
          recompute();
        });
      }
      recompute();
    },
  });
}

function clampScore(raw, max) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(max, Math.round(n)));
}

/* ======================================================== phiên đang mở == */

function loadActive() {
  try {
    const raw = sessionStorage.getItem(K_SESSION);
    if (!raw) return null;
    const data = JSON.parse(raw);
    return data?.slots?.length ? data : null;
  } catch { return null; }
}

function saveActive(data) {
  try { sessionStorage.setItem(K_SESSION, JSON.stringify(data)); } catch { /* bỏ qua */ }
}

function clearActive() {
  try { sessionStorage.removeItem(K_SESSION); } catch { /* bỏ qua */ }
}

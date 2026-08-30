/**
 * Quy tắc nghiệp vụ thuần — không chạm DOM, không gọi mạng.
 * Đây là tầng được unit test (SRS NFR-M-04).
 */

import {
  STATUS, IDEA_STATUS, SET_STATUS, DEFAULT_SLOTS, MIN_STUCK_REASON, ROLE,
} from './constants.js';

/* ============================================================ slot/set == */

export function slotSpec(slotKey, config = null) {
  const list = config?.exam?.slots?.length ? config.exam.slots : DEFAULT_SLOTS;
  return list.find(s => s.slot === slotKey) ?? null;
}

export function slotSpecs(config = null) {
  return config?.exam?.slots?.length ? config.exam.slots : DEFAULT_SLOTS;
}

export function totalPoints(config = null) {
  return slotSpecs(config).reduce((sum, s) => sum + (s.points || 0), 0);
}

/**
 * INT-02: level của bài phải khớp level mà slot yêu cầu.
 * @returns {{ok:true}|{ok:false, error:string}}
 */
export function validateSlotAssignment(slotKey, problem, config = null) {
  const spec = slotSpec(slotKey, config);
  if (!spec) return { ok: false, error: `Slot "${slotKey}" không hợp lệ.` };
  if (!problem) return { ok: true }; // slot để trống là hợp lệ (bộ đề nháp)
  if (problem.archived) return { ok: false, error: `Bài "${problem.title}" đã được lưu trữ, không thể ghim.` };
  if (Number(problem.level) !== Number(spec.level)) {
    return { ok: false, error: `Slot ${slotKey} chỉ nhận bài Level ${spec.level}, nhưng "${problem.title}" là Level ${problem.level}.` };
  }
  return { ok: true };
}

/**
 * Kiểm tra toàn bộ bộ đề: level từng slot (INT-02) và không trùng bài (INT-03).
 * @param {Array<{slot:string, problemId:string|null}>} slots
 * @param {Map<string,object>|object} problemsById
 */
export function validateSet(slots, problemsById, config = null) {
  const errors = [];
  const get = id => (problemsById instanceof Map ? problemsById.get(id) : problemsById?.[id]) ?? null;

  for (const s of slots) {
    if (!s.problemId) continue;
    const res = validateSlotAssignment(s.slot, get(s.problemId), config);
    if (!res.ok) errors.push(res.error);
  }

  const seen = new Map();
  for (const s of slots) {
    if (!s.problemId) continue;
    if (seen.has(s.problemId)) {
      const p = get(s.problemId);
      errors.push(`Bài "${p?.title ?? s.problemId}" bị ghim vào cả slot ${seen.get(s.problemId)} và ${s.slot}.`);
    } else {
      seen.set(s.problemId, s.slot);
    }
  }

  return { ok: errors.length === 0, errors };
}

/** Tạo 4 slot rỗng theo cấu hình. */
export function emptySlots(config = null) {
  return slotSpecs(config).map(s => ({ slot: s.slot, problemId: null, points: s.points }));
}

/** FR-SET-06: bộ đề thiếu bài vẫn hợp lệ nhưng phải đánh dấu INCOMPLETE. */
export function computeSetStatus(set, { published = true } = {}) {
  const filled = (set?.slots || []).filter(s => s.problemId).length;
  const total = (set?.slots || []).length || slotSpecs().length;
  if (filled === 0) return SET_STATUS.DRAFT;
  if (filled < total) return SET_STATUS.INCOMPLETE;
  return published ? SET_STATUS.PUBLISHED : SET_STATUS.DRAFT;
}

/** FR-SET-09: bộ đề đã lên lịch chỉ hiện khi tới thời điểm publishAt. */
export function isSetVisible(set, now = new Date()) {
  if (!set) return false;
  if (!set.publishAt) return true;
  const t = Date.parse(set.publishAt);
  return Number.isNaN(t) ? true : t <= now.getTime();
}

/* ========================================================== trạng thái == */

/** Máy trạng thái ở SRS §4.5. */
const TRANSITIONS = {
  [STATUS.NOT_STARTED]: [STATUS.IN_PROGRESS, STATUS.COMPLETED],
  [STATUS.IN_PROGRESS]: [STATUS.HARD_STUCK, STATUS.COMPLETED, STATUS.NOT_STARTED],
  [STATUS.HARD_STUCK]:  [STATUS.IN_PROGRESS, STATUS.COMPLETED],
  [STATUS.COMPLETED]:   [STATUS.IN_PROGRESS],
};

export function canTransition(from, to) {
  if (from === to) return true;
  return (TRANSITIONS[from] || []).includes(to);
}

/**
 * INT-05: chuyển sang HARD_STUCK bắt buộc mô tả điểm vướng ≥ 20 ký tự.
 * INT-06: chuyển sang COMPLETED phải có completedAt (do tầng gọi gán).
 */
export function validateStatusChange(from, to, { stuckReason = '' } = {}) {
  if (!Object.values(STATUS).includes(to)) return { ok: false, error: 'Trạng thái không hợp lệ.' };
  if (!canTransition(from, to)) {
    return { ok: false, error: `Không thể chuyển trực tiếp từ "${from}" sang "${to}".` };
  }
  if (to === STATUS.HARD_STUCK) {
    const text = String(stuckReason || '').trim();
    if (text.length < MIN_STUCK_REASON) {
      return { ok: false, error: `Hãy mô tả điểm vướng ít nhất ${MIN_STUCK_REASON} ký tự để giáo viên hỗ trợ được (hiện ${text.length}).` };
    }
  }
  return { ok: true };
}

/** Bản ghi tiến độ mặc định cho một bài chưa từng đụng tới. */
export function emptyProgressItem(problemId) {
  return {
    problemId,
    status: STATUS.NOT_STARTED,
    stuckReason: '',
    stuckSince: null,
    startedAt: null,
    completedAt: null,
    timeSpentMinutes: 0,
    selfScore: null,
    language: null,
    codeUrl: '',
    perceivedDifficulty: null,
    hintsRevealed: [],
    solutionViewedAt: null,
    statusHistory: [],
    updatedAt: null,
  };
}

export function progressOf(progressDoc, problemId) {
  return (progressDoc?.items || []).find(i => i.problemId === problemId) ?? emptyProgressItem(problemId);
}

export function statusOf(progressDoc, problemId) {
  return progressOf(progressDoc, problemId).status;
}

/**
 * Áp dụng một lần đổi trạng thái, trả về bản ghi mới.
 * FR-STAT-04 (lịch sử) và FR-STAT-05 (cộng dồn thời gian) xử lý tại đây.
 */
export function applyStatusChange(item, to, { stuckReason = '', now = new Date(), extra = {} } = {}) {
  const from = item.status;
  const at = now.toISOString();
  const next = { ...item, status: to, updatedAt: at, ...extra };

  // Cộng dồn thời gian đã ở trạng thái IN_PROGRESS.
  if (from === STATUS.IN_PROGRESS && to !== STATUS.IN_PROGRESS && item.startedAt) {
    const mins = Math.max(0, Math.round((now.getTime() - new Date(item.lastResumedAt || item.startedAt).getTime()) / 60000));
    next.timeSpentMinutes = (item.timeSpentMinutes || 0) + mins;
  }

  if (to === STATUS.IN_PROGRESS) {
    next.startedAt = item.startedAt || at;
    next.lastResumedAt = at;
    next.stuckReason = '';
    next.stuckSince = null;
  }

  if (to === STATUS.HARD_STUCK) {
    next.stuckReason = String(stuckReason).trim();
    next.stuckSince = item.status === STATUS.HARD_STUCK ? (item.stuckSince || at) : at;
  }

  if (to === STATUS.COMPLETED) {
    next.completedAt = at;            // INT-06
    next.stuckReason = '';
    next.stuckSince = null;
  } else if (from === STATUS.COMPLETED) {
    next.completedAt = null;          // mở lại để ôn tập
  }

  if (to === STATUS.NOT_STARTED) {
    next.startedAt = null;
    next.lastResumedAt = null;
    next.stuckReason = '';
    next.stuckSince = null;
  }

  if (from !== to) {
    next.statusHistory = [...(item.statusHistory || []), { from, to, at }];
  }
  return next;
}

/* ============================================================== ý tưởng == */

/** Vòng đời ý tưởng ở SRS §4.6. */
const IDEA_TRANSITIONS = {
  [IDEA_STATUS.DRAFT]:          [IDEA_STATUS.PENDING],
  [IDEA_STATUS.PENDING]:        [IDEA_STATUS.APPROVED, IDEA_STATUS.NEEDS_REVISION, IDEA_STATUS.REJECTED],
  [IDEA_STATUS.NEEDS_REVISION]: [IDEA_STATUS.PENDING],
  [IDEA_STATUS.APPROVED]:       [],
  [IDEA_STATUS.REJECTED]:       [],
};

export function canIdeaTransition(from, to) {
  return (IDEA_TRANSITIONS[from] || []).includes(to);
}

/** INT-07: NEEDS_REVISION và REJECTED bắt buộc có nhận xét. */
export function validateIdeaReview(decision, comment) {
  if (![IDEA_STATUS.APPROVED, IDEA_STATUS.NEEDS_REVISION, IDEA_STATUS.REJECTED].includes(decision)) {
    return { ok: false, error: 'Quyết định không hợp lệ.' };
  }
  if (decision !== IDEA_STATUS.APPROVED && !String(comment || '').trim()) {
    return { ok: false, error: 'Bắt buộc nhập nhận xét khi yêu cầu sửa hoặc từ chối.' };
  }
  return { ok: true };
}

export function ideaFor(ideasDoc, problemId) {
  return (ideasDoc?.ideas || []).find(i => i.problemId === problemId) ?? null;
}

/* ================================================================ hint == */

/** FR-HINT-06: chỉ thấy hint chung và hint gửi riêng cho mình. */
export function visibleHints(hintsDoc, viewerUserId, { isAdmin = false } = {}) {
  const all = hintsDoc?.hints || [];
  if (isAdmin) return all;
  return all.filter(h => !h.targetUserId || h.targetUserId === viewerUserId);
}

/**
 * FR-HINT-04: hint phải mở theo thứ tự cấp tăng dần.
 * Trả về cấp thấp nhất chưa mở mà người dùng được phép mở tiếp.
 */
export function nextRevealableLevel(availableHints, revealedIds) {
  const revealed = new Set(revealedIds || []);
  const levels = [...new Set(availableHints.map(h => Number(h.level)))].sort((a, b) => a - b);
  for (const lv of levels) {
    const atLevel = availableHints.filter(h => Number(h.level) === lv);
    if (atLevel.some(h => !revealed.has(h.id))) return lv;
  }
  return null;
}

export function isHintRevealed(progressItem, hintId) {
  return (progressItem?.hintsRevealed || []).some(r => r.hintId === hintId);
}

/** Một hint chỉ mở được khi mọi hint cấp thấp hơn đã mở. */
export function canRevealHint(hint, availableHints, progressItem) {
  const revealedIds = (progressItem?.hintsRevealed || []).map(r => r.hintId);
  if (revealedIds.includes(hint.id)) return true;
  const next = nextRevealableLevel(availableHints, revealedIds);
  return next != null && Number(hint.level) === next;
}

/* ============================================================ lời giải == */

/**
 * FR-SOL-03: lời giải chỉ mở khi **cả hai** điều kiện đúng:
 *   (a) trạng thái bài là COMPLETED
 *   (b) tồn tại grant chưa bị thu hồi
 * Admin luôn xem được.
 */
export function canViewSolution({ progressItem, grantsDoc, problemId, role }) {
  if (role === ROLE.ADMIN) return { allowed: true, reason: 'admin' };

  const completed = progressItem?.status === STATUS.COMPLETED;
  const grant = (grantsDoc?.grants || []).find(g => g.problemId === problemId && !g.revokedAt);

  if (completed && grant) return { allowed: true, reason: 'granted' };
  if (!completed && !grant) return { allowed: false, reason: 'need_both' };
  if (!completed) return { allowed: false, reason: 'need_complete' };
  return { allowed: false, reason: 'need_grant' };
}

export const SOLUTION_REASON_TEXT = {
  need_both:     'Bạn cần hoàn thành bài và được quản trị viên duyệt mới xem được lời giải.',
  need_complete: 'Bạn đã được cấp quyền, nhưng cần đánh dấu hoàn thành bài trước đã.',
  need_grant:    'Bạn đã hoàn thành bài. Hãy gửi yêu cầu để quản trị viên cấp quyền xem lời giải.',
};

/** INT-08: chỉ cấp grant cho user đã hoàn thành bài. */
export function canGrantSolution(progressDoc, problemId) {
  return statusOf(progressDoc, problemId) === STATUS.COMPLETED;
}

/**
 * FR-SOL-08: tự cấp quyền khi đã hoàn thành **và** ý tưởng đã được duyệt.
 * Chỉ chạy khi admin bật cờ cấu hình.
 */
export function shouldAutoGrant(config, progressDoc, ideasDoc, problemId) {
  if (!config?.features?.autoGrantOnApprovedIdea) return false;
  if (statusOf(progressDoc, problemId) !== STATUS.COMPLETED) return false;
  const idea = ideaFor(ideasDoc, problemId);
  return idea?.status === IDEA_STATUS.APPROVED;
}

/* ============================================================== điểm ==== */

/** Điểm đạt được của một bộ đề: cộng điểm slot của những bài đã COMPLETED. */
export function scoreOfSet(set, progressDoc, config = null) {
  let earned = 0, max = 0, done = 0, filled = 0;
  for (const s of set?.slots || []) {
    const spec = slotSpec(s.slot, config);
    const pts = s.points ?? spec?.points ?? 0;
    max += pts;
    if (!s.problemId) continue;
    filled++;
    if (statusOf(progressDoc, s.problemId) === STATUS.COMPLETED) { earned += pts; done++; }
  }
  return { earned, max: max || totalPoints(config), done, filled, total: (set?.slots || []).length };
}

/** FR-EXAM-04: quy đổi tổng điểm sang hạng theo bảng ngưỡng trong config. */
export function gradeForScore(score, config) {
  const table = (config?.exam?.gradeThresholds || [])
    .filter(g => g.minScore != null)
    .sort((a, b) => b.minScore - a.minScore);
  if (!table.length) return null; // chưa nhập ngưỡng → không quy đổi (RISK-10)
  return table.find(g => score >= g.minScore)?.grade ?? null;
}

/* ========================================================= cảnh báo ===== */

/** FR-STAT-09: bài hard stuck quá lâu mà chưa có hint nào gửi cho user. */
export function isStuckTooLong(progressItem, hintsDoc, userId, thresholdHours = 48, now = new Date()) {
  if (progressItem?.status !== STATUS.HARD_STUCK || !progressItem.stuckSince) return false;
  const hours = (now.getTime() - new Date(progressItem.stuckSince).getTime()) / 3600000;
  if (hours < thresholdHours) return false;
  const hasHint = (hintsDoc?.hints || []).some(h => h.targetUserId === userId);
  return !hasHint;
}

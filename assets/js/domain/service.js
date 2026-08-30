/**
 * Tầng service — nghiệp vụ ở mức "use case", nằm giữa `store` (I/O) và các trang (UI).
 * Trang không bao giờ gọi thẳng `store` cho việc ghi; luôn đi qua đây để
 * đảm bảo kiểm tra quy tắc, ghi nhật ký và cập nhật index nhất quán.
 */

import { store, P, EMPTY } from '../core/store.js';
import { TTL } from '../core/cache.js';
import { session, isAdmin, userId, canWriteUserData } from '../core/auth.js';
import { navCounters } from './counters.js';
import {
  nowIso, todayKey, uid, nextSeqId, b64encode, b64decode, deepClone, monthKey,
} from '../core/util.js';
import {
  STATUS, IDEA_STATUS, SET_KIND, SCHEMA_VERSION, DEFAULT_SLOTS, ROLE,
} from './constants.js';
import {
  emptySlots, computeSetStatus, validateSet, validateStatusChange, applyStatusChange,
  emptyProgressItem, progressOf, validateIdeaReview, canViewSolution, canGrantSolution,
  shouldAutoGrant, visibleHints, canRevealHint, isSetVisible, slotSpecs,
} from './rules.js';

/* ================================================================ config == */

export const DEFAULT_CONFIG = {
  schemaVersion: SCHEMA_VERSION,
  exam: {
    durationMinutes: 120,
    slots: DEFAULT_SLOTS,
    totalPoints: 1000,
    languages: ['Python', 'JavaScript', 'Java', 'C', 'C++', 'C#'],
    // RISK-10: ngưỡng hạng chưa công bố trên trang tham chiếu — admin tự nhập.
    gradeThresholds: [
      { grade: 'Lv.5', minScore: null },
      { grade: 'Lv.4', minScore: null },
      { grade: 'Lv.3', minScore: null },
      { grade: 'Lv.2', minScore: null },
      { grade: 'Lv.1', minScore: null },
    ],
  },
  features: {
    leaderboardEnabled: true,
    autoGrantOnApprovedIdea: false,
    publicApprovedIdeas: false,
    hardStuckAlertHours: 48,
  },
  updatedAt: null,
  updatedBy: null,
};

export function getConfig() {
  return store.read(P.config(), { fallback: deepClone(DEFAULT_CONFIG), ttl: TTL.config });
}

export async function saveConfig(patch) {
  requireAdmin();
  const cur = await getConfig();
  const next = { ...cur, ...patch, updatedAt: nowIso(), updatedBy: userId() };
  await store.save(P.config(), next, 'data(config): cập nhật cấu hình hệ thống');
  store.audit(userId(), 'CONFIG_UPDATE', 'config.json');
  return next;
}

/* ================================================================= users == */

export function getUsers() {
  return store.read(P.users(), { fallback: EMPTY.users(), ttl: TTL.users });
}

export async function getUserMap() {
  const doc = await getUsers();
  return new Map((doc.users || []).map(u => [u.id, u]));
}

export function activeUsers(doc) {
  return (doc.users || []).filter(u => u.active !== false && !u.deletedAt);
}

async function mutateUsers(fn, message, audit) {
  requireAdmin();
  const doc = await store.read(P.users(), { fallback: EMPTY.users(), ttl: 0, force: true });
  const next = fn(deepClone(doc));
  await store.save(P.users(), next, message);
  if (audit) store.audit(userId(), audit.action, audit.target);
  return next;
}

/** FR-USER-02: duyệt một yêu cầu tham gia thành thành viên chính thức. */
export function approveJoin(githubId, { role = ROLE.USER, displayName = null } = {}) {
  return mutateUsers(doc => {
    const req = (doc.pendingJoins || []).find(p => p.githubId === githubId);
    if (!req) return doc;
    doc.pendingJoins = doc.pendingJoins.filter(p => p.githubId !== githubId);
    doc.users = [...(doc.users || []), {
      id: uid('u_'),
      githubId: req.githubId,
      githubLogin: req.githubLogin,
      displayName: displayName || req.githubLogin,
      avatarUrl: req.avatarUrl ?? null,
      role,
      active: true,
      primaryLanguage: null,
      targetScore: null,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'Asia/Ho_Chi_Minh',
      joinedAt: nowIso(),
      lastActiveAt: nowIso(),
      deletedAt: null,
      updatedAt: nowIso(),
    }];
    return doc;
  }, `data(user): duyệt thành viên`, { action: 'USER_APPROVE', target: String(githubId) });
}

export function rejectJoin(githubId) {
  return mutateUsers(doc => {
    doc.pendingJoins = (doc.pendingJoins || []).filter(p => p.githubId !== githubId);
    return doc;
  }, 'data(user): từ chối yêu cầu tham gia', { action: 'USER_REJECT', target: String(githubId) });
}

/**
 * FR-USER-05: luôn phải còn ít nhất một quản trị viên đang hoạt động.
 * @throws Error khi thao tác sẽ làm mất admin cuối cùng
 */
function assertAdminRemains(doc, targetUserId, { newRole = null, deactivating = false }) {
  const admins = (doc.users || []).filter(u =>
    u.role === ROLE.ADMIN && u.active !== false && !u.deletedAt);
  const isTargetAdmin = admins.some(u => u.id === targetUserId);
  if (!isTargetAdmin) return;
  const losing = deactivating || (newRole && newRole !== ROLE.ADMIN);
  if (losing && admins.length <= 1) {
    throw new Error('Phải còn ít nhất một quản trị viên đang hoạt động.');
  }
}

export function changeRole(targetUserId, role) {
  return mutateUsers(doc => {
    assertAdminRemains(doc, targetUserId, { newRole: role });
    doc.users = doc.users.map(u => u.id === targetUserId ? { ...u, role, updatedAt: nowIso() } : u);
    return doc;
  }, `data(user): đổi vai trò`, { action: 'USER_ROLE_CHANGE', target: targetUserId });
}

export function setUserActive(targetUserId, active) {
  return mutateUsers(doc => {
    if (!active) assertAdminRemains(doc, targetUserId, { deactivating: true });
    doc.users = doc.users.map(u => u.id === targetUserId ? { ...u, active, updatedAt: nowIso() } : u);
    return doc;
  }, `data(user): ${active ? 'kích hoạt' : 'vô hiệu hoá'} thành viên`,
     { action: active ? 'USER_ACTIVATE' : 'USER_DEACTIVATE', target: targetUserId });
}

/** FR-USER-07: xoá mềm, giữ nguyên dữ liệu tiến độ cho thống kê. */
export function softDeleteUser(targetUserId) {
  return mutateUsers(doc => {
    assertAdminRemains(doc, targetUserId, { deactivating: true });
    doc.users = doc.users.map(u => u.id === targetUserId
      ? { ...u, active: false, deletedAt: nowIso(), updatedAt: nowIso() } : u);
    return doc;
  }, 'data(user): xoá mềm thành viên', { action: 'USER_DELETE', target: targetUserId });
}

/** FR-USER-06: user tự sửa hồ sơ của mình; admin sửa được của người khác. */
export async function updateProfile(targetUserId, patch) {
  if (!canWriteUserData(targetUserId)) throw new Error('Bạn không có quyền sửa hồ sơ này.');
  const doc = await store.read(P.users(), { fallback: EMPTY.users(), ttl: 0, force: true });
  const next = deepClone(doc);
  next.users = (next.users || []).map(u => u.id === targetUserId
    ? { ...u, ...patch, updatedAt: nowIso() } : u);
  await store.save(P.users(), next, 'data(user): cập nhật hồ sơ');
  store.audit(userId(), 'PROFILE_UPDATE', targetUserId);
  if (targetUserId === userId()) Object.assign(session.user ?? {}, patch);
  return next;
}

/* ============================================================== problems == */

export function getProblemIndex() {
  return store.read(P.problemIndex(), { fallback: EMPTY.problemIndex(), ttl: TTL.problems });
}

/** Danh sách metadata mọi bài (không kèm đề bài đầy đủ). */
export async function listProblems({ includeArchived = false } = {}) {
  const idx = await getProblemIndex();
  const items = idx.problems || [];
  return includeArchived ? items : items.filter(p => !p.archived);
}

export function getProblem(id) {
  return store.read(P.problem(id), { fallback: null, ttl: TTL.problems });
}

export async function getProblemMap() {
  const list = await listProblems({ includeArchived: true });
  return new Map(list.map(p => [p.id, p]));
}

function indexEntry(p) {
  return {
    id: p.id, title: p.title, level: p.level, tags: p.tags ?? [],
    estimatedMinutes: p.estimatedMinutes ?? null,
    archived: Boolean(p.archived), updatedAt: p.updatedAt,
  };
}

/**
 * FR-PROB-01/02. Ứng dụng tự cập nhật `_index.json` chứ không đợi CI,
 * để danh sách bài hiện ra ngay sau khi tạo.
 */
export async function saveProblem(problem) {
  requireAdmin();
  const isNew = !problem.id;
  let id = problem.id;
  if (isNew) {
    const idx = await getProblemIndex();
    id = nextSeqId((idx.problems || []).map(p => p.id), 'P-');
  }
  const now = nowIso();
  const full = {
    schemaVersion: SCHEMA_VERSION,
    id,
    title: problem.title,
    level: Number(problem.level),
    tags: problem.tags ?? [],
    statementMd: problem.statementMd ?? '',
    constraintsMd: problem.constraintsMd ?? '',
    samples: problem.samples ?? [],
    sourceUrl: problem.sourceUrl ?? '',
    sourceNote: problem.sourceNote ?? '',
    difficultyNote: problem.difficultyNote ?? '',
    recommendedLanguages: problem.recommendedLanguages ?? [],
    estimatedMinutes: problem.estimatedMinutes ?? null,
    archived: Boolean(problem.archived),
    createdBy: problem.createdBy ?? userId(),
    createdAt: problem.createdAt ?? now,
    updatedAt: now,
  };

  await store.save(P.problem(id), full, `data(problem): ${isNew ? 'create' : 'update'} ${id}`);

  const idx = await store.read(P.problemIndex(), { fallback: EMPTY.problemIndex(), ttl: 0 });
  const next = deepClone(idx);
  const rows = next.problems || [];
  const at = rows.findIndex(p => p.id === id);
  if (at >= 0) rows[at] = indexEntry(full); else rows.push(indexEntry(full));
  next.problems = rows;
  next.generatedAt = now;
  await store.save(P.problemIndex(), next, `data(problem): cập nhật index cho ${id}`);

  store.audit(userId(), isNew ? 'PROBLEM_CREATE' : 'PROBLEM_UPDATE', id);
  return full;
}

/** FR-PROB-02: xoá mềm — bài đã dùng trong bộ đề không bao giờ bị xoá cứng. */
export async function archiveProblem(id, archived = true) {
  const p = await getProblem(id);
  if (!p) throw new Error('Không tìm thấy bài tập.');
  return saveProblem({ ...p, archived });
}

/** FR-PROB-06: nhập hàng loạt từ JSON. */
export async function importProblems(list) {
  requireAdmin();
  const results = { created: 0, updated: 0, errors: [] };
  for (const raw of list) {
    try {
      if (!raw.title || ![1, 2, 3].includes(Number(raw.level))) {
        throw new Error(`Thiếu "title" hoặc "level" không thuộc {1,2,3}`);
      }
      const existed = raw.id ? await getProblem(raw.id) : null;
      await saveProblem({ ...raw, createdAt: existed?.createdAt });
      if (existed) results.updated++; else results.created++;
    } catch (err) {
      results.errors.push(`${raw.id ?? raw.title ?? '(không tên)'}: ${err.message}`);
    }
  }
  store.audit(userId(), 'PROBLEM_IMPORT', `${results.created}+${results.updated}`);
  return results;
}

/* ================================================================= daily == */

export function getDailySet(date) {
  return store.read(P.daily(date), { fallback: null, ttl: TTL.daily });
}

/** Bộ đề chính thức của hôm nay, `null` nếu chưa có hoặc chưa tới giờ phát hành. */
export async function getTodaySet() {
  const set = await getDailySet(todayKey());
  return set && isSetVisible(set) ? set : null;
}

export async function publishDailySet({ date, title, slots, noteMd = '', publishAt = null }) {
  requireAdmin();
  const problems = await getProblemMap();
  const check = validateSet(slots, problems, await getConfig());
  if (!check.ok) throw new Error(check.errors.join('\n'));

  const existing = await getDailySet(date);
  const now = nowIso();
  const set = {
    schemaVersion: SCHEMA_VERSION,
    id: `DS-${date}`,
    date,
    kind: SET_KIND.OFFICIAL,
    title: title || `Bộ đề ngày ${date}`,
    status: computeSetStatus({ slots }),
    publishAt,
    slots,
    noteMd,
    createdBy: existing?.createdBy ?? userId(),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  await store.save(P.daily(date), set, `data(daily): ${existing ? 'update' : 'publish'} ${date}`);
  store.audit(userId(), existing ? 'DAILY_UPDATE' : 'DAILY_PUBLISH', date);
  return set;
}

/** Đọc nhiều bộ đề chính thức trong một khoảng ngày (dùng cho lịch tháng). */
export async function getDailySetsInRange(dateKeys) {
  const out = new Map();
  await Promise.all(dateKeys.map(async d => {
    try {
      const s = await store.read(P.daily(d), { fallback: null, ttl: TTL.daily });
      if (s) out.set(d, s);
    } catch { /* thiếu file là bình thường */ }
  }));
  return out;
}

/* ============================================================== personal == */

export function getPersonal(targetId = userId()) {
  if (!targetId) return Promise.resolve(EMPTY.personal('guest'));
  return store.read(P.personal(targetId), { fallback: EMPTY.personal(targetId), ttl: TTL.own });
}

/** FR-SET-05: bộ đề cá nhân, cùng ràng buộc slot như bộ đề chính thức. */
export async function savePersonalSet({ date, title, slots, copiedFrom = null }) {
  const me = userId();
  if (!canWriteUserData(me)) throw new Error('Bạn cần đăng nhập để ghim bộ đề.');
  const problems = await getProblemMap();
  const check = validateSet(slots, problems, await getConfig());
  if (!check.ok) throw new Error(check.errors.join('\n'));

  const doc = await store.read(P.personal(me), { fallback: EMPTY.personal(me), ttl: 0 });
  const next = deepClone(doc);
  const id = `PS-${me}-${date}`;
  const now = nowIso();
  const rows = next.sets || [];
  const at = rows.findIndex(s => s.id === id);
  const set = {
    id, date, kind: SET_KIND.PERSONAL,
    title: title || `Bộ đề cá nhân ${date}`,
    status: computeSetStatus({ slots }),
    slots, copiedFrom,
    createdAt: at >= 0 ? rows[at].createdAt : now,
    updatedAt: now,
  };
  if (at >= 0) rows[at] = set; else rows.push(set);
  next.sets = rows;
  await store.save(P.personal(me), next, `data(personal): cập nhật bộ đề ${date}`);
  store.audit(me, 'PERSONAL_SET_UPDATE', date);
  return set;
}

export async function getPersonalSet(date, targetId = userId()) {
  const doc = await getPersonal(targetId);
  return (doc.sets || []).find(s => s.date === date) ?? null;
}

export async function toggleBookmark(problemId, note = '') {
  const me = userId();
  if (!canWriteUserData(me)) throw new Error('Bạn cần đăng nhập.');
  const doc = await store.read(P.personal(me), { fallback: EMPTY.personal(me), ttl: 0 });
  const next = deepClone(doc);
  const rows = next.bookmarks || [];
  const at = rows.findIndex(b => b.problemId === problemId);
  if (at >= 0) rows.splice(at, 1);
  else rows.push({ problemId, note, pinnedAt: nowIso() });
  next.bookmarks = rows;
  await store.save(P.personal(me), next, `data(personal): ${at >= 0 ? 'bỏ ghim' : 'ghim'} ${problemId}`);
  return at < 0;
}

/* ============================================================== progress == */

export function getProgress(targetId = userId()) {
  if (!targetId) return Promise.resolve(EMPTY.progress('guest'));
  return store.read(P.progress(targetId), { fallback: EMPTY.progress(targetId), ttl: TTL.own });
}

/**
 * FR-STAT-02: đổi trạng thái một bài của chính mình (admin đổi được của người khác).
 * Kiểm tra quy tắc trước, ghi lịch sử, rồi mới lưu.
 */
export async function setProblemStatus(problemId, to, { stuckReason = '', extra = {}, targetId = userId() } = {}) {
  if (!canWriteUserData(targetId)) throw new Error('Bạn không có quyền sửa tiến độ của người dùng này.');

  const doc = await store.read(P.progress(targetId), { fallback: EMPTY.progress(targetId), ttl: 0 });
  const cur = progressOf(doc, problemId);

  const check = validateStatusChange(cur.status, to, { stuckReason });
  if (!check.ok) throw new Error(check.error);

  const updated = applyStatusChange(cur, to, { stuckReason, extra });
  const next = deepClone(doc);
  const rows = next.items || [];
  const at = rows.findIndex(i => i.problemId === problemId);
  if (at >= 0) rows[at] = updated; else rows.push(updated);
  next.items = rows;

  await store.save(P.progress(targetId), next, `data(progress): ${problemId} -> ${to}`);
  store.audit(userId(), 'PROGRESS_STATUS_CHANGE', problemId, { from: cur.status, to });

  // FR-SOL-08: hoàn thành xong có thể đủ điều kiện tự cấp quyền xem lời giải.
  if (to === STATUS.COMPLETED) await maybeAutoGrant(problemId, targetId);
  return updated;
}

/** FR-STAT-05/06: cập nhật số liệu phụ (thời gian, ngôn ngữ, link code…). */
export async function patchProgress(problemId, patch, targetId = userId()) {
  if (!canWriteUserData(targetId)) throw new Error('Bạn không có quyền sửa tiến độ này.');
  const doc = await store.read(P.progress(targetId), { fallback: EMPTY.progress(targetId), ttl: 0 });
  const next = deepClone(doc);
  const rows = next.items || [];
  const at = rows.findIndex(i => i.problemId === problemId);
  const base = at >= 0 ? rows[at] : emptyProgressItem(problemId);
  const updated = { ...base, ...patch, updatedAt: nowIso() };
  if (at >= 0) rows[at] = updated; else rows.push(updated);
  next.items = rows;
  await store.save(P.progress(targetId), next, `data(progress): cập nhật ${problemId}`);
  return updated;
}

/** Đọc tiến độ của toàn bộ thành viên — dùng cho bảng admin và xếp hạng. */
export async function getAllProgress() {
  const users = activeUsers(await getUsers());
  const out = new Map();
  await Promise.all(users.map(async u => {
    try {
      out.set(u.id, await store.read(P.progress(u.id), { fallback: EMPTY.progress(u.id), ttl: TTL.default }));
    } catch {
      out.set(u.id, EMPTY.progress(u.id));
    }
  }));
  return out;
}

/* ================================================================= ideas == */

export function getIdeas(targetId = userId()) {
  if (!targetId) return Promise.resolve(EMPTY.ideas('guest'));
  return store.read(P.ideas(targetId), { fallback: EMPTY.ideas(targetId), ttl: TTL.own });
}

/** FR-IDEA-01/02/04: lưu nháp hoặc nộp; nộp lại thì tăng version và giữ lịch sử. */
export async function saveIdea(problemId, contentMd, { submit = false } = {}) {
  const me = userId();
  if (!canWriteUserData(me)) throw new Error('Bạn cần đăng nhập để nộp ý tưởng.');
  if (submit && !String(contentMd).trim()) throw new Error('Nội dung ý tưởng không được để trống.');

  const doc = await store.read(P.ideas(me), { fallback: EMPTY.ideas(me), ttl: 0 });
  const next = deepClone(doc);
  const rows = next.ideas || [];
  const at = rows.findIndex(i => i.problemId === problemId);
  const now = nowIso();

  if (at < 0) {
    rows.push({
      id: nextSeqId(rows.map(r => r.id), 'ID-'),
      problemId,
      status: submit ? IDEA_STATUS.PENDING : IDEA_STATUS.DRAFT,
      version: 1,
      contentMd,
      submittedAt: submit ? now : null,
      review: null,
      history: [],
      isPublic: false,
      updatedAt: now,
    });
  } else {
    const cur = rows[at];
    if (cur.status === IDEA_STATUS.APPROVED) throw new Error('Ý tưởng đã được duyệt, không thể sửa.');
    const resubmitting = submit && cur.status === IDEA_STATUS.NEEDS_REVISION;
    rows[at] = {
      ...cur,
      contentMd,
      status: submit ? IDEA_STATUS.PENDING : cur.status,
      version: resubmitting ? (cur.version || 1) + 1 : (cur.version || 1),
      submittedAt: submit ? now : cur.submittedAt,
      // Giữ toàn bộ phiên bản cũ khi nộp lại (FR-IDEA-04).
      history: resubmitting
        ? [...(cur.history || []), {
            version: cur.version || 1,
            contentMd: cur.contentMd,
            submittedAt: cur.submittedAt,
            review: cur.review,
          }]
        : (cur.history || []),
      review: resubmitting ? null : cur.review,
      updatedAt: now,
    };
  }
  next.ideas = rows;
  await store.save(P.ideas(me), next, `data(idea): ${submit ? 'nộp' : 'lưu nháp'} ${problemId}`);
  if (submit) store.audit(me, 'IDEA_SUBMIT', problemId);
  return rows.find(i => i.problemId === problemId);
}

/** FR-IDEA-03: admin duyệt / yêu cầu sửa / từ chối. */
export async function reviewIdea(targetUserId, ideaId, decision, commentMd) {
  requireAdmin();
  const check = validateIdeaReview(decision, commentMd);
  if (!check.ok) throw new Error(check.error);

  const doc = await store.read(P.ideas(targetUserId), { fallback: EMPTY.ideas(targetUserId), ttl: 0, force: true });
  const next = deepClone(doc);
  const idea = (next.ideas || []).find(i => i.id === ideaId);
  if (!idea) throw new Error('Không tìm thấy ý tưởng.');

  idea.status = decision;
  idea.review = {
    reviewerId: userId(),
    decision,
    commentMd: commentMd ?? '',
    reviewedAt: nowIso(),
  };
  idea.updatedAt = nowIso();

  await store.save(P.ideas(targetUserId), next, `data(idea): review ${ideaId} -> ${decision}`);
  store.audit(userId(), 'IDEA_REVIEW', ideaId, { to: decision });

  if (decision === IDEA_STATUS.APPROVED) await maybeAutoGrant(idea.problemId, targetUserId);
  return idea;
}

/** Hàng chờ duyệt của admin — gom ý tưởng PENDING của mọi thành viên. */
export async function getPendingIdeas() {
  const users = activeUsers(await getUsers());
  const out = [];
  await Promise.all(users.map(async u => {
    try {
      const doc = await store.read(P.ideas(u.id), { fallback: EMPTY.ideas(u.id), ttl: TTL.default });
      for (const idea of doc.ideas || []) {
        if (idea.status === IDEA_STATUS.PENDING) out.push({ ...idea, user: u });
      }
    } catch { /* user chưa có file ý tưởng */ }
  }));
  return out.sort((a, b) => String(a.submittedAt).localeCompare(String(b.submittedAt)));
}

/* ================================================================= hints == */

export function getHints(problemId) {
  return store.read(P.hints(problemId), { fallback: EMPTY.hints(problemId), ttl: TTL.default });
}

/** FR-HINT-02/03/07: tạo hint riêng cho một user hoặc hint chung. */
export async function createHint(problemId, { level, contentMd, targetUserId = null, inResponseToStuck = '' }) {
  requireAdmin();
  if (![1, 2, 3].includes(Number(level))) throw new Error('Cấp gợi ý phải là 1, 2 hoặc 3.');
  if (!String(contentMd).trim()) throw new Error('Nội dung gợi ý không được để trống.');

  const doc = await store.read(P.hints(problemId), { fallback: EMPTY.hints(problemId), ttl: 0 });
  const next = deepClone(doc);
  const rows = next.hints || [];
  rows.push({
    id: nextSeqId(rows.map(h => h.id), 'H-'),
    level: Number(level),
    targetUserId,
    inResponseToStuck,
    contentMd,
    createdBy: userId(),
    createdAt: nowIso(),
    updatedAt: nowIso(),
    feedback: null,
  });
  next.hints = rows;
  await store.save(P.hints(problemId), next, `data(hint): ${problemId} L${level}`);
  store.audit(userId(), 'HINT_CREATE', `${targetUserId ?? 'all'}/${problemId}`);
  return rows[rows.length - 1];
}

/** FR-HINT-04/05: mở gợi ý theo thứ tự cấp, có ghi nhận. */
export async function revealHint(problemId, hintId) {
  const me = userId();
  if (!canWriteUserData(me)) throw new Error('Bạn cần đăng nhập.');

  const [hintsDoc, progressDoc] = await Promise.all([getHints(problemId), getProgress(me)]);
  const available = visibleHints(hintsDoc, me, { isAdmin: isAdmin() });
  const hint = available.find(h => h.id === hintId);
  if (!hint) throw new Error('Không tìm thấy gợi ý.');

  const item = progressOf(progressDoc, problemId);
  if (!canRevealHint(hint, available, item)) {
    throw new Error('Hãy mở gợi ý ở cấp thấp hơn trước.');
  }
  if ((item.hintsRevealed || []).some(r => r.hintId === hintId)) return hint;

  await patchProgress(problemId, {
    hintsRevealed: [...(item.hintsRevealed || []), { hintId, level: hint.level, revealedAt: nowIso() }],
  }, me);
  store.audit(me, 'HINT_REVEAL', `${problemId}/${hintId}`);
  return hint;
}

/** FR-HINT-08: đánh dấu gợi ý có hữu ích không. */
export async function rateHint(problemId, hintId, helpful) {
  requireMember();
  const doc = await store.read(P.hints(problemId), { fallback: EMPTY.hints(problemId), ttl: 0 });
  const next = deepClone(doc);
  const hint = (next.hints || []).find(h => h.id === hintId);
  if (!hint) return null;
  hint.feedback = { helpful, at: nowIso(), by: userId() };
  hint.updatedAt = nowIso();
  await store.save(P.hints(problemId), next, `data(hint): phản hồi ${hintId}`);
  store.audit(userId(), 'HINT_FEEDBACK', hintId, { helpful });
  return hint;
}

/** Bảng theo dõi hard stuck của admin (FR-HINT-01). */
export async function getStuckBoard() {
  const users = activeUsers(await getUsers());
  const problems = await getProblemMap();
  const rows = [];
  await Promise.all(users.map(async u => {
    try {
      const doc = await store.read(P.progress(u.id), { fallback: EMPTY.progress(u.id), ttl: TTL.default });
      for (const item of doc.items || []) {
        if (item.status !== STATUS.HARD_STUCK) continue;
        rows.push({ user: u, item, problem: problems.get(item.problemId) ?? null });
      }
    } catch { /* bỏ qua user chưa có dữ liệu */ }
  }));
  return rows.sort((a, b) => String(a.item.stuckSince).localeCompare(String(b.item.stuckSince)));
}

/* ============================================================== solution == */

/**
 * Lời giải lưu base64 (DEC-02) — chỉ chống lộ vô tình khi duyệt repo,
 * hoàn toàn không phải mã hoá.
 */
export function encodeSolution(payload) {
  return b64encode(JSON.stringify(payload));
}
export function decodeSolution(b64) {
  try { return JSON.parse(b64decode(b64)); }
  catch { return null; }
}

export async function getSolutionRaw(problemId) {
  return store.read(P.solution(problemId), { fallback: null, ttl: TTL.problems });
}

/** FR-SOL-01/02: admin soạn và lưu lời giải. */
export async function saveSolution(problemId, payload) {
  requireAdmin();
  const doc = {
    schemaVersion: SCHEMA_VERSION,
    problemId,
    encoding: 'base64',
    contentB64: encodeSolution(payload),
    createdBy: userId(),
    updatedAt: nowIso(),
  };
  await store.save(P.solution(problemId), doc, `data(solution): cập nhật ${problemId}`);
  store.audit(userId(), 'SOLUTION_SAVE', problemId);
  return doc;
}

export function getGrants(targetId = userId()) {
  if (!targetId) return Promise.resolve(EMPTY.grants('guest'));
  return store.read(P.grants(targetId), { fallback: EMPTY.grants(targetId), ttl: TTL.own });
}

/**
 * FR-SOL-03: trả về lời giải đã giải mã **chỉ khi** đủ điều kiện.
 * Đây là chốt chặn duy nhất; UI không được tự quyết định.
 */
export async function getSolutionFor(problemId, targetId = userId()) {
  const [raw, progressDoc, grantsDoc] = await Promise.all([
    getSolutionRaw(problemId),
    getProgress(targetId),
    getGrants(targetId),
  ]);
  const verdict = canViewSolution({
    progressItem: progressOf(progressDoc, problemId),
    grantsDoc,
    problemId,
    role: session.role,
  });
  if (!verdict.allowed) return { allowed: false, reason: verdict.reason, exists: Boolean(raw) };
  if (!raw) return { allowed: true, reason: verdict.reason, exists: false, solution: null };
  return { allowed: true, reason: verdict.reason, exists: true, solution: decodeSolution(raw.contentB64) };
}

/** FR-SOL-09: ghi nhận lượt xem lời giải. */
export async function markSolutionViewed(problemId) {
  const me = userId();
  if (!me || !canWriteUserData(me)) return;
  await patchProgress(problemId, { solutionViewedAt: nowIso() }, me);
  store.audit(me, 'SOLUTION_VIEW', problemId);
}

/** FR-SOL-04: cấp quyền xem lời giải. INT-08 chặn khi user chưa hoàn thành. */
export async function grantSolution(targetUserId, problemId, reason = '') {
  requireAdmin();
  const progressDoc = await store.read(P.progress(targetUserId), {
    fallback: EMPTY.progress(targetUserId), ttl: 0, force: true,
  });
  if (!canGrantSolution(progressDoc, problemId)) {
    throw new Error('Chỉ cấp quyền được cho bài mà người dùng đã hoàn thành.');
  }
  return writeGrant(targetUserId, problemId, { reason, revoked: false });
}

export async function revokeGrant(targetUserId, problemId) {
  requireAdmin();
  return writeGrant(targetUserId, problemId, { revoked: true });
}

async function writeGrant(targetUserId, problemId, { reason = '', revoked = false }) {
  const doc = await store.read(P.grants(targetUserId), {
    fallback: EMPTY.grants(targetUserId), ttl: 0, force: true,
  });
  const next = deepClone(doc);
  const rows = next.grants || [];
  const at = rows.findIndex(g => g.problemId === problemId);
  const now = nowIso();
  const row = {
    problemId,
    grantedBy: userId(),
    grantedAt: at >= 0 ? rows[at].grantedAt : now,
    reason: reason || (at >= 0 ? rows[at].reason : ''),
    revokedAt: revoked ? now : null,
    updatedAt: now,
  };
  if (at >= 0) rows[at] = row; else rows.push(row);
  next.grants = rows;
  // Cấp quyền xong thì yêu cầu tương ứng coi như đã xử lý.
  next.requests = (next.requests || []).map(r =>
    r.problemId === problemId ? { ...r, status: revoked ? r.status : 'APPROVED', updatedAt: now } : r);

  await store.save(P.grants(targetUserId), next, `data(grant): ${revoked ? 'revoke' : 'grant'} ${targetUserId} ${problemId}`);
  store.audit(userId(), revoked ? 'SOLUTION_REVOKE' : 'SOLUTION_GRANT', `${targetUserId}/${problemId}`);
  return row;
}

/** FR-SOL-05: user gửi yêu cầu xem lời giải. */
export async function requestSolutionAccess(problemId, messageMd = '') {
  const me = userId();
  if (!canWriteUserData(me)) throw new Error('Bạn cần đăng nhập.');
  const doc = await store.read(P.grants(me), { fallback: EMPTY.grants(me), ttl: 0 });
  const next = deepClone(doc);
  const rows = next.requests || [];
  const at = rows.findIndex(r => r.problemId === problemId);
  const row = { problemId, requestedAt: nowIso(), messageMd, status: 'PENDING' };
  if (at >= 0) rows[at] = row; else rows.push(row);
  next.requests = rows;
  await store.save(P.grants(me), next, `data(grant): yêu cầu xem lời giải ${problemId}`);
  store.audit(me, 'SOLUTION_REQUEST', problemId);
  return row;
}

/** FR-SOL-06: hàng chờ yêu cầu xem lời giải của toàn hệ thống. */
export async function getSolutionRequests() {
  const users = activeUsers(await getUsers());
  const out = [];
  await Promise.all(users.map(async u => {
    try {
      const doc = await store.read(P.grants(u.id), { fallback: EMPTY.grants(u.id), ttl: TTL.default });
      for (const r of doc.requests || []) {
        if (r.status === 'PENDING') out.push({ ...r, user: u });
      }
    } catch { /* chưa có file */ }
  }));
  return out.sort((a, b) => String(a.requestedAt).localeCompare(String(b.requestedAt)));
}

async function maybeAutoGrant(problemId, targetUserId) {
  try {
    const [config, progressDoc, ideasDoc] = await Promise.all([
      getConfig(),
      store.read(P.progress(targetUserId), { fallback: EMPTY.progress(targetUserId), ttl: 0 }),
      store.read(P.ideas(targetUserId), { fallback: EMPTY.ideas(targetUserId), ttl: 0 }),
    ]);
    if (!shouldAutoGrant(config, progressDoc, ideasDoc, problemId)) return;
    // Ghi grant trực tiếp: đây là hành động của hệ thống, không cần quyền admin.
    await writeGrant(targetUserId, problemId, { reason: 'Tự cấp: đã hoàn thành và ý tưởng được duyệt' });
  } catch (err) {
    console.warn('[service] tự cấp quyền thất bại', err);
  }
}

/* ================================================================= exams == */

export function getExams(targetId = userId()) {
  if (!targetId) return Promise.resolve(EMPTY.exams('guest'));
  return store.read(P.exams(targetId), { fallback: EMPTY.exams(targetId), ttl: TTL.own });
}

/** FR-EXAM-05: lưu kết quả một phiên thi thử. */
export async function saveExamSession(sessionData) {
  const me = userId();
  if (!canWriteUserData(me)) throw new Error('Bạn cần đăng nhập.');
  const doc = await store.read(P.exams(me), { fallback: EMPTY.exams(me), ttl: 0 });
  const next = deepClone(doc);
  const rows = next.sessions || [];
  rows.push({ id: nextSeqId(rows.map(s => s.id), 'EX-'), ...sessionData });
  next.sessions = rows;
  await store.save(P.exams(me), next, `data(exam): kết thúc phiên thi thử`);
  store.audit(me, 'EXAM_FINISH', String(sessionData.totalScore));
  return rows[rows.length - 1];
}

/* ================================================================ audit == */

export async function getAuditLog(ym = monthKey()) {
  const gh = store.gh;
  if (!gh) return [];
  const file = await gh.readFile(P.audit(ym)).catch(() => null);
  if (!file) return [];
  return file.text.split('\n')
    .filter(Boolean)
    .map(line => { try { return JSON.parse(line); } catch { return null; } })
    .filter(Boolean)
    .reverse();
}

/* ========================================================= nav counters == */

export async function refreshNavCounters() {
  if (!isAdmin()) {
    navCounters.pendingIdeas = 0;
    navCounters.stuck = 0;
    navCounters.joinRequests = 0;
    navCounters.solutionRequests = 0;
    return navCounters;
  }
  const [ideas, stuck, users, reqs] = await Promise.all([
    getPendingIdeas().catch(() => []),
    getStuckBoard().catch(() => []),
    getUsers().catch(() => EMPTY.users()),
    getSolutionRequests().catch(() => []),
  ]);
  navCounters.pendingIdeas = ideas.length;
  navCounters.stuck = stuck.length;
  navCounters.joinRequests = (users.pendingJoins || []).length;
  navCounters.solutionRequests = reqs.length;
  return navCounters;
}

/* ================================================================ helper == */

function requireAdmin() {
  if (!isAdmin()) throw new Error('Chức năng này chỉ dành cho quản trị viên.');
  if (!session.canWrite) throw new Error('Token của bạn không có quyền ghi.');
}

function requireMember() {
  if (!userId()) throw new Error('Bạn cần đăng nhập.');
  if (!session.canWrite) throw new Error('Token của bạn không có quyền ghi.');
}

export { slotSpecs };

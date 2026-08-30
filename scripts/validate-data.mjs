/**
 * Kiểm tra toàn vẹn dữ liệu trong `data/` — chạy trong GitHub Actions mỗi lần push.
 *
 * Đây là kiểm tra **toàn vẹn dữ liệu**, không phải kiểm soát truy cập
 * (dự án cố ý không cưỡng chế phân quyền ở tầng lưu trữ — xem SRS DEC-03).
 *
 *   node scripts/validate-data.mjs
 *
 * Thoát mã 1 khi có lỗi, để CI báo đỏ.
 */

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

const errors = [];
const warnings = [];

const err = (file, msg) => errors.push(`${file}: ${msg}`);
const warn = (file, msg) => warnings.push(`${file}: ${msg}`);

const STATUSES = ['NOT_STARTED', 'IN_PROGRESS', 'HARD_STUCK', 'COMPLETED'];
const IDEA_STATUSES = ['DRAFT', 'PENDING', 'APPROVED', 'NEEDS_REVISION', 'REJECTED'];
const ROLES = ['USER', 'ADMIN', 'TEACHER'];
const MIN_STUCK_REASON = 20;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

/* ---------------------------------------------------------------- utils -- */

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    err(path, `không phải JSON hợp lệ — ${e.message}`);
    return null;
  }
}

function listJson(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter(f => f.endsWith('.json')).map(f => join(dir, f));
}

/** INT-10: mọi mốc thời gian phải là ISO-8601 UTC. */
function checkIso(file, value, field) {
  if (value == null || value === '') return;
  if (!ISO.test(value)) err(file, `${field} không phải ISO-8601: "${value}"`);
}

/** INT-12: schemaVersion phải khớp phiên bản ứng dụng hỗ trợ. */
function checkSchemaVersion(file, doc) {
  if (doc.schemaVersion !== 1) {
    err(file, `schemaVersion phải là 1, nhận được ${JSON.stringify(doc.schemaVersion)}`);
  }
}

/** CON-04: file dữ liệu nên nhỏ để tải nhanh. */
function checkSize(path) {
  const bytes = statSync(path).size;
  if (bytes > 1_000_000) err(path, `vượt 1 MB (${Math.round(bytes / 1024)} KB) — vi phạm CON-04`);
  else if (bytes > 500_000) warn(path, `khá lớn (${Math.round(bytes / 1024)} KB), cân nhắc tách nhỏ`);
}

/* --------------------------------------------------------------- config -- */

let config = null;
const CONFIG_PATH = 'data/config.json';

if (!existsSync(CONFIG_PATH)) {
  err(CONFIG_PATH, 'thiếu file cấu hình — chạy `node scripts/seed.mjs`');
} else {
  checkSize(CONFIG_PATH);
  config = readJson(CONFIG_PATH);
  if (config) {
    checkSchemaVersion(CONFIG_PATH, config);
    const slots = config.exam?.slots;
    if (!Array.isArray(slots) || !slots.length) {
      err(CONFIG_PATH, 'exam.slots phải là mảng không rỗng');
    } else {
      const sum = slots.reduce((a, s) => a + (Number(s.points) || 0), 0);
      // INT-04: tổng điểm các slot phải khớp totalPoints.
      if (sum !== config.exam.totalPoints) {
        err(CONFIG_PATH, `tổng điểm slot (${sum}) khác exam.totalPoints (${config.exam.totalPoints})`);
      }
      for (const s of slots) {
        if (![1, 2, 3].includes(Number(s.level))) err(CONFIG_PATH, `slot ${s.slot} có level không hợp lệ: ${s.level}`);
      }
    }
    if (!(Number(config.exam?.durationMinutes) > 0)) {
      err(CONFIG_PATH, 'exam.durationMinutes phải là số dương');
    }
    // Ngưỡng hạng phải giảm dần, nếu không quy đổi sẽ sai.
    const filled = (config.exam?.gradeThresholds ?? []).filter(g => g.minScore != null);
    for (let i = 1; i < filled.length; i++) {
      if (filled[i].minScore >= filled[i - 1].minScore) {
        err(CONFIG_PATH, `ngưỡng ${filled[i].grade} (${filled[i].minScore}) phải nhỏ hơn ${filled[i - 1].grade} (${filled[i - 1].minScore})`);
      }
    }
  }
}

const slotSpec = new Map((config?.exam?.slots ?? []).map(s => [s.slot, s]));

/* ---------------------------------------------------------------- users -- */

let users = [];
const USERS_PATH = 'data/users.json';

if (existsSync(USERS_PATH)) {
  checkSize(USERS_PATH);
  const doc = readJson(USERS_PATH);
  if (doc) {
    checkSchemaVersion(USERS_PATH, doc);
    users = doc.users ?? [];
    const ids = new Set();
    const githubIds = new Set();

    for (const u of users) {
      if (!u.id) err(USERS_PATH, 'có user thiếu "id"');
      // INT-09: id phải duy nhất.
      if (ids.has(u.id)) err(USERS_PATH, `id user trùng: ${u.id}`);
      ids.add(u.id);
      if (githubIds.has(u.githubId)) err(USERS_PATH, `githubId trùng: ${u.githubId}`);
      githubIds.add(u.githubId);
      if (!ROLES.includes(u.role)) err(USERS_PATH, `user ${u.id} có role không hợp lệ: ${u.role}`);
      checkIso(USERS_PATH, u.joinedAt, `user ${u.id}.joinedAt`);
    }

    // INT-11: luôn phải còn ít nhất một admin đang hoạt động.
    const admins = users.filter(u => u.role === 'ADMIN' && u.active !== false && !u.deletedAt);
    if (users.length && !admins.length) {
      err(USERS_PATH, 'không còn quản trị viên nào đang hoạt động (INT-11)');
    }
    if (!users.length) {
      warn(USERS_PATH, 'chưa có thành viên — người đầu tiên đăng nhập sẽ thành quản trị viên');
    }
  }
}

const userIds = new Set(users.map(u => u.id));

/* ------------------------------------------------------------- problems -- */

const problems = new Map();

for (const path of listJson('data/problems')) {
  if (path.endsWith('_index.json')) continue;
  checkSize(path);
  const p = readJson(path);
  if (!p) continue;

  checkSchemaVersion(path, p);
  if (!p.id) err(path, 'thiếu "id"');
  if (!p.title?.trim()) err(path, 'thiếu "title"');
  if (![1, 2, 3].includes(Number(p.level))) err(path, `level phải thuộc {1,2,3}, nhận được ${p.level}`);
  if (!p.statementMd?.trim()) warn(path, 'đề bài trống');
  if (!Array.isArray(p.samples)) err(path, '"samples" phải là mảng');
  checkIso(path, p.createdAt, 'createdAt');
  checkIso(path, p.updatedAt, 'updatedAt');

  const expected = `data/problems/${p.id}.json`.replace(/\\/g, '/');
  if (path.replace(/\\/g, '/') !== expected) err(path, `tên file phải khớp id: mong đợi ${expected}`);
  if (problems.has(p.id)) err(path, `id bài tập trùng: ${p.id}`);
  problems.set(p.id, p);
}

/* --------------------------------------------------------- problem index -- */

const INDEX_PATH = 'data/problems/_index.json';
if (existsSync(INDEX_PATH)) {
  const idx = readJson(INDEX_PATH);
  if (idx) {
    checkSchemaVersion(INDEX_PATH, idx);
    const indexed = new Set((idx.problems ?? []).map(p => p.id));
    for (const entry of idx.problems ?? []) {
      const full = problems.get(entry.id);
      if (!full) { err(INDEX_PATH, `index trỏ tới bài không tồn tại: ${entry.id}`); continue; }
      if (Number(full.level) !== Number(entry.level)) {
        err(INDEX_PATH, `${entry.id}: level trong index (${entry.level}) khác file gốc (${full.level})`);
      }
      if (full.title !== entry.title) {
        warn(INDEX_PATH, `${entry.id}: tiêu đề trong index lệch file gốc — chạy \`npm run build-index\``);
      }
    }
    for (const id of problems.keys()) {
      if (!indexed.has(id)) err(INDEX_PATH, `bài ${id} chưa có trong index — chạy \`npm run build-index\``);
    }
  }
} else if (problems.size) {
  err(INDEX_PATH, 'thiếu index — chạy `npm run build-index`');
}

/* ------------------------------------------------------------- solutions -- */

for (const path of listJson('data/solutions')) {
  checkSize(path);
  const s = readJson(path);
  if (!s) continue;
  checkSchemaVersion(path, s);
  if (!problems.has(s.problemId)) err(path, `trỏ tới bài không tồn tại: ${s.problemId}`);
  if (s.encoding !== 'base64') err(path, `encoding phải là "base64", nhận được ${JSON.stringify(s.encoding)}`);
  if (!s.contentB64) { err(path, 'thiếu contentB64'); continue; }
  try {
    const decoded = JSON.parse(Buffer.from(s.contentB64, 'base64').toString('utf8'));
    if (!decoded.approachMd?.trim()) warn(path, 'lời giải không có phần "approachMd"');
  } catch {
    err(path, 'contentB64 không giải mã được thành JSON hợp lệ');
  }
}

/* ----------------------------------------------------------------- daily -- */

for (const path of listJson('data/daily')) {
  checkSize(path);
  const set = readJson(path);
  if (!set) continue;
  checkSchemaVersion(path, set);

  if (!DATE_KEY.test(set.date ?? '')) err(path, `date phải dạng YYYY-MM-DD, nhận được ${set.date}`);
  const expected = `data/daily/${set.date}.json`.replace(/\\/g, '/');
  if (set.date && path.replace(/\\/g, '/') !== expected) err(path, `tên file phải khớp date: ${expected}`);
  checkIso(path, set.publishAt, 'publishAt');

  validateSlots(path, set.slots, set.date);
}

/* -------------------------------------------------------------- personal -- */

for (const path of listJson('data/personal')) {
  checkSize(path);
  const doc = readJson(path);
  if (!doc) continue;
  checkSchemaVersion(path, doc);
  checkOwner(path, doc.userId, 'personal');

  const seen = new Set();
  for (const set of doc.sets ?? []) {
    if (seen.has(set.id)) err(path, `id bộ đề trùng: ${set.id}`);
    seen.add(set.id);
    if (!DATE_KEY.test(set.date ?? '')) err(path, `bộ đề ${set.id} có date sai định dạng`);
    validateSlots(path, set.slots, set.date);
  }
  for (const b of doc.bookmarks ?? []) {
    if (!problems.has(b.problemId)) warn(path, `ghim trỏ tới bài không tồn tại: ${b.problemId}`);
  }
}

/** INT-01/02/03: bài phải tồn tại, level khớp slot, không trùng bài trong một bộ đề. */
function validateSlots(path, slots, label) {
  if (!Array.isArray(slots)) { err(path, `bộ đề ${label}: "slots" phải là mảng`); return; }

  const used = new Map();
  for (const s of slots) {
    const spec = slotSpec.get(s.slot);
    if (!spec) { err(path, `bộ đề ${label}: slot "${s.slot}" không có trong cấu hình`); continue; }
    if (s.points != null && Number(s.points) !== Number(spec.points)) {
      warn(path, `bộ đề ${label}: slot ${s.slot} có ${s.points} điểm, cấu hình là ${spec.points}`);
    }
    if (!s.problemId) continue;

    const p = problems.get(s.problemId);
    if (!p) { err(path, `bộ đề ${label}: slot ${s.slot} trỏ tới bài không tồn tại "${s.problemId}"`); continue; }
    if (Number(p.level) !== Number(spec.level)) {
      err(path, `bộ đề ${label}: slot ${s.slot} cần Level ${spec.level} nhưng "${p.id}" là Level ${p.level} (INT-02)`);
    }
    if (used.has(s.problemId)) {
      err(path, `bộ đề ${label}: bài "${s.problemId}" bị ghim vào cả slot ${used.get(s.problemId)} và ${s.slot} (INT-03)`);
    }
    used.set(s.problemId, s.slot);
  }
}

/* -------------------------------------------------------------- progress -- */

const progressByUser = new Map();

for (const path of listJson('data/progress')) {
  checkSize(path);
  const doc = readJson(path);
  if (!doc) continue;
  checkSchemaVersion(path, doc);
  checkOwner(path, doc.userId, 'progress');
  progressByUser.set(doc.userId, doc);

  const seen = new Set();
  for (const item of doc.items ?? []) {
    if (seen.has(item.problemId)) err(path, `bản ghi tiến độ trùng cho bài ${item.problemId}`);
    seen.add(item.problemId);

    if (!problems.has(item.problemId)) warn(path, `tiến độ trỏ tới bài không tồn tại: ${item.problemId}`);
    if (!STATUSES.includes(item.status)) err(path, `${item.problemId}: trạng thái không hợp lệ "${item.status}"`);

    // INT-05
    if (item.status === 'HARD_STUCK') {
      const len = String(item.stuckReason ?? '').trim().length;
      if (len < MIN_STUCK_REASON) {
        err(path, `${item.problemId}: HARD_STUCK cần mô tả ≥ ${MIN_STUCK_REASON} ký tự (hiện ${len}) — INT-05`);
      }
      if (!item.stuckSince) err(path, `${item.problemId}: HARD_STUCK thiếu stuckSince`);
    }
    // INT-06
    if (item.status === 'COMPLETED' && !item.completedAt) {
      err(path, `${item.problemId}: COMPLETED phải có completedAt — INT-06`);
    }
    if (Number(item.timeSpentMinutes) < 0) err(path, `${item.problemId}: timeSpentMinutes âm`);

    checkIso(path, item.startedAt, `${item.problemId}.startedAt`);
    checkIso(path, item.completedAt, `${item.problemId}.completedAt`);
    checkIso(path, item.stuckSince, `${item.problemId}.stuckSince`);

    for (const h of item.statusHistory ?? []) {
      if (h.to && !STATUSES.includes(h.to)) err(path, `${item.problemId}: lịch sử có trạng thái lạ "${h.to}"`);
      checkIso(path, h.at, `${item.problemId}.statusHistory.at`);
    }
  }
}

/* ----------------------------------------------------------------- ideas -- */

for (const path of listJson('data/ideas')) {
  checkSize(path);
  const doc = readJson(path);
  if (!doc) continue;
  checkSchemaVersion(path, doc);
  checkOwner(path, doc.userId, 'ideas');

  const ids = new Set();
  for (const idea of doc.ideas ?? []) {
    if (ids.has(idea.id)) err(path, `id ý tưởng trùng: ${idea.id}`);
    ids.add(idea.id);
    if (!IDEA_STATUSES.includes(idea.status)) err(path, `${idea.id}: trạng thái không hợp lệ "${idea.status}"`);
    if (!problems.has(idea.problemId)) warn(path, `${idea.id}: trỏ tới bài không tồn tại ${idea.problemId}`);

    // INT-07
    if (['NEEDS_REVISION', 'REJECTED'].includes(idea.status)) {
      if (!String(idea.review?.commentMd ?? '').trim()) {
        err(path, `${idea.id}: trạng thái ${idea.status} bắt buộc có nhận xét — INT-07`);
      }
    }
    if (idea.status === 'PENDING' && !idea.submittedAt) {
      err(path, `${idea.id}: PENDING phải có submittedAt`);
    }
    checkIso(path, idea.submittedAt, `${idea.id}.submittedAt`);
    checkIso(path, idea.review?.reviewedAt, `${idea.id}.review.reviewedAt`);
  }
}

/* ----------------------------------------------------------------- hints -- */

for (const path of listJson('data/hints')) {
  checkSize(path);
  const doc = readJson(path);
  if (!doc) continue;
  checkSchemaVersion(path, doc);
  if (!problems.has(doc.problemId)) warn(path, `trỏ tới bài không tồn tại: ${doc.problemId}`);

  const ids = new Set();
  for (const h of doc.hints ?? []) {
    if (ids.has(h.id)) err(path, `id gợi ý trùng: ${h.id}`);
    ids.add(h.id);
    if (![1, 2, 3].includes(Number(h.level))) err(path, `${h.id}: level phải thuộc {1,2,3}, nhận được ${h.level}`);
    if (!String(h.contentMd ?? '').trim()) err(path, `${h.id}: nội dung gợi ý trống`);
    if (h.targetUserId && userIds.size && !userIds.has(h.targetUserId)) {
      warn(path, `${h.id}: gửi cho user không tồn tại ${h.targetUserId}`);
    }
    checkIso(path, h.createdAt, `${h.id}.createdAt`);
  }
}

/* ---------------------------------------------------------------- grants -- */

for (const path of listJson('data/grants')) {
  checkSize(path);
  const doc = readJson(path);
  if (!doc) continue;
  checkSchemaVersion(path, doc);
  checkOwner(path, doc.userId, 'grants');

  const progress = progressByUser.get(doc.userId);
  for (const g of doc.grants ?? []) {
    if (!problems.has(g.problemId)) warn(path, `grant trỏ tới bài không tồn tại: ${g.problemId}`);
    checkIso(path, g.grantedAt, `${g.problemId}.grantedAt`);

    // INT-08: chỉ cấp quyền cho bài user đã hoàn thành.
    if (!g.revokedAt && progress) {
      const item = (progress.items ?? []).find(i => i.problemId === g.problemId);
      if (item?.status !== 'COMPLETED') {
        warn(path, `${g.problemId}: có grant nhưng trạng thái là "${item?.status ?? 'NOT_STARTED'}" (INT-08)`);
      }
    }
  }
}

/* ----------------------------------------------------------------- exams -- */

for (const path of listJson('data/exams')) {
  checkSize(path);
  const doc = readJson(path);
  if (!doc) continue;
  checkSchemaVersion(path, doc);
  checkOwner(path, doc.userId, 'exams');

  const ids = new Set();
  for (const s of doc.sessions ?? []) {
    if (ids.has(s.id)) err(path, `id phiên thi trùng: ${s.id}`);
    ids.add(s.id);
    checkIso(path, s.startedAt, `${s.id}.startedAt`);
    checkIso(path, s.endedAt, `${s.id}.endedAt`);

    const sum = (s.scores ?? []).reduce((a, x) => a + (Number(x.score) || 0), 0);
    if (s.totalScore != null && sum !== s.totalScore) {
      err(path, `${s.id}: tổng điểm từng bài (${sum}) khác totalScore (${s.totalScore})`);
    }
    for (const sc of s.scores ?? []) {
      if (Number(sc.score) > Number(sc.maxPoints)) {
        err(path, `${s.id}: slot ${sc.slot} có ${sc.score} điểm, vượt tối đa ${sc.maxPoints}`);
      }
      if (Number(sc.score) < 0) err(path, `${s.id}: slot ${sc.slot} có điểm âm`);
    }
  }
}

/* ----------------------------------------------------------------- audit -- */

if (existsSync('data/audit')) {
  for (const f of readdirSync('data/audit').filter(f => f.endsWith('.jsonl'))) {
    const path = join('data/audit', f);
    checkSize(path);
    const lines = readFileSync(path, 'utf8').split('\n').filter(Boolean);
    lines.forEach((line, i) => {
      try {
        const e = JSON.parse(line);
        if (!e.at || !e.action) err(path, `dòng ${i + 1}: thiếu "at" hoặc "action"`);
      } catch {
        err(path, `dòng ${i + 1}: không phải JSON hợp lệ`);
      }
    });
  }
}

/** Tên file phải khớp userId bên trong, nếu không sharding theo user sẽ vô nghĩa. */
function checkOwner(path, userId, kind) {
  const fileId = path.split(/[\\/]/).pop().replace('.json', '');
  if (!userId) { err(path, `thiếu "userId"`); return; }
  if (userId !== fileId) err(path, `userId bên trong ("${userId}") khác tên file ("${fileId}")`);
  if (userIds.size && !userIds.has(userId)) warn(path, `${kind}: userId không có trong users.json`);
}

/* ----------------------------------------------------------------- báo cáo -- */

if (warnings.length) {
  console.log(`\n⚠  ${warnings.length} cảnh báo:`);
  for (const w of warnings) console.log(`   ${w}`);
}

if (errors.length) {
  console.log(`\n✖  ${errors.length} lỗi:`);
  for (const e of errors) console.log(`   ${e}`);
  console.log('\nDữ liệu không hợp lệ. Xem SRS §5.4 để biết chi tiết các quy tắc INT-01…INT-12.');
  process.exit(1);
}

console.log(`\n✓  Dữ liệu hợp lệ — ${problems.size} bài tập, ${users.length} thành viên.`);

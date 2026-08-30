import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  validateSlotAssignment, validateSet, emptySlots, computeSetStatus, isSetVisible,
  canTransition, validateStatusChange, applyStatusChange, emptyProgressItem, statusOf,
  validateIdeaReview, canIdeaTransition,
  visibleHints, nextRevealableLevel, canRevealHint,
  canViewSolution, canGrantSolution, shouldAutoGrant,
  scoreOfSet, gradeForScore, totalPoints, isStuckTooLong,
} from '../assets/js/domain/rules.js';

import { STATUS, IDEA_STATUS, SET_STATUS, ROLE } from '../assets/js/domain/constants.js';

const P = {
  'P-1': { id: 'P-1', title: 'Bài Lv1', level: 1 },
  'P-2': { id: 'P-2', title: 'Bài Lv2', level: 2 },
  'P-3': { id: 'P-3', title: 'Bài Lv3', level: 3 },
  'P-4': { id: 'P-4', title: 'Bài Lv3 khác', level: 3 },
  'P-X': { id: 'P-X', title: 'Bài đã lưu trữ', level: 1, archived: true },
};

/* ------------------------------------------------------------- slot/set -- */

test('tổng điểm 4 slot đúng 1000 (INT-04)', () => {
  assert.equal(totalPoints(), 1000);
  const slots = emptySlots();
  assert.deepEqual(slots.map(s => s.slot), ['L1', 'L2', 'L3A', 'L3B']);
  assert.deepEqual(slots.map(s => s.points), [300, 200, 200, 300]);
});

test('AC-02: slot L1 từ chối bài level 2 (INT-02)', () => {
  const ok = validateSlotAssignment('L1', P['P-1']);
  assert.equal(ok.ok, true);

  const bad = validateSlotAssignment('L1', P['P-2']);
  assert.equal(bad.ok, false);
  assert.match(bad.error, /chỉ nhận bài Level 1/);
});

test('slot L3A/L3B nhận bài level 3, slot rỗng vẫn hợp lệ', () => {
  assert.equal(validateSlotAssignment('L3A', P['P-3']).ok, true);
  assert.equal(validateSlotAssignment('L3B', P['P-4']).ok, true);
  assert.equal(validateSlotAssignment('L2', null).ok, true);
});

test('không ghim được bài đã lưu trữ (INT-01)', () => {
  const res = validateSlotAssignment('L1', P['P-X']);
  assert.equal(res.ok, false);
  assert.match(res.error, /đã được lưu trữ/);
});

test('AC-03: cùng một bài không được ghim vào hai slot (INT-03)', () => {
  const slots = [
    { slot: 'L1', problemId: 'P-1' },
    { slot: 'L2', problemId: 'P-2' },
    { slot: 'L3A', problemId: 'P-3' },
    { slot: 'L3B', problemId: 'P-3' },
  ];
  const res = validateSet(slots, P);
  assert.equal(res.ok, false);
  assert.match(res.errors.join(' '), /bị ghim vào cả slot L3A và L3B/);
});

test('bộ đề hợp lệ không sinh lỗi', () => {
  const slots = [
    { slot: 'L1', problemId: 'P-1' },
    { slot: 'L2', problemId: 'P-2' },
    { slot: 'L3A', problemId: 'P-3' },
    { slot: 'L3B', problemId: 'P-4' },
  ];
  assert.deepEqual(validateSet(slots, P), { ok: true, errors: [] });
});

test('FR-SET-06: bộ đề thiếu bài được đánh dấu INCOMPLETE', () => {
  assert.equal(computeSetStatus({ slots: emptySlots() }), SET_STATUS.DRAFT);
  assert.equal(computeSetStatus({ slots: [{ problemId: 'P-1' }, { problemId: null }] }), SET_STATUS.INCOMPLETE);
  assert.equal(computeSetStatus({ slots: [{ problemId: 'P-1' }, { problemId: 'P-2' }] }), SET_STATUS.PUBLISHED);
});

test('FR-SET-09: bộ đề hẹn giờ chưa tới hạn thì chưa hiện', () => {
  const future = new Date(Date.now() + 86400000).toISOString();
  const past = new Date(Date.now() - 86400000).toISOString();
  assert.equal(isSetVisible({ publishAt: future }), false);
  assert.equal(isSetVisible({ publishAt: past }), true);
  assert.equal(isSetVisible({}), true);
});

/* ----------------------------------------------------------- trạng thái -- */

test('máy trạng thái cho phép đúng các bước ở SRS §4.5', () => {
  assert.equal(canTransition(STATUS.NOT_STARTED, STATUS.IN_PROGRESS), true);
  assert.equal(canTransition(STATUS.IN_PROGRESS, STATUS.HARD_STUCK), true);
  assert.equal(canTransition(STATUS.HARD_STUCK, STATUS.IN_PROGRESS), true);
  assert.equal(canTransition(STATUS.HARD_STUCK, STATUS.COMPLETED), true);
  assert.equal(canTransition(STATUS.COMPLETED, STATUS.IN_PROGRESS), true);
  assert.equal(canTransition(STATUS.NOT_STARTED, STATUS.COMPLETED), true);
  // Không có bước NOT_STARTED -> HARD_STUCK
  assert.equal(canTransition(STATUS.NOT_STARTED, STATUS.HARD_STUCK), false);
});

test('AC-05: HARD_STUCK bắt buộc mô tả ≥ 20 ký tự (INT-05)', () => {
  const short = validateStatusChange(STATUS.IN_PROGRESS, STATUS.HARD_STUCK, { stuckReason: 'bí quá' });
  assert.equal(short.ok, false);
  assert.match(short.error, /ít nhất 20 ký tự/);

  const good = validateStatusChange(STATUS.IN_PROGRESS, STATUS.HARD_STUCK, {
    stuckReason: 'Em cài BFS nhưng bị TLE ở n=1000, không rõ nén trạng thái thế nào.',
  });
  assert.equal(good.ok, true);
});

test('AC-06 + FR-STAT-04: đổi trạng thái ghi lịch sử và mốc thời gian', () => {
  let item = emptyProgressItem('P-3');
  const t0 = new Date('2026-08-30T02:00:00Z');
  item = applyStatusChange(item, STATUS.IN_PROGRESS, { now: t0 });
  assert.equal(item.startedAt, t0.toISOString());

  const t1 = new Date('2026-08-30T04:10:00Z');
  item = applyStatusChange(item, STATUS.HARD_STUCK, {
    stuckReason: 'BFS bị TLE ở n=1000 khi lưới dày đặc chướng ngại.', now: t1,
  });
  assert.equal(item.status, STATUS.HARD_STUCK);
  assert.equal(item.stuckSince, t1.toISOString());
  // 130 phút ở trạng thái đang làm được cộng dồn (FR-STAT-05)
  assert.equal(item.timeSpentMinutes, 130);
  assert.deepEqual(item.statusHistory.map(h => h.to), [STATUS.IN_PROGRESS, STATUS.HARD_STUCK]);
});

test('INT-06: COMPLETED luôn có completedAt; mở lại thì xoá đi', () => {
  let item = emptyProgressItem('P-1');
  const t = new Date('2026-08-30T05:00:00Z');
  item = applyStatusChange(item, STATUS.COMPLETED, { now: t });
  assert.equal(item.completedAt, t.toISOString());

  item = applyStatusChange(item, STATUS.IN_PROGRESS, { now: new Date('2026-08-31T05:00:00Z') });
  assert.equal(item.completedAt, null);
});

/* --------------------------------------------------------------- ý tưởng -- */

test('AC-10: NEEDS_REVISION và REJECTED bắt buộc nhận xét (INT-07)', () => {
  assert.equal(validateIdeaReview(IDEA_STATUS.APPROVED, '').ok, true);
  assert.equal(validateIdeaReview(IDEA_STATUS.NEEDS_REVISION, '').ok, false);
  assert.equal(validateIdeaReview(IDEA_STATUS.REJECTED, '   ').ok, false);
  assert.equal(validateIdeaReview(IDEA_STATUS.NEEDS_REVISION, 'Bổ sung chứng minh.').ok, true);
});

test('vòng đời ý tưởng: NEEDS_REVISION quay lại PENDING được, APPROVED thì không', () => {
  assert.equal(canIdeaTransition(IDEA_STATUS.NEEDS_REVISION, IDEA_STATUS.PENDING), true);
  assert.equal(canIdeaTransition(IDEA_STATUS.APPROVED, IDEA_STATUS.PENDING), false);
});

/* ------------------------------------------------------------------ hint -- */

const hintsDoc = {
  hints: [
    { id: 'H-1', level: 1, targetUserId: null },
    { id: 'H-2', level: 2, targetUserId: 'u_a' },
    { id: 'H-3', level: 3, targetUserId: 'u_b' },
  ],
};

test('AC-08: user chỉ thấy hint chung và hint gửi riêng cho mình (FR-HINT-06)', () => {
  assert.deepEqual(visibleHints(hintsDoc, 'u_a').map(h => h.id), ['H-1', 'H-2']);
  assert.deepEqual(visibleHints(hintsDoc, 'u_b').map(h => h.id), ['H-1', 'H-3']);
  assert.equal(visibleHints(hintsDoc, 'u_a', { isAdmin: true }).length, 3);
});

test('AC-07: hint phải mở tuần tự theo cấp (FR-HINT-04)', () => {
  const mine = visibleHints(hintsDoc, 'u_a');
  assert.equal(nextRevealableLevel(mine, []), 1);

  const item = { hintsRevealed: [] };
  assert.equal(canRevealHint(mine[0], mine, item), true);   // cấp 1 mở được
  assert.equal(canRevealHint(mine[1], mine, item), false);  // cấp 2 chưa

  const after = { hintsRevealed: [{ hintId: 'H-1' }] };
  assert.equal(nextRevealableLevel(mine, ['H-1']), 2);
  assert.equal(canRevealHint(mine[1], mine, after), true);
});

/* -------------------------------------------------------------- lời giải -- */

test('AC-12/13/14: lời giải cần CẢ hoàn thành lẫn grant (FR-SOL-03)', () => {
  const completed = { status: STATUS.COMPLETED };
  const inProgress = { status: STATUS.IN_PROGRESS };
  const withGrant = { grants: [{ problemId: 'P-1' }] };
  const noGrant = { grants: [] };

  // AC-12: hoàn thành nhưng chưa có grant
  assert.deepEqual(
    canViewSolution({ progressItem: completed, grantsDoc: noGrant, problemId: 'P-1', role: ROLE.USER }),
    { allowed: false, reason: 'need_grant' });

  // AC-13: có grant nhưng chưa hoàn thành
  assert.deepEqual(
    canViewSolution({ progressItem: inProgress, grantsDoc: withGrant, problemId: 'P-1', role: ROLE.USER }),
    { allowed: false, reason: 'need_complete' });

  // AC-14: đủ cả hai
  assert.equal(
    canViewSolution({ progressItem: completed, grantsDoc: withGrant, problemId: 'P-1', role: ROLE.USER }).allowed,
    true);

  // Admin luôn xem được
  assert.equal(
    canViewSolution({ progressItem: inProgress, grantsDoc: noGrant, problemId: 'P-1', role: ROLE.ADMIN }).allowed,
    true);
});

test('AC-15: grant đã thu hồi thì khoá lại', () => {
  const revoked = { grants: [{ problemId: 'P-1', revokedAt: '2026-08-30T00:00:00Z' }] };
  const res = canViewSolution({
    progressItem: { status: STATUS.COMPLETED }, grantsDoc: revoked, problemId: 'P-1', role: ROLE.USER,
  });
  assert.equal(res.allowed, false);
  assert.equal(res.reason, 'need_grant');
});

test('INT-08: chỉ cấp grant cho bài đã hoàn thành', () => {
  const done = { items: [{ problemId: 'P-1', status: STATUS.COMPLETED }] };
  const notDone = { items: [{ problemId: 'P-1', status: STATUS.IN_PROGRESS }] };
  assert.equal(canGrantSolution(done, 'P-1'), true);
  assert.equal(canGrantSolution(notDone, 'P-1'), false);
});

test('FR-SOL-08: tự cấp quyền chỉ khi bật cờ và ý tưởng đã duyệt', () => {
  const progress = { items: [{ problemId: 'P-1', status: STATUS.COMPLETED }] };
  const approved = { ideas: [{ problemId: 'P-1', status: IDEA_STATUS.APPROVED }] };
  const pending = { ideas: [{ problemId: 'P-1', status: IDEA_STATUS.PENDING }] };

  assert.equal(shouldAutoGrant({ features: { autoGrantOnApprovedIdea: false } }, progress, approved, 'P-1'), false);
  assert.equal(shouldAutoGrant({ features: { autoGrantOnApprovedIdea: true } }, progress, approved, 'P-1'), true);
  assert.equal(shouldAutoGrant({ features: { autoGrantOnApprovedIdea: true } }, progress, pending, 'P-1'), false);
});

/* ------------------------------------------------------------------ điểm -- */

test('AC-26: tính điểm bộ đề theo slot', () => {
  const set = {
    slots: [
      { slot: 'L1', problemId: 'P-1', points: 300 },
      { slot: 'L2', problemId: 'P-2', points: 200 },
      { slot: 'L3A', problemId: 'P-3', points: 200 },
      { slot: 'L3B', problemId: 'P-4', points: 300 },
    ],
  };
  const progress = {
    items: [
      { problemId: 'P-1', status: STATUS.COMPLETED },
      { problemId: 'P-2', status: STATUS.COMPLETED },
      { problemId: 'P-3', status: STATUS.HARD_STUCK },
      { problemId: 'P-4', status: STATUS.NOT_STARTED },
    ],
  };
  assert.deepEqual(scoreOfSet(set, progress), { earned: 500, max: 1000, done: 2, filled: 4, total: 4 });
});

test('RISK-10: chưa nhập ngưỡng thì không quy đổi hạng', () => {
  const noThresholds = { exam: { gradeThresholds: [{ grade: 'Lv.5', minScore: null }] } };
  assert.equal(gradeForScore(900, noThresholds), null);

  const withThresholds = {
    exam: { gradeThresholds: [
      { grade: 'Lv.5', minScore: 900 }, { grade: 'Lv.4', minScore: 800 },
      { grade: 'Lv.3', minScore: 700 }, { grade: 'Lv.2', minScore: 600 },
    ] },
  };
  assert.equal(gradeForScore(950, withThresholds), 'Lv.5');
  assert.equal(gradeForScore(800, withThresholds), 'Lv.4');
  assert.equal(gradeForScore(500, withThresholds), null);
});

/* --------------------------------------------------------------- cảnh báo -- */

test('FR-STAT-09: cảnh báo hard stuck quá 48 giờ chưa có hint', () => {
  const long = { status: STATUS.HARD_STUCK, stuckSince: '2026-08-01T00:00:00Z' };
  const now = new Date('2026-08-05T00:00:00Z');
  assert.equal(isStuckTooLong(long, { hints: [] }, 'u_a', 48, now), true);
  // Đã có hint gửi riêng cho user thì không cảnh báo nữa
  assert.equal(isStuckTooLong(long, { hints: [{ targetUserId: 'u_a' }] }, 'u_a', 48, now), false);
  // Chưa đủ 48 giờ
  const recent = { status: STATUS.HARD_STUCK, stuckSince: '2026-08-04T18:00:00Z' };
  assert.equal(isStuckTooLong(recent, { hints: [] }, 'u_a', 48, now), false);
});

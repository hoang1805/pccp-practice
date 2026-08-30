/**
 * Thống kê dẫn xuất từ dữ liệu tiến độ (FR-DASH-02…05).
 * Toàn bộ là hàm thuần để dễ kiểm thử.
 */

import { STATUS } from './constants.js';
import { todayKey, addDays, parseDateKey } from '../core/util.js';

/** Ngày (YYYY-MM-DD) có hoạt động, suy từ lịch sử chuyển trạng thái. */
export function activityDays(progressDoc) {
  const days = new Map(); // dateKey -> số sự kiện
  for (const item of progressDoc?.items || []) {
    for (const h of item.statusHistory || []) {
      if (!h.at) continue;
      const key = todayKey(new Date(h.at));
      days.set(key, (days.get(key) || 0) + 1);
    }
    if (item.completedAt) {
      const key = todayKey(new Date(item.completedAt));
      days.set(key, (days.get(key) || 0) + 1);
    }
  }
  return days;
}

/** FR-DASH-02: chuỗi ngày luyện tập liên tiếp tính tới hôm nay (hoặc hôm qua). */
export function computeStreak(progressDoc, now = new Date()) {
  const days = activityDays(progressDoc);
  if (!days.size) return 0;

  let cursor = todayKey(now);
  // Cho phép chuỗi vẫn tính nếu hôm nay chưa hoạt động nhưng hôm qua có.
  if (!days.has(cursor)) {
    cursor = addDays(cursor, -1);
    if (!days.has(cursor)) return 0;
  }
  let streak = 0;
  while (days.has(cursor)) {
    streak++;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

/** Chuỗi dài nhất từng đạt. */
export function longestStreak(progressDoc) {
  const days = [...activityDays(progressDoc).keys()].sort();
  let best = 0, cur = 0, prev = null;
  for (const d of days) {
    cur = (prev && addDays(prev, 1) === d) ? cur + 1 : 1;
    best = Math.max(best, cur);
    prev = d;
  }
  return best;
}

/**
 * FR-DASH-03: dữ liệu heatmap 12 tháng gần nhất, gom theo tuần.
 * @returns {{weeks: Array<Array<{date:string,count:number,level:number}>>, total:number}}
 */
export function heatmapData(progressDoc, { weeks = 53, now = new Date() } = {}) {
  const days = activityDays(progressDoc);
  const end = todayKey(now);
  // Lùi về Chủ nhật của tuần chứa ngày bắt đầu để cột luôn thẳng hàng.
  const startRaw = addDays(end, -(weeks * 7 - 1));
  const startDow = parseDateKey(startRaw).getDay();
  const start = addDays(startRaw, -startDow);

  const cols = [];
  let cursor = start;
  let total = 0;
  while (cursor <= end) {
    const col = [];
    for (let i = 0; i < 7; i++) {
      const count = days.get(cursor) || 0;
      total += count;
      col.push({ date: cursor, count, level: levelFor(count), future: cursor > end });
      cursor = addDays(cursor, 1);
    }
    cols.push(col);
  }
  return { weeks: cols, total };
}

function levelFor(n) {
  if (n <= 0) return 0;
  if (n === 1) return 1;
  if (n <= 3) return 2;
  if (n <= 6) return 3;
  return 4;
}

/** Tổng hợp tiến độ của một người. */
export function summarize(progressDoc, problemMap = new Map()) {
  const items = progressDoc?.items || [];
  const byLevel = { 1: 0, 2: 0, 3: 0 };
  let completed = 0, inProgress = 0, stuck = 0, minutes = 0, hintsUsed = 0, solutionsViewed = 0;

  for (const i of items) {
    minutes += i.timeSpentMinutes || 0;
    hintsUsed += (i.hintsRevealed || []).length;
    if (i.solutionViewedAt) solutionsViewed++;
    if (i.status === STATUS.COMPLETED) {
      completed++;
      const lv = problemMap.get(i.problemId)?.level;
      if (lv && byLevel[lv] != null) byLevel[lv]++;
    } else if (i.status === STATUS.IN_PROGRESS) inProgress++;
    else if (i.status === STATUS.HARD_STUCK) stuck++;
  }

  const touched = items.filter(i => i.status !== STATUS.NOT_STARTED).length;
  return {
    completed, inProgress, stuck, minutes, hintsUsed, solutionsViewed,
    byLevel, touched,
    stuckRate: touched ? Math.round((stuck / touched) * 100) : 0,
    avgMinutes: completed ? Math.round(minutes / completed) : 0,
    // Tỉ lệ tự lực: hoàn thành mà không mở gợi ý và không xem lời giải.
    selfSolved: items.filter(i =>
      i.status === STATUS.COMPLETED && !(i.hintsRevealed || []).length && !i.solutionViewedAt).length,
  };
}

/** FR-DASH-04: bảng xếp hạng nhóm. */
export function buildLeaderboard(progressByUser, users, problemMap) {
  const rows = [];
  for (const u of users) {
    const doc = progressByUser.get(u.id);
    if (!doc) continue;
    const s = summarize(doc, problemMap);
    rows.push({
      user: u,
      completed: s.completed,
      minutes: s.minutes,
      selfSolved: s.selfSolved,
      streak: computeStreak(doc),
      stuck: s.stuck,
    });
  }
  return rows.sort((a, b) =>
    b.completed - a.completed || b.selfSolved - a.selfSolved || a.minutes - b.minutes);
}

/** FR-PROB-07: số liệu tổng hợp cho từng bài tập. */
export function problemStats(progressByUser) {
  const map = new Map(); // problemId -> {completed, stuck, attempts, totalMinutes}
  for (const doc of progressByUser.values()) {
    for (const item of doc.items || []) {
      if (item.status === STATUS.NOT_STARTED) continue;
      const cur = map.get(item.problemId) ?? { completed: 0, stuck: 0, attempts: 0, totalMinutes: 0 };
      cur.attempts++;
      cur.totalMinutes += item.timeSpentMinutes || 0;
      if (item.status === STATUS.COMPLETED) cur.completed++;
      if (item.status === STATUS.HARD_STUCK) cur.stuck++;
      map.set(item.problemId, cur);
    }
  }
  for (const [, v] of map) {
    v.avgMinutes = v.completed ? Math.round(v.totalMinutes / v.completed) : 0;
    v.stuckRate = v.attempts ? Math.round((v.stuck / v.attempts) * 100) : 0;
  }
  return map;
}

/** FR-DASH-05: thành viên không hoạt động quá N ngày. */
export function inactiveUsers(progressByUser, users, days = 7, now = new Date()) {
  const cutoff = addDays(todayKey(now), -days);
  const out = [];
  for (const u of users) {
    const doc = progressByUser.get(u.id);
    const acts = [...activityDays(doc).keys()].sort();
    const last = acts[acts.length - 1] ?? null;
    if (!last || last < cutoff) out.push({ user: u, lastActive: last });
  }
  return out;
}

/** FR-EXAM-06: chuỗi điểm thi thử theo thời gian. */
export function examTrend(examsDoc) {
  return (examsDoc?.sessions || [])
    .filter(s => s.endedAt)
    .sort((a, b) => String(a.endedAt).localeCompare(String(b.endedAt)))
    .map(s => ({ at: s.endedAt, score: s.totalScore ?? 0, grade: s.grade ?? null }));
}

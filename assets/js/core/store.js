/**
 * Tầng dữ liệu — điểm truy cập duy nhất cho toàn ứng dụng.
 *
 * Trách nhiệm:
 *  - Ánh xạ khái niệm nghiệp vụ → đường dẫn file trong repo (SRS §3.1.1)
 *  - Cache đọc có TTL (SRS §3.4)
 *  - Ghi lạc quan + gộp ghi 3 giây + hàng đợi offline (SRS §3.3)
 *  - Hợp nhất theo bản ghi khi xung đột: `updatedAt` mới hơn thắng
 */

import { GitHubClient, GitHubError } from './github.js';
import * as cache from './cache.js';
import { emit, EV } from './bus.js';
import { deepClone, monthKey, nowIso } from './util.js';
import { SCHEMA_VERSION } from '../domain/constants.js';

/* --------------------------------------------------------- đường dẫn -- */
export const P = {
  config:       () => 'data/config.json',
  users:        () => 'data/users.json',
  problemIndex: () => 'data/problems/_index.json',
  problem:      id => `data/problems/${id}.json`,
  solution:     id => `data/solutions/${id}.json`,
  daily:      date => `data/daily/${date}.json`,
  personal:    uid => `data/personal/${uid}.json`,
  progress:    uid => `data/progress/${uid}.json`,
  ideas:       uid => `data/ideas/${uid}.json`,
  hints:       pid => `data/hints/${pid}.json`,
  grants:      uid => `data/grants/${uid}.json`,
  exams:       uid => `data/exams/${uid}.json`,
  audit:        ym => `data/audit/${ym}.jsonl`,
};

/* ------------------------------------------------ tài liệu mặc định -- */
export const EMPTY = {
  users:    () => ({ schemaVersion: SCHEMA_VERSION, users: [], pendingJoins: [] }),
  personal: uid => ({ schemaVersion: SCHEMA_VERSION, userId: uid, sets: [], bookmarks: [] }),
  progress: uid => ({ schemaVersion: SCHEMA_VERSION, userId: uid, items: [] }),
  ideas:    uid => ({ schemaVersion: SCHEMA_VERSION, userId: uid, ideas: [] }),
  grants:   uid => ({ schemaVersion: SCHEMA_VERSION, userId: uid, grants: [], requests: [] }),
  exams:    uid => ({ schemaVersion: SCHEMA_VERSION, userId: uid, sessions: [] }),
  hints:    pid => ({ schemaVersion: SCHEMA_VERSION, problemId: pid, hints: [] }),
  problemIndex: () => ({ schemaVersion: SCHEMA_VERSION, generatedAt: null, problems: [] }),
};

/*
 * Quy tắc hợp nhất khi hai phía cùng sửa một file. Mỗi mục mô tả mảng nào
 * được hợp nhất theo khoá nào. Trường ngoài mảng thì bên local thắng.
 */
const MERGE_RULES = [
  { re: /^data\/users\.json$/,        arrays: [['users', 'id'], ['pendingJoins', 'githubId']] },
  { re: /^data\/personal\/[^/]+$/,    arrays: [['sets', 'id'], ['bookmarks', 'problemId']] },
  { re: /^data\/progress\/[^/]+$/,    arrays: [['items', 'problemId']] },
  { re: /^data\/ideas\/[^/]+$/,       arrays: [['ideas', 'id']] },
  { re: /^data\/grants\/[^/]+$/,      arrays: [['grants', 'problemId'], ['requests', 'problemId']] },
  { re: /^data\/exams\/[^/]+$/,       arrays: [['sessions', 'id']] },
  { re: /^data\/hints\/[^/]+$/,       arrays: [['hints', 'id']] },
];

function mergeRuleFor(path) {
  return MERGE_RULES.find(r => r.re.test(path)) ?? null;
}

/**
 * Hợp nhất tài liệu local vào bản remote mới nhất.
 * Với mảng có quy tắc: gộp theo khoá, bản ghi nào `updatedAt` mới hơn thì thắng.
 * Bản ghi chỉ có ở một phía luôn được giữ lại — nhờ vậy không mất dữ liệu
 * của người khác khi hai bên ghi song song (SRS §3.3).
 */
export function mergeDocs(remote, local, path) {
  if (!remote) return local;
  if (!local) return remote;
  const rule = mergeRuleFor(path);
  if (!rule) return local; // tài liệu đơn khối: local (mới hơn) thắng

  const out = { ...remote, ...local };
  for (const [field, key] of rule.arrays) {
    const r = Array.isArray(remote[field]) ? remote[field] : [];
    const l = Array.isArray(local[field]) ? local[field] : [];
    const byKey = new Map();
    for (const item of r) byKey.set(item?.[key], item);
    for (const item of l) {
      const k = item?.[key];
      const prev = byKey.get(k);
      if (!prev) { byKey.set(k, item); continue; }
      const tPrev = Date.parse(prev.updatedAt ?? prev.createdAt ?? 0) || 0;
      const tNext = Date.parse(item.updatedAt ?? item.createdAt ?? 0) || 0;
      byKey.set(k, tNext >= tPrev ? item : prev);
    }
    out[field] = [...byKey.values()];
  }
  return out;
}

/* ------------------------------------------------------------ store -- */

const COALESCE_MS = 3000;

class Store {
  constructor() {
    /** @type {GitHubClient|null} */
    this.gh = null;
    /** @type {Map<string, any>} tài liệu đang giữ trong bộ nhớ */
    this.docs = new Map();
    /** @type {Map<string, {message:string, timer:any}>} đang chờ ghi */
    this.dirty = new Map();
    this.inflight = 0;
    this.lastSyncAt = null;
    this.lastError = null;
    this.readOnly = false;

    // Guard để module vẫn import được ngoài trình duyệt (unit test chạy trên Node).
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => this.flushQueued());
    }
  }

  attach(client) {
    this.gh = client;
    return this;
  }

  /** Xoá toàn bộ trạng thái trong bộ nhớ (dùng khi đăng xuất / đổi tài khoản). */
  reset() {
    for (const [, d] of this.dirty) clearTimeout(d.timer);
    this.dirty.clear();
    this.docs.clear();
    this.gh?.etags.clear();
  }

  get pendingCount() { return this.dirty.size; }

  _emitState(state, message) {
    emit(EV.SYNC_STATE, {
      state,
      pending: this.dirty.size,
      inflight: this.inflight,
      lastSyncAt: this.lastSyncAt,
      message,
    });
  }

  /* ------------------------------------------------------------ đọc -- */

  /**
   * Đọc một tài liệu JSON.
   * @param {string} path
   * @param {{fallback?:any, ttl?:number, force?:boolean}} opts
   */
  async read(path, { fallback = null, ttl = cache.TTL.default, force = false } = {}) {
    if (!force && this.docs.has(path)) return this.docs.get(path);

    if (!force && ttl > 0) {
      const hit = await cache.cacheGet(path, ttl);
      if (hit && !hit.stale && hit.data !== undefined) {
        this.docs.set(path, hit.data);
        return hit.data;
      }
    }

    try {
      const { data } = await this.gh.readJson(path, fallback);
      const value = data ?? fallback;
      this.docs.set(path, value);
      if (value != null) cache.cacheSet(path, value, null);
      return value;
    } catch (err) {
      // Mất mạng hoặc hết quota: rơi về cache cũ nếu có, thay vì làm hỏng trang.
      const stale = await cache.cacheGet(path, -1);
      if (stale) {
        this.docs.set(path, stale.data);
        this.lastError = err;
        this._emitState('error', err.message);
        return stale.data;
      }
      if (err instanceof GitHubError && err.status === 404) return fallback;
      throw err;
    }
  }

  /** Đọc lại bỏ qua mọi cache. */
  async refresh(path, opts = {}) {
    this.docs.delete(path);
    await cache.cacheDelete(path);
    return this.read(path, { ...opts, force: true });
  }

  /** Lấy tài liệu đang có trong bộ nhớ, không gọi mạng. */
  peek(path) { return this.docs.get(path) ?? null; }

  /* ------------------------------------------------------------ ghi -- */

  /**
   * Ghi lạc quan: cập nhật ngay trong bộ nhớ, hẹn đẩy lên GitHub sau 3 giây.
   * Nhiều thay đổi liên tiếp trên cùng file được gộp thành một commit.
   */
  save(path, data, message) {
    this.docs.set(path, data);
    cache.cacheSet(path, data, null);
    emit(EV.DATA_CHANGED, { path });

    if (this.readOnly) {
      this._emitState('error', 'Chế độ chỉ đọc — thay đổi không được lưu.');
      return Promise.resolve(false);
    }

    const prev = this.dirty.get(path);
    if (prev) clearTimeout(prev.timer);
    const timer = setTimeout(() => this._flushPath(path), COALESCE_MS);
    this.dirty.set(path, { message: message ?? prev?.message ?? `data: cập nhật ${path}`, timer });
    this._emitState('pending');
    return Promise.resolve(true);
  }

  /** Đọc–sửa–ghi tiện dụng: nhận hàm biến đổi, tự lo tài liệu mặc định. */
  async update(path, mutator, { message, fallback = null, ttl = cache.TTL.default } = {}) {
    const current = await this.read(path, { fallback: deepClone(fallback), ttl });
    const draft = deepClone(current ?? fallback);
    const next = mutator(draft) ?? draft;
    await this.save(path, next, message);
    return next;
  }

  /** Đẩy ngay một file, bỏ qua thời gian gộp. */
  async flushPath(path) {
    const entry = this.dirty.get(path);
    if (!entry) return true;
    clearTimeout(entry.timer);
    return this._flushPath(path);
  }

  async _flushPath(path) {
    const entry = this.dirty.get(path);
    if (!entry) return true;
    const local = this.docs.get(path);
    this.dirty.delete(path);

    this.inflight++;
    this._emitState('busy');
    try {
      await this.gh.updateJson(path, remote => mergeDocs(remote, local, path), {
        message: entry.message,
        fallback: null,
      });
      this.lastSyncAt = nowIso();
      this.lastError = null;
      await cache.queueDelete(path);
      return true;
    } catch (err) {
      this.lastError = err;
      if (err.offline || err.status === 0) {
        // Mất mạng: giữ lại để đồng bộ khi có kết nối trở lại.
        await cache.queuePut(path, local, entry.message);
        this.dirty.set(path, { message: entry.message, timer: setTimeout(() => this._flushPath(path), 30_000) });
        this._emitState('pending', 'Mất kết nối — thay đổi đang chờ đồng bộ.');
      } else {
        await cache.queuePut(path, local, entry.message);
        this._emitState('error', err.message);
        emit(EV.TOAST, { type: 'err', text: `Lưu thất bại: ${err.message}` });
      }
      return false;
    } finally {
      this.inflight--;
      if (this.inflight === 0 && this.dirty.size === 0 && !this.lastError) this._emitState('idle');
      else if (this.inflight === 0) this._emitState(this.lastError ? 'error' : 'pending');
    }
  }

  /** Đẩy hết mọi thay đổi đang chờ (gọi trước khi đăng xuất / rời trang). */
  async flushAll() {
    const paths = [...this.dirty.keys()];
    const results = await Promise.all(paths.map(p => this.flushPath(p)));
    return results.every(Boolean);
  }

  /** Thử lại các thay đổi bị kẹt trong hàng đợi offline. */
  async flushQueued() {
    if (!this.gh?.authenticated || this.readOnly) return;
    const queued = await cache.queueGetAll();
    if (!queued.length) return;
    this._emitState('busy', 'Đang đồng bộ thay đổi ngoại tuyến…');
    for (const item of queued) {
      try {
        await this.gh.updateJson(item.path, remote => mergeDocs(remote, item.data, item.path), {
          message: item.message,
          fallback: null,
        });
        await cache.queueDelete(item.path);
        this.dirty.delete(item.path);
        this.docs.delete(item.path);
      } catch (err) {
        if (err.offline) break; // vẫn chưa có mạng, dừng lại
        console.warn('[store] không đồng bộ được', item.path, err);
      }
    }
    this.lastSyncAt = nowIso();
    this._emitState(this.dirty.size ? 'pending' : 'idle');
  }

  /* ------------------------------------------------- nhật ký (JSONL) -- */

  /**
   * Ghi một dòng nhật ký. Cố tình không chặn luồng chính và không báo lỗi
   * ra người dùng: nhật ký hỏng không được phép làm hỏng thao tác nghiệp vụ.
   */
  audit(actorId, action, target, extra = {}) {
    if (!this.gh?.authenticated || this.readOnly) return;
    const line = JSON.stringify({ at: nowIso(), actor: actorId, action, target, ...extra, result: 'OK' });
    const path = P.audit(monthKey());
    this.gh.appendLine(path, line, `data(audit): ${action} ${target ?? ''}`.trim())
      .catch(err => console.warn('[store] không ghi được nhật ký', err));
  }
}

export const store = new Store();

/**
 * Client "cục bộ" — cùng giao diện với GitHubClient nhưng không gọi mạng.
 *
 * Đọc: lấy thẳng file trong thư mục `data/` được server tĩnh phục vụ.
 * Ghi: lưu vào IndexedDB của trình duyệt, KHÔNG đẩy lên đâu cả.
 *
 * Dùng cho hai tình huống:
 *  - chạy thử ở máy cá nhân (`npm run serve`) khi chưa có repo thật
 *  - chế độ dùng thử / ngoại tuyến (SRS FR-AUTH-08)
 *
 * Mọi thay đổi chỉ nằm trong trình duyệt này. Xoá dữ liệu site là mất hết.
 */

import { GitHubError } from './github.js';

const DB_NAME = 'pccp-local-data';
const STORE = 'files';

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise(resolve => {
    let req;
    try { req = indexedDB.open(DB_NAME, 1); } catch { return resolve(null); }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'path' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
  return dbPromise;
}

function idb(db, mode, fn) {
  return new Promise(resolve => {
    let request;
    try {
      const t = db.transaction(STORE, mode);
      request = fn(t.objectStore(STORE));
      t.oncomplete = () => {
        const isReq = request != null && typeof request === 'object' && 'result' in request;
        resolve(isReq ? request.result : request);
      };
      t.onerror = t.onabort = () => resolve(undefined);
    } catch { resolve(undefined); }
  });
}

export class LocalClient {
  constructor({ baseUrl = '.' } = {}) {
    this.owner = '(cục bộ)';
    this.repo = 'data/';
    this.branch = 'local';
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.token = 'local';
    this.etags = new Map();
    this.rateLimit = { limit: null, remaining: null, resetAt: null };
    this.isLocal = true;
  }

  get authenticated() { return true; }
  setToken() { /* chế độ cục bộ không dùng token */ }

  /** Danh tính giả lập để luồng đăng nhập chạy được mà không cần GitHub. */
  async getAuthenticatedUser() {
    return {
      id: 0,
      login: 'local',
      name: 'Người dùng cục bộ',
      avatar_url: null,
    };
  }

  async checkWriteAccess() { return true; }

  async _overlayGet(path) {
    const db = await openDb();
    if (!db) return undefined;
    return idb(db, 'readonly', os => os.get(path));
  }

  async _overlayPut(path, text) {
    const db = await openDb();
    if (!db) throw new GitHubError('Trình duyệt không cho phép lưu dữ liệu cục bộ.', { status: 500, path });
    await idb(db, 'readwrite', os => os.put({ path, text, at: Date.now() }));
  }

  async readFile(path) {
    // Bản ghi đè trong IndexedDB luôn thắng file gốc trên đĩa.
    const rec = await this._overlayGet(path);
    if (rec) return rec.deleted ? null : { text: rec.text, sha: `local-${rec.at}` };

    let res;
    try {
      res = await fetch(`${this.baseUrl}/${path}`, { cache: 'no-cache' });
    } catch (cause) {
      const err = new GitHubError('Không đọc được file cục bộ.', { status: 0, path });
      err.offline = true;
      err.cause = cause;
      throw err;
    }
    if (res.status === 404) return null;
    if (!res.ok) throw new GitHubError(`Không đọc được ${path} (HTTP ${res.status}).`, { status: res.status, path });

    const text = await res.text();
    // Server tĩnh trả index.html cho đường dẫn lạ — đừng nhận nhầm là JSON.
    if (/^\s*<!doctype html/i.test(text)) return null;
    return { text, sha: 'disk' };
  }

  async readJson(path, fallback = null) {
    const file = await this.readFile(path);
    if (file === null) return { data: fallback, sha: null, missing: true };
    try {
      return { data: JSON.parse(file.text), sha: file.sha, missing: false };
    } catch {
      throw new GitHubError(`${path} không phải JSON hợp lệ.`, { status: 422, path });
    }
  }

  async getFreshSha(path) {
    const f = await this.readFile(path);
    return f ? f.sha : null;
  }

  async writeFile(path, text) {
    await this._overlayPut(path, text);
    return `local-${Date.now()}`;
  }

  async writeJson(path, data) {
    return this.writeFile(path, JSON.stringify(data, null, 2) + '\n');
  }

  /** Không có xung đột vì chỉ có một người ghi — cứ đọc, sửa, ghi. */
  async updateJson(path, mutator, { fallback = null } = {}) {
    const { data } = await this.readJson(path, fallback);
    const next = mutator(data);
    if (next === undefined) return { data, sha: null, skipped: true };
    const sha = await this.writeJson(path, next);
    return { data: next, sha, skipped: false };
  }

  async appendLine(path, line) {
    const file = await this.readFile(path);
    const prev = file?.text ?? '';
    const next = prev && !prev.endsWith('\n') ? `${prev}\n${line}\n` : `${prev}${line}\n`;
    return this.writeFile(path, next);
  }

  /** Không liệt kê được thư mục qua HTTP tĩnh — trả rỗng, tầng trên đã chịu được. */
  async listDir() { return []; }

  async deleteFile(path) {
    const db = await openDb();
    if (!db) return false;
    await idb(db, 'readwrite', os => os.put({ path, deleted: true, at: Date.now() }));
    return true;
  }

  /** Xoá mọi thay đổi cục bộ, quay về đúng nội dung file trên đĩa. */
  async resetOverlay() {
    const db = await openDb();
    if (!db) return;
    await idb(db, 'readwrite', os => os.clear());
  }

  /** Số file đang bị ghi đè trong trình duyệt. */
  async overlayCount() {
    const db = await openDb();
    if (!db) return 0;
    const n = await idb(db, 'readonly', os => os.count());
    return typeof n === 'number' ? n : 0;
  }
}

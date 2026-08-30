/**
 * Client GitHub REST API — tầng duy nhất được phép gọi mạng.
 * Tham chiếu SRS §3.3 (ghi + xử lý 409) và §3.4 (đọc + cache ETag).
 */

import { b64encode, b64decode, sleep } from './util.js';

const API = 'https://api.github.com';
const RAW = 'https://raw.githubusercontent.com';

export class GitHubError extends Error {
  constructor(message, { status = 0, path = '', body = null } = {}) {
    super(message);
    this.name = 'GitHubError';
    this.status = status;
    this.path = path;
    this.body = body;
  }
}

/** Lỗi riêng cho xung đột sha để tầng trên phân biệt và thử lại. */
export class ConflictError extends GitHubError {
  constructor(path) {
    super(`Xung đột khi ghi ${path}`, { status: 409, path });
    this.name = 'ConflictError';
  }
}

export class GitHubClient {
  /**
   * @param {{owner:string, repo:string, branch?:string, token?:string|null}} opts
   */
  constructor({ owner, repo, branch = 'main', token = null }) {
    this.owner = owner;
    this.repo = repo;
    this.branch = branch;
    this.token = token;
    /** @type {Map<string,{etag:string, text:string, sha:string}>} */
    this.etags = new Map();
    this.rateLimit = { limit: null, remaining: null, resetAt: null };
  }

  get authenticated() { return Boolean(this.token); }

  setToken(token) {
    this.token = token || null;
    // Cache ETag gắn với chế độ xác thực nên phải xoá khi đổi token.
    this.etags.clear();
  }

  _headers(extra = {}) {
    const h = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...extra,
    };
    if (this.token) h.Authorization = `Bearer ${this.token}`;
    return h;
  }

  _trackRate(res) {
    const lim = res.headers.get('x-ratelimit-limit');
    const rem = res.headers.get('x-ratelimit-remaining');
    const rst = res.headers.get('x-ratelimit-reset');
    if (lim != null) this.rateLimit.limit = Number(lim);
    if (rem != null) this.rateLimit.remaining = Number(rem);
    if (rst != null) this.rateLimit.resetAt = new Date(Number(rst) * 1000).toISOString();
  }

  async _fetch(url, init = {}) {
    let res;
    try {
      res = await fetch(url, init);
    } catch (cause) {
      // Lỗi mạng: phân biệt rõ với lỗi HTTP để tầng trên xếp hàng offline.
      const err = new GitHubError('Không kết nối được tới GitHub', { status: 0 });
      err.offline = true;
      err.cause = cause;
      throw err;
    }
    this._trackRate(res);
    return res;
  }

  /** Thông tin tài khoản gắn với token hiện tại. */
  async getAuthenticatedUser() {
    const res = await this._fetch(`${API}/user`, { headers: this._headers() });
    if (res.status === 401) throw new GitHubError('Token không hợp lệ hoặc đã hết hạn.', { status: 401 });
    if (!res.ok) throw new GitHubError(`Không lấy được thông tin tài khoản (HTTP ${res.status}).`, { status: res.status });
    return res.json();
  }

  /** Kiểm tra token có quyền ghi repo hay không (FR-AUTH-07). */
  async checkWriteAccess() {
    if (!this.token) return false;
    const res = await this._fetch(`${API}/repos/${this.owner}/${this.repo}`, { headers: this._headers() });
    if (!res.ok) return false;
    const repo = await res.json();
    return Boolean(repo?.permissions?.push);
  }

  /**
   * Đọc một file. Trả về null nếu file chưa tồn tại (404).
   * @returns {Promise<{text:string, sha:string}|null>}
   */
  async readFile(path) {
    // Khách chưa đăng nhập chỉ có 60 request/giờ theo IP, nên đọc qua raw CDN
    // (không giới hạn, đổi lại có thể trễ tới ~5 phút — chấp nhận được cho GUEST).
    if (!this.token) {
      const raw = await this._readRaw(path);
      if (raw !== null) return { text: raw, sha: null };
      // raw trả 404 có thể do CDN chưa kịp cập nhật; thử lại qua API.
    }

    const url = `${API}/repos/${this.owner}/${this.repo}/contents/${encodeURI(path)}?ref=${encodeURIComponent(this.branch)}`;
    const cached = this.etags.get(path);
    const headers = this._headers(cached ? { 'If-None-Match': cached.etag } : {});

    const res = await this._fetch(url, { headers });

    // 304 không tính vào rate limit — dùng lại nội dung đã cache.
    if (res.status === 304 && cached) return { text: cached.text, sha: cached.sha };
    if (res.status === 404) return null;
    if (res.status === 403 && this.rateLimit.remaining === 0) {
      throw new GitHubError('Đã hết hạn mức GitHub API. Vui lòng thử lại sau.', { status: 403, path });
    }
    if (!res.ok) throw new GitHubError(`Không đọc được ${path} (HTTP ${res.status}).`, { status: res.status, path });

    const json = await res.json();
    if (Array.isArray(json)) throw new GitHubError(`${path} là thư mục, không phải file.`, { status: 400, path });
    if (json.content == null) {
      // File > 1MB không trả content kèm — vượt ràng buộc CON-04.
      throw new GitHubError(`${path} quá lớn để đọc qua Contents API.`, { status: 413, path });
    }

    const text = b64decode(json.content);
    const etag = res.headers.get('etag');
    if (etag) this.etags.set(path, { etag, text, sha: json.sha });
    return { text, sha: json.sha };
  }

  async _readRaw(path) {
    const url = `${RAW}/${this.owner}/${this.repo}/${this.branch}/${encodeURI(path)}`;
    const res = await this._fetch(url, { cache: 'no-cache' });
    if (res.status === 404) return null;
    if (!res.ok) throw new GitHubError(`Không đọc được ${path} (HTTP ${res.status}).`, { status: res.status, path });
    return res.text();
  }

  /** Đọc và parse JSON. Trả về `fallback` nếu file chưa tồn tại. */
  async readJson(path, fallback = null) {
    const file = await this.readFile(path);
    if (file === null) return { data: fallback, sha: null, missing: true };
    try {
      return { data: JSON.parse(file.text), sha: file.sha, missing: false };
    } catch {
      throw new GitHubError(`${path} không phải JSON hợp lệ.`, { status: 422, path });
    }
  }

  /** Lấy sha mới nhất của file (bỏ qua cache ETag) — dùng trước khi ghi lại sau 409. */
  async getFreshSha(path) {
    this.etags.delete(path);
    const file = await this.readFile(path);
    return file ? file.sha : null;
  }

  /**
   * Ghi đè một file. `sha` là null khi tạo mới.
   * Ném ConflictError khi sha đã lỗi thời.
   */
  async writeFile(path, text, message, sha = null) {
    if (!this.token) throw new GitHubError('Cần đăng nhập để ghi dữ liệu.', { status: 401, path });

    const url = `${API}/repos/${this.owner}/${this.repo}/contents/${encodeURI(path)}`;
    const body = {
      message,
      content: b64encode(text),
      branch: this.branch,
    };
    if (sha) body.sha = sha;

    const res = await this._fetch(url, {
      method: 'PUT',
      headers: this._headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
    });

    // 409 = sha lỗi thời. 422 kèm thông báo "does not match" cũng là xung đột.
    if (res.status === 409) throw new ConflictError(path);
    if (res.status === 422) {
      const detail = await res.json().catch(() => ({}));
      if (/sha|does not match|already exists/i.test(detail?.message || '')) throw new ConflictError(path);
      throw new GitHubError(detail?.message || `Ghi ${path} thất bại (HTTP 422).`, { status: 422, path, body: detail });
    }
    if (res.status === 401) throw new GitHubError('Token không hợp lệ hoặc đã hết hạn.', { status: 401, path });
    if (res.status === 403) throw new GitHubError('Token không có quyền ghi vào repo này.', { status: 403, path });
    if (!res.ok) {
      const detail = await res.json().catch(() => ({}));
      throw new GitHubError(detail?.message || `Ghi ${path} thất bại (HTTP ${res.status}).`, { status: res.status, path, body: detail });
    }

    const json = await res.json();
    const newSha = json?.content?.sha ?? null;
    // Nội dung vừa ghi chắc chắn là mới nhất — nạp lại vào cache để đọc-sau-ghi đúng.
    this.etags.delete(path);
    return newSha;
  }

  async writeJson(path, data, message, sha = null) {
    return this.writeFile(path, JSON.stringify(data, null, 2) + '\n', message, sha);
  }

  /**
   * Read-modify-write an toàn: đọc bản mới nhất, áp dụng `mutator`, ghi lại.
   * Khi gặp xung đột sẽ đọc lại và **áp dụng lại mutator trên dữ liệu mới**,
   * nhờ đó thay đổi của người khác không bị ghi đè (SRS §3.3).
   *
   * @param {string} path
   * @param {(data:any)=>any} mutator  nhận dữ liệu hiện tại, trả về dữ liệu mới
   * @param {{message:string, fallback?:any, retries?:number}} opts
   */
  async updateJson(path, mutator, { message, fallback = null, retries = 3 } = {}) {
    let attempt = 0;
    for (;;) {
      const { data, sha } = await this.readJson(path, fallback);
      const next = mutator(data);
      if (next === undefined) return { data, sha, skipped: true };
      try {
        const newSha = await this.writeJson(path, next, message, sha);
        return { data: next, sha: newSha, skipped: false };
      } catch (err) {
        if (!(err instanceof ConflictError) || attempt >= retries) throw err;
        attempt++;
        // Backoff 400ms → 1200ms → 3600ms, đồng thời bỏ cache để đọc sha tươi.
        this.etags.delete(path);
        await sleep(400 * 3 ** (attempt - 1));
      }
    }
  }

  /** Nối thêm dòng vào file JSONL (nhật ký kiểm toán). */
  async appendLine(path, line, message) {
    let attempt = 0;
    for (;;) {
      const file = await this.readFile(path);
      const prev = file?.text ?? '';
      const next = prev && !prev.endsWith('\n') ? `${prev}\n${line}\n` : `${prev}${line}\n`;
      try {
        return await this.writeFile(path, next, message, file?.sha ?? null);
      } catch (err) {
        if (!(err instanceof ConflictError) || attempt >= 3) throw err;
        attempt++;
        this.etags.delete(path);
        await sleep(400 * 3 ** (attempt - 1));
      }
    }
  }

  /** Liệt kê tên file trong một thư mục. Trả về [] nếu thư mục chưa tồn tại. */
  async listDir(path) {
    const url = `${API}/repos/${this.owner}/${this.repo}/contents/${encodeURI(path)}?ref=${encodeURIComponent(this.branch)}`;
    const res = await this._fetch(url, { headers: this._headers() });
    if (res.status === 404) return [];
    if (!res.ok) throw new GitHubError(`Không liệt kê được ${path} (HTTP ${res.status}).`, { status: res.status, path });
    const json = await res.json();
    return Array.isArray(json) ? json.filter(e => e.type === 'file').map(e => ({ name: e.name, path: e.path, sha: e.sha, size: e.size })) : [];
  }

  async deleteFile(path, message) {
    const file = await this.readFile(path);
    if (!file) return false;
    const res = await this._fetch(`${API}/repos/${this.owner}/${this.repo}/contents/${encodeURI(path)}`, {
      method: 'DELETE',
      headers: this._headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ message, sha: file.sha, branch: this.branch }),
    });
    if (!res.ok) throw new GitHubError(`Xoá ${path} thất bại (HTTP ${res.status}).`, { status: res.status, path });
    this.etags.delete(path);
    return true;
  }
}

/**
 * Suy ra owner/repo từ URL GitHub Pages: `<owner>.github.io/<repo>/`.
 * Trả về null khi chạy ở localhost — khi đó dùng cấu hình thủ công.
 */
export function detectRepoFromLocation(loc = window.location) {
  const m = /^([a-z0-9-]+)\.github\.io$/i.exec(loc.hostname);
  if (!m) return null;
  const owner = m[1];
  const seg = loc.pathname.split('/').filter(Boolean)[0];
  // Trang `<owner>.github.io` gốc tương ứng repo cùng tên.
  return { owner, repo: seg || `${owner}.github.io` };
}

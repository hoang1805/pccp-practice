/**
 * Xác thực bằng GitHub fine-grained PAT và phân giải vai trò.
 * Tham chiếu SRS §3.2, FR-AUTH-01…08.
 *
 * Lưu ý thiết kế: không có OAuth vì luồng đổi code→token cần client_secret,
 * tức là cần server — vi phạm ràng buộc CON-01 "chỉ dùng GitHub".
 */

import { GitHubClient, detectRepoFromLocation } from './github.js';
import { LocalClient } from './local-client.js';
import { store, P, EMPTY } from './store.js';
import { emit, EV } from './bus.js';
import { nowIso, uid } from './util.js';
import { ROLE } from '../domain/constants.js';
import { TTL } from './cache.js';

const K_TOKEN   = 'pccp.auth.token';
const K_EXPIRES = 'pccp.auth.expiresHint';
const K_REPO    = 'pccp.repo';

/** Phiên hiện tại. `null` nghĩa là chưa khởi tạo. */
export const session = {
  token: null,
  githubId: null,
  githubLogin: null,
  avatarUrl: null,
  user: null,          // bản ghi trong users.json
  role: null,          // USER | ADMIN | null
  isGuest: true,
  isPending: false,    // đã gửi yêu cầu tham gia, chờ admin duyệt
  canWrite: false,
  expiresHint: null,
};

/* ------------------------------------------------------- cấu hình repo -- */

export function getRepoConfig() {
  try {
    const saved = JSON.parse(localStorage.getItem(K_REPO) || 'null');
    if (saved?.mode === 'local') return saved;
    if (saved?.owner && saved?.repo) return saved;
  } catch { /* bỏ qua giá trị hỏng */ }
  return detectRepoFromLocation();
}

export function setRepoConfig(cfg) {
  const value = cfg.mode === 'local'
    ? { mode: 'local' }
    : { owner: cfg.owner, repo: cfg.repo, branch: cfg.branch || 'main' };
  localStorage.setItem(K_REPO, JSON.stringify(value));
}

export function clearRepoConfig() {
  localStorage.removeItem(K_REPO);
}

/* ------------------------------------------------------------- client -- */

/** @type {GitHubClient|null} */
export let gh = null;

export function initClient() {
  const cfg = getRepoConfig();
  if (!cfg) return null;

  // Chế độ cục bộ: đọc thẳng data/ trên đĩa, ghi vào IndexedDB.
  if (cfg.mode === 'local') {
    gh = new LocalClient();
    store.attach(gh);
    return gh;
  }

  gh = new GitHubClient({
    owner: cfg.owner,
    repo: cfg.repo,
    branch: cfg.branch || 'main',
    token: localStorage.getItem(K_TOKEN),
  });
  store.attach(gh);
  return gh;
}

/* -------------------------------------------------------------- phiên -- */

function applyGuest() {
  Object.assign(session, {
    token: null, githubId: null, githubLogin: null, avatarUrl: null,
    user: null, role: null, isGuest: true, isPending: false, canWrite: false,
    expiresHint: null,
  });
  store.readOnly = true;
  emit(EV.AUTH_CHANGED, session);
  return session;
}

/**
 * Khôi phục phiên từ token đã lưu. Gọi một lần lúc khởi động.
 * Token hỏng/hết hạn sẽ tự bị xoá và phiên rơi về GUEST.
 */
export async function restoreSession() {
  if (!gh) return applyGuest();

  // Chế độ cục bộ không có token — vào thẳng phiên làm việc.
  if (gh.isLocal) {
    try { return await establish('local', null); }
    catch (err) {
      console.warn('[auth] chế độ cục bộ lỗi:', err.message);
      return applyGuest();
    }
  }

  const token = localStorage.getItem(K_TOKEN);
  if (!token) return applyGuest();
  gh.setToken(token);
  try {
    return await establish(token, localStorage.getItem(K_EXPIRES));
  } catch (err) {
    console.warn('[auth] không khôi phục được phiên:', err.message);
    if (err.status === 401) {
      localStorage.removeItem(K_TOKEN);
      localStorage.removeItem(K_EXPIRES);
      gh.setToken(null);
      emit(EV.TOAST, { type: 'warn', text: 'Token đã hết hạn. Vui lòng đăng nhập lại.' });
    }
    return applyGuest();
  }
}

/** Đăng nhập bằng token người dùng dán vào (FR-AUTH-01). */
export async function loginWithToken(token, expiresHint = null) {
  if (!gh) throw new Error('Chưa cấu hình repository.');
  const clean = String(token || '').trim();
  if (!clean) throw new Error('Vui lòng nhập token.');

  gh.setToken(clean);
  const result = await establish(clean, expiresHint);

  localStorage.setItem(K_TOKEN, clean);
  if (expiresHint) localStorage.setItem(K_EXPIRES, expiresHint);
  else localStorage.removeItem(K_EXPIRES);

  store.audit(session.user?.id ?? session.githubLogin, 'LOGIN', session.githubLogin);
  return result;
}

/** Xác thực token, tra vai trò trong users.json, tạo yêu cầu tham gia nếu cần. */
async function establish(token, expiresHint) {
  const me = await gh.getAuthenticatedUser();

  Object.assign(session, {
    token,
    githubId: me.id,
    githubLogin: me.login,
    avatarUrl: me.avatar_url,
    isGuest: false,
    expiresHint: expiresHint || null,
  });

  // FR-AUTH-07: token chỉ đọc vẫn dùng được, nhưng phải báo rõ.
  session.canWrite = await gh.checkWriteAccess();
  store.readOnly = !session.canWrite;

  const users = await store.read(P.users(), { fallback: EMPTY.users(), ttl: TTL.users, force: true });
  let record = (users.users || []).find(u => u.githubId === me.id || u.githubLogin === me.login);

  // Bootstrap: repo mới toanh chưa có thành viên nào. Người đầu tiên đăng nhập
  // được với quyền ghi sẽ thành quản trị viên — nếu không thì không ai duyệt
  // được ai, hệ thống sẽ kẹt vĩnh viễn.
  if (!record && !(users.users || []).length && session.canWrite) {
    record = await bootstrapFirstAdmin(users, me);
  }

  if (record && record.active !== false && !record.deletedAt) {
    session.user = record;
    session.role = record.role || ROLE.USER;
    session.isPending = false;
  } else if (record) {
    // Bị vô hiệu hoá hoặc đã xoá mềm → hạ về quyền GUEST (FR-USER-04).
    session.user = null;
    session.role = null;
    session.isPending = false;
    emit(EV.TOAST, { type: 'warn', text: 'Tài khoản của bạn đang bị vô hiệu hoá. Bạn chỉ có quyền xem.' });
  } else {
    session.user = null;
    session.role = null;
    session.isPending = true;
    await requestJoin(me);
  }

  emit(EV.AUTH_CHANGED, session);
  return session;
}

/**
 * Tạo quản trị viên đầu tiên cho một repo trống.
 * Chỉ chạy đúng một lần: ngay khi có bản ghi đầu tiên, nhánh này không vào nữa.
 */
async function bootstrapFirstAdmin(users, me) {
  const record = {
    id: uid('u_'),
    githubId: me.id,
    githubLogin: me.login,
    displayName: me.name || me.login,
    avatarUrl: me.avatar_url ?? null,
    role: ROLE.ADMIN,
    active: true,
    primaryLanguage: null,
    targetScore: null,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'Asia/Ho_Chi_Minh',
    joinedAt: nowIso(),
    lastActiveAt: nowIso(),
    deletedAt: null,
    updatedAt: nowIso(),
  };
  const next = { ...users, users: [record], pendingJoins: users.pendingJoins ?? [] };
  await store.save(P.users(), next, `data(user): khởi tạo quản trị viên đầu tiên ${me.login}`);
  await store.flushPath(P.users());
  store.audit(record.id, 'USER_APPROVE', me.login);
  emit(EV.TOAST, {
    type: 'ok',
    text: `Repo chưa có thành viên nào — bạn được đặt làm quản trị viên đầu tiên.`,
  });
  return record;
}

/** FR-AUTH-03: tạo yêu cầu tham gia cho tài khoản GitHub chưa có trong danh bạ. */
async function requestJoin(me) {
  if (!session.canWrite) return;
  const users = await store.read(P.users(), { fallback: EMPTY.users(), ttl: 0, force: true });
  const already = (users.pendingJoins || []).some(p => p.githubId === me.id);
  if (already) return;

  const next = {
    ...users,
    pendingJoins: [...(users.pendingJoins || []), {
      githubId: me.id,
      githubLogin: me.login,
      avatarUrl: me.avatar_url,
      requestedAt: nowIso(),
      note: '',
    }],
  };
  await store.save(P.users(), next, `data(user): yêu cầu tham gia ${me.login}`);
  await store.flushPath(P.users());
  store.audit(me.login, 'JOIN_REQUEST', me.login);
}

/** FR-AUTH-04: xoá sạch token và dữ liệu cá nhân đã cache. */
export async function logout() {
  try { await store.flushAll(); } catch { /* vẫn đăng xuất kể cả khi đẩy lỗi */ }
  localStorage.removeItem(K_TOKEN);
  localStorage.removeItem(K_EXPIRES);
  gh?.setToken(null);
  store.reset();
  store.readOnly = true;
  applyGuest();
}

/* ------------------------------------------------------------ quyền -- */

/** Đang chạy ở chế độ cục bộ (không đồng bộ lên GitHub). */
export function isLocalMode() { return Boolean(gh?.isLocal); }

export function isAdmin() { return session.role === ROLE.ADMIN; }
export function isMember() { return session.role != null; }
export function userId() { return session.user?.id ?? null; }

/** Chỉ chính chủ hoặc admin mới được ghi dữ liệu của một user. */
export function canWriteUserData(targetUserId) {
  if (!session.canWrite) return false;
  if (isAdmin()) return true;
  return Boolean(targetUserId) && targetUserId === userId();
}

/** FR-AUTH-06: cảnh báo token sắp hết hạn trong 7 ngày tới. */
export function tokenExpiryWarning() {
  if (!session.expiresHint) return null;
  const d = new Date(session.expiresHint);
  if (Number.isNaN(+d)) return null;
  const days = Math.ceil((d - Date.now()) / 86400000);
  if (days < 0) return { days, text: 'Token đã hết hạn theo ghi chú của bạn.' };
  if (days <= 7) return { days, text: `Token sẽ hết hạn sau ${days} ngày. Hãy tạo token mới.` };
  return null;
}

/** Sinh id nội bộ cho user mới (không dùng githubId để tránh lộ số ID). */
export function newUserId() { return uid('u_'); }

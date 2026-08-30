/**
 * Điểm khởi động ứng dụng.
 * Thứ tự: theme → client GitHub → phiên đăng nhập → route → bàn phím.
 */

import { route, setNotFound, setGuard, startRouter, navigate, currentRoute } from './core/router.js';
import { initClient, restoreSession, session, isAdmin, isMember, getRepoConfig } from './core/auth.js';
import { store } from './core/store.js';
import { initTheme, renderHeader, renderFooter, setMain, pageShell } from './ui/layout.js';
import { initMarkdown } from './ui/markdown.js';
import { toast } from './ui/components.js';
import { escapeHtml } from './core/util.js';
import { refreshNavCounters } from './domain/service.js';

/* ------------------------------------------------------- nạp trang lười -- */
const page = loader => async ctx => {
  const mod = await loader();
  return mod.render(ctx);
};

route('/',                 page(() => import('./pages/home.js')));
route('/login',            page(() => import('./pages/login.js')));
route('/setup',            page(() => import('./pages/setup.js')));
route('/problems',         page(() => import('./pages/problems.js')));
route('/problems/:id',     page(() => import('./pages/problem-detail.js')));
route('/calendar',         page(() => import('./pages/calendar.js')));
route('/sets/:date',       page(() => import('./pages/set-detail.js')));
route('/exam',             page(() => import('./pages/exam.js')),  { member: true });
route('/me',               page(() => import('./pages/me.js')),    { member: true });

route('/admin',            page(() => import('./pages/admin/dashboard.js')), { admin: true });
route('/admin/users',      page(() => import('./pages/admin/users.js')),     { admin: true });
route('/admin/problems',   page(() => import('./pages/admin/problems.js')),  { admin: true });
route('/admin/sets',       page(() => import('./pages/admin/sets.js')),      { admin: true });
route('/admin/ideas',      page(() => import('./pages/admin/ideas.js')),     { admin: true });
route('/admin/stuck',      page(() => import('./pages/admin/stuck.js')),     { admin: true });
route('/admin/grants',     page(() => import('./pages/admin/grants.js')),    { admin: true });
route('/admin/settings',   page(() => import('./pages/admin/settings.js')),  { admin: true });
route('/admin/audit',      page(() => import('./pages/admin/audit.js')),     { admin: true });

setNotFound(({ path }) => {
  setMain(pageShell(`
    <div class="empty">
      <h3>Không tìm thấy trang</h3>
      <p class="muted">Đường dẫn <code>${escapeHtml(path)}</code> không tồn tại.</p>
      <a class="btn btn-primary" href="#/">Về trang chủ</a>
    </div>`, { narrow: true }));
});

/* ------------------------------------------------------------- chặn route -- */
setGuard(({ path, meta }) => {
  if (!getRepoConfig() && path !== '/setup') return '/setup';
  if (meta.admin && !isAdmin()) {
    toast('Khu vực này chỉ dành cho quản trị viên.', 'warn');
    return session.isGuest ? '/login' : '/';
  }
  if (meta.member && !isMember()) {
    toast('Bạn cần đăng nhập để dùng chức năng này.', 'warn');
    return '/login';
  }
  return null;
});

/* ---------------------------------------------------------------- phím tắt -- */
function initShortcuts() {
  document.addEventListener('keydown', e => {
    const tag = document.activeElement?.tagName;
    const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
      || document.activeElement?.isContentEditable;
    if (typing || e.metaKey || e.ctrlKey || e.altKey) return;

    // "/" nhảy tới ô tìm kiếm nếu trang có (UI-08).
    if (e.key === '/') {
      const search = document.querySelector('input[type="search"]');
      if (search) { e.preventDefault(); search.focus(); }
      return;
    }
    // "g" rồi "h" về trang chủ.
    if (e.key === 'g') {
      const onNext = ev => {
        document.removeEventListener('keydown', onNext, true);
        if (ev.key === 'h') { ev.preventDefault(); navigate('/'); }
        else if (ev.key === 'p') { ev.preventDefault(); navigate('/problems'); }
        else if (ev.key === 'c') { ev.preventDefault(); navigate('/calendar'); }
        else if (ev.key === 'a' && isAdmin()) { ev.preventDefault(); navigate('/admin'); }
      };
      document.addEventListener('keydown', onNext, true);
      setTimeout(() => document.removeEventListener('keydown', onNext, true), 1200);
    }
  });
}

/* ------------------------------------------------------ đẩy trước khi rời -- */
function initFlushOnExit() {
  window.addEventListener('beforeunload', e => {
    if (store.pendingCount > 0) {
      // Cố đẩy nốt; trình duyệt vẫn có thể cắt ngang nên cảnh báo người dùng.
      store.flushAll();
      e.preventDefault();
      e.returnValue = '';
    }
  });
  // Tab bị ẩn là thời điểm tốt để đẩy nốt mà không chặn người dùng.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && store.pendingCount > 0) store.flushAll();
  });
}

/* ------------------------------------------------------------------ boot -- */
async function boot() {
  initTheme();

  const cfg = getRepoConfig();
  if (cfg) {
    initClient();
    try {
      await restoreSession();
    } catch (err) {
      console.error('[boot] khôi phục phiên thất bại', err);
    }
  }

  renderHeader();
  renderFooter();

  // Markdown nạp song song, không chặn hiển thị trang đầu.
  initMarkdown().then(() => {
    // Trang đã dựng trước khi thư viện sẵn sàng thì vẽ lại phần markdown.
    document.dispatchEvent(new CustomEvent('markdown-ready'));
  });

  initShortcuts();
  initFlushOnExit();

  await startRouter();

  // Đồng bộ thay đổi còn kẹt từ phiên trước và cập nhật badge trên nav.
  if (isMember()) {
    store.flushQueued().catch(() => {});
    refreshNavCounters().then(renderHeader).catch(() => {});
  }
}

boot().catch(err => {
  console.error('[boot] lỗi nghiêm trọng', err);
  setMain(pageShell(`
    <div class="note note-danger">
      <strong>Không khởi động được ứng dụng.</strong>
      <p>${escapeHtml(err.message || String(err))}</p>
      <p class="small">Thử tải lại trang, hoặc <a href="#/setup">kiểm tra cấu hình repository</a>.</p>
    </div>`, { narrow: true }));
});

// Giúp gỡ lỗi từ console của trình duyệt.
window.__pccp = { store, session, currentRoute };

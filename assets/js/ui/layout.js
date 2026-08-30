/**
 * Khung giao diện: header, điều hướng, chỉ báo đồng bộ, footer.
 */

import { html, escapeHtml, raw, timeAgo } from '../core/util.js';
import { session, isAdmin, isMember, logout, gh, isLocalMode } from '../core/auth.js';
import { store } from '../core/store.js';
import { on, EV } from '../core/bus.js';
import { isActive, navigate } from '../core/router.js';
import { modal, toast, confirmDialog } from './components.js';
import { navCounters } from '../domain/counters.js';

const K_THEME = 'pccp.theme';

/* =============================================================== theme == */

export function initTheme() {
  const saved = localStorage.getItem(K_THEME) || 'auto';
  applyTheme(saved);
}

export function applyTheme(mode) {
  const root = document.documentElement;
  if (mode === 'auto') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', mode);
  root.dataset.themeMode = mode;
  localStorage.setItem(K_THEME, mode);
}

function cycleTheme() {
  const order = ['auto', 'light', 'dark'];
  const cur = localStorage.getItem(K_THEME) || 'auto';
  const next = order[(order.indexOf(cur) + 1) % order.length];
  applyTheme(next);
  renderHeader();
  toast(`Giao diện: ${{ auto: 'theo hệ thống', light: 'sáng', dark: 'tối' }[next]}`, 'info', 1800);
}

const THEME_ICON = { auto: '◑', light: '☀', dark: '☾' };

/* =============================================================== header == */

export function renderHeader() {
  const el = document.getElementById('app-header');
  if (!el) return;
  el.hidden = false;

  const adminTotal = navCounters.pendingIdeas + navCounters.joinRequests
    + navCounters.stuck + navCounters.solutionRequests;

  const links = [
    { href: '#/', label: 'Hôm nay', path: '/' },
    { href: '#/problems', label: 'Bài tập', path: '/problems' },
    { href: '#/calendar', label: 'Lịch', path: '/calendar' },
  ];
  if (isMember()) {
    links.push({ href: '#/exam', label: 'Thi thử', path: '/exam' });
    links.push({ href: '#/me', label: 'Của tôi', path: '/me' });
  }
  if (isAdmin()) {
    links.push({ href: '#/admin', label: 'Quản trị', path: '/admin', count: adminTotal });
  }

  const themeMode = localStorage.getItem(K_THEME) || 'auto';

  el.innerHTML = `
    <div class="hdr">
      <a class="brand" href="#/">
        <span class="brand-mark" aria-hidden="true">PC</span>
        <span>PCCP Practicing</span>
      </a>
      <nav class="nav" aria-label="Điều hướng chính">
        ${links.map(l => `
          <a href="${escapeHtml(l.href)}"${isActive(l.path) ? ' aria-current="page"' : ''}>
            ${escapeHtml(l.label)}${l.count ? ` <span class="badge badge-danger">${l.count}</span>` : ''}
          </a>`).join('')}
      </nav>
      <div class="hdr-right">
        <span id="sync-chip" class="sync-chip"></span>
        <button class="btn btn-ghost btn-icon" id="theme-btn"
                title="Giao diện: ${escapeHtml(themeMode)}" aria-label="Đổi giao diện">
          ${THEME_ICON[themeMode]}
        </button>
        ${userChipHtml()}
      </div>
    </div>`;

  el.querySelector('#theme-btn')?.addEventListener('click', cycleTheme);
  el.querySelector('#user-btn')?.addEventListener('click', openUserMenu);
  el.querySelector('#login-btn')?.addEventListener('click', () => navigate('/login'));
  renderSyncChip(lastSyncState);
}

function userChipHtml() {
  if (session.isGuest) {
    return `<button class="btn btn-primary btn-sm" id="login-btn">Đăng nhập</button>`;
  }
  const name = session.user?.displayName || session.githubLogin;
  const avatar = session.avatarUrl
    ? `<img class="avatar" src="${escapeHtml(session.avatarUrl)}" alt="">`
    : `<span class="avatar" aria-hidden="true"></span>`;
  const mark = session.isPending ? ' <span class="badge badge-warn">chờ duyệt</span>' : '';
  return `<button class="user-chip" id="user-btn" aria-haspopup="dialog">
      ${avatar}<span class="trunc" style="max-width:9rem">${escapeHtml(name)}</span>${mark}
    </button>`;
}

function openUserMenu() {
  const rate = gh?.rateLimit ?? {};
  const rows = [
    ['Tài khoản GitHub', session.githubLogin],
    ['Vai trò', session.user ? (session.role === 'ADMIN' ? 'Quản trị viên' : 'Học viên') : (session.isPending ? 'Chờ duyệt' : 'Khách')],
    ['Quyền ghi', session.canWrite ? 'Có' : 'Không (chỉ đọc)'],
    ['Đồng bộ gần nhất', store.lastSyncAt ? timeAgo(store.lastSyncAt) : 'chưa có'],
    ['Thay đổi chờ đẩy', String(store.pendingCount)],
    ['Quota API còn lại', rate.remaining != null ? `${rate.remaining}/${rate.limit ?? '?'}` : 'chưa rõ'],
  ];

  modal({
    title: 'Tài khoản',
    body: `<table class="tbl">${rows.map(([k, v]) =>
      `<tr><th style="text-transform:none">${escapeHtml(k)}</th><td>${escapeHtml(v)}</td></tr>`).join('')}</table>
      ${!session.canWrite && !session.isGuest
        ? `<div class="note note-warn" style="margin-top:1rem">Token hiện tại không có quyền ghi.
             Mọi thay đổi sẽ không được lưu. Hãy tạo lại token với quyền <strong>Contents: Read and write</strong>.</div>`
        : ''}`,
    actions: [
      { label: 'Hồ sơ của tôi', onClick: ({ close }) => { close(); navigate('/me'); } },
      {
        label: 'Đăng xuất', variant: 'danger',
        onClick: async ({ close }) => {
          close();
          const ok = await confirmDialog({
            title: 'Đăng xuất?',
            message: store.pendingCount
              ? `Còn ${store.pendingCount} thay đổi chưa đồng bộ. Hệ thống sẽ cố đẩy lên trước khi đăng xuất.`
              : 'Token và dữ liệu đã lưu tạm trong trình duyệt sẽ bị xoá.',
            confirmLabel: 'Đăng xuất', danger: true,
          });
          if (!ok) return;
          await logout();
          toast('Đã đăng xuất.', 'ok');
          navigate('/');
        },
      },
    ],
  });
}

/* ========================================================= chỉ báo sync == */

let lastSyncState = { state: 'idle', pending: 0 };

const SYNC_TEXT = {
  idle:    () => '',
  busy:    () => 'Đang lưu…',
  pending: s => `${s.pending} thay đổi chờ đồng bộ`,
  error:   () => 'Lỗi đồng bộ',
};

function renderSyncChip(state) {
  const chip = document.getElementById('sync-chip');
  if (!chip) return;
  const text = SYNC_TEXT[state.state]?.(state) ?? '';
  chip.className = `sync-chip ${state.state === 'idle' ? '' : state.state}`;
  chip.textContent = text;
  chip.title = state.message
    || (store.lastSyncAt ? `Đồng bộ gần nhất: ${timeAgo(store.lastSyncAt)}` : '');
  chip.hidden = !text;
}

on(EV.SYNC_STATE, state => { lastSyncState = state; renderSyncChip(state); });
// Footer cũng phụ thuộc phiên (chế độ cục bộ vs repo thật) nên phải vẽ lại cùng header.
on(EV.AUTH_CHANGED, () => { renderHeader(); renderFooter(); });
on(EV.ROUTE_CHANGED, () => renderHeader());

/* =============================================================== footer == */

export function renderFooter() {
  const el = document.getElementById('app-footer');
  if (!el) return;
  el.hidden = false;

  if (isLocalMode()) {
    el.innerHTML = `
      <div class="ftr">
        <span>PCCP Practicing — <strong>chế độ cục bộ</strong>: đọc <code>data/</code> trên đĩa,
          ghi vào trình duyệt này.</span>
        <span class="spacer"></span>
        <span>Thay đổi không được đồng bộ cho ai khác.</span>
      </div>`;
    return;
  }

  const repo = gh ? `${gh.owner}/${gh.repo}` : '—';
  el.innerHTML = html`
    <div class="ftr">
      <span>PCCP Practicing — dữ liệu lưu trong repo <code>${repo}</code></span>
      <span class="spacer"></span>
      <span>⚠ Mọi dữ liệu trong repo này là <strong>công khai</strong>. Đừng nhập thông tin nhạy cảm.</span>
    </div>`;
}

/* ======================================================== khối tiện ích == */

/** Đặt nội dung vùng chính. */
export function setMain(htmlString) {
  const main = document.getElementById('main');
  main.innerHTML = htmlString;
  return main;
}

export function pageShell(inner, { narrow = false } = {}) {
  return `<div class="page${narrow ? ' page-narrow' : ''}">${inner}</div>`;
}

/** Banner cảnh báo dùng chung ở đầu trang (chỉ đọc, chờ duyệt, token sắp hết hạn). */
export function globalBanners() {
  const out = [];
  if (isLocalMode()) {
    out.push(`<div class="note note-warn">Đang chạy ở <strong>chế độ cục bộ</strong>.
      Mọi thay đổi chỉ lưu trong trình duyệt này và sẽ mất nếu bạn xoá dữ liệu site.
      <a href="#/setup">Kết nối repository thật</a> để dùng chung với nhóm.</div>`);
  }
  if (session.isPending) {
    out.push(`<div class="note note-warn">Yêu cầu tham gia của bạn đang chờ quản trị viên duyệt.
      Trong lúc chờ, bạn chỉ có quyền xem.</div>`);
  }
  if (!session.isGuest && !session.canWrite) {
    out.push(`<div class="note note-danger">Token không có quyền ghi — mọi thay đổi sẽ không được lưu.</div>`);
  }
  if (store.readOnly && session.isGuest) {
    out.push(`<div class="note note-info">Bạn đang xem ở chế độ khách.
      <a href="#/login">Đăng nhập</a> để theo dõi tiến độ của riêng mình.</div>`);
  }
  return out.length ? `<div class="stack" style="margin-bottom:1.25rem">${out.join('')}</div>` : '';
}

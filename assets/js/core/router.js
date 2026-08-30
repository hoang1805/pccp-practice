/**
 * Router dựa trên hash (`#/problems/P-0014`).
 *
 * Dùng hash thay vì History API vì GitHub Pages không cấu hình được
 * fallback 404 → index.html cho SPA (ràng buộc CON-03).
 */

import { emit, EV } from './bus.js';

/** @type {Array<{pattern:string, parts:string[], handler:Function, meta:object}>} */
const routes = [];
let notFoundHandler = null;
let beforeEach = null;
let currentPath = null;

export function route(pattern, handler, meta = {}) {
  routes.push({ pattern, parts: pattern.split('/').filter(Boolean), handler, meta });
}

export function setNotFound(handler) { notFoundHandler = handler; }
export function setGuard(fn) { beforeEach = fn; }

function matchRoute(path) {
  const segs = path.split('/').filter(Boolean);
  for (const r of routes) {
    if (r.parts.length !== segs.length) continue;
    const params = {};
    let ok = true;
    for (let i = 0; i < r.parts.length; i++) {
      const p = r.parts[i];
      if (p.startsWith(':')) params[p.slice(1)] = decodeURIComponent(segs[i]);
      else if (p !== segs[i]) { ok = false; break; }
    }
    if (ok) return { ...r, params };
  }
  return null;
}

export function currentRoute() {
  const raw = location.hash.slice(1) || '/';
  const [path, queryStr = ''] = raw.split('?');
  const query = Object.fromEntries(new URLSearchParams(queryStr));
  return { path: path || '/', query, raw };
}

export function navigate(path, { replace = false } = {}) {
  const target = path.startsWith('#') ? path : `#${path}`;
  if (replace) location.replace(target);
  else location.hash = target;
}

/** Điều hướng lại chính route hiện tại (dùng sau khi dữ liệu đổi). */
export function reload() { return resolve(); }

let resolving = false;
let pendingRerun = false;

async function resolve() {
  if (resolving) { pendingRerun = true; return; }
  resolving = true;
  try {
    const { path, query } = currentRoute();
    const matched = matchRoute(path);

    if (beforeEach) {
      const redirect = await beforeEach({ path, query, meta: matched?.meta ?? {} });
      if (redirect) { resolving = false; navigate(redirect, { replace: true }); return; }
    }

    currentPath = path;
    emit(EV.ROUTE_CHANGED, { path, query });

    if (!matched) {
      if (notFoundHandler) await notFoundHandler({ path, query });
      return;
    }
    await matched.handler({ params: matched.params, query, path });
  } catch (err) {
    console.error('[router] lỗi khi dựng trang', err);
    const main = document.getElementById('main');
    if (main) {
      main.innerHTML = `<div class="page page-narrow"><div class="note note-danger">
        <strong>Không tải được trang.</strong><br>${escapeText(err.message || String(err))}
      </div></div>`;
    }
  } finally {
    resolving = false;
    if (pendingRerun) { pendingRerun = false; resolve(); }
  }
}

function escapeText(s) {
  const d = document.createElement('div');
  d.textContent = String(s);
  return d.innerHTML;
}

export function startRouter() {
  window.addEventListener('hashchange', () => {
    resolve();
    // Đưa tiêu điểm về vùng nội dung để người dùng bàn phím không bị lạc.
    document.getElementById('main')?.focus({ preventScroll: true });
    window.scrollTo({ top: 0 });
  });
  if (!location.hash) location.replace('#/');
  return resolve();
}

export function activePath() { return currentPath; }

/** Cờ đánh dấu link đang ở trang hiện tại — dùng cho aria-current. */
export function isActive(path) {
  if (!currentPath) return false;
  if (path === '/') return currentPath === '/';
  return currentPath === path || currentPath.startsWith(`${path}/`);
}

/** Thanh điều hướng phụ dùng chung cho khu vực quản trị. */

import { escapeHtml } from '../../core/util.js';
import { navCounters } from '../../domain/counters.js';

const ITEMS = [
  { path: '/admin',          label: 'Tổng quan' },
  { path: '/admin/users',    label: 'Thành viên', count: () => navCounters.joinRequests },
  { path: '/admin/problems', label: 'Bài tập' },
  { path: '/admin/sets',     label: 'Bộ đề' },
  { path: '/admin/ideas',    label: 'Duyệt ý tưởng', count: () => navCounters.pendingIdeas },
  { path: '/admin/stuck',    label: 'Hard stuck', count: () => navCounters.stuck },
  { path: '/admin/grants',   label: 'Lời giải', count: () => navCounters.solutionRequests },
  { path: '/admin/settings', label: 'Cấu hình' },
  { path: '/admin/audit',    label: 'Nhật ký' },
];

export function adminNav(activePath) {
  return `<nav class="nav" aria-label="Điều hướng quản trị"
       style="margin-bottom:1.25rem;border-bottom:1px solid var(--border);padding-bottom:.5rem">
    ${ITEMS.map(i => {
      const n = i.count?.() ?? 0;
      return `<a href="#${escapeHtml(i.path)}"${i.path === activePath ? ' aria-current="page"' : ''}>
        ${escapeHtml(i.label)}${n ? ` <span class="badge badge-danger">${n}</span>` : ''}
      </a>`;
    }).join('')}
  </nav>`;
}

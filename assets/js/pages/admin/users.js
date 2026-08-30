/**
 * Quản lý thành viên và yêu cầu tham gia (FR-USER-01…08).
 */

import { setMain, pageShell, globalBanners, renderHeader } from '../../ui/layout.js';
import {
  loadingBlock, emptyState, roleBadge, toast, confirmDialog, formDialog,
} from '../../ui/components.js';
import { adminNav } from './_nav.js';
import { escapeHtml, formatDateKey, timeAgo, matchesQuery, debounce } from '../../core/util.js';
import { userId } from '../../core/auth.js';
import {
  getUsers, approveJoin, rejectJoin, changeRole, setUserActive, softDeleteUser,
  updateProfile, refreshNavCounters, getAllProgress, getProblemMap,
} from '../../domain/service.js';
import { summarize } from '../../domain/stats.js';
import { ROLE } from '../../domain/constants.js';
import { reload } from '../../core/router.js';

export async function render() {
  setMain(pageShell(loadingBlock()));

  const [doc, allProgress, problemMap] = await Promise.all([
    getUsers(), getAllProgress().catch(() => new Map()), getProblemMap().catch(() => new Map()),
  ]);

  const pending = doc.pendingJoins || [];
  const users = doc.users || [];
  const state = { q: '', role: '', status: '' };

  setMain(pageShell(`
    ${globalBanners()}
    ${adminNav('/admin/users')}

    <h1>Thành viên</h1>

    ${pendingCard(pending)}

    <div class="card card-pad" style="margin:1.25rem 0 1rem">
      <div class="row">
        <input type="search" id="q" placeholder="Tìm theo tên hoặc GitHub login…" style="flex:1 1 14rem">
        <select id="role" style="width:auto">
          <option value="">Mọi vai trò</option>
          <option value="ADMIN">Quản trị viên</option>
          <option value="USER">Học viên</option>
        </select>
        <select id="status" style="width:auto">
          <option value="">Mọi trạng thái</option>
          <option value="active">Đang hoạt động</option>
          <option value="inactive">Bị vô hiệu hoá</option>
          <option value="deleted">Đã xoá</option>
        </select>
      </div>
    </div>

    <div id="list"></div>
  `));

  const listEl = document.getElementById('list');

  function draw() {
    const rows = users.filter(u => {
      if (state.role && u.role !== state.role) return false;
      if (state.status === 'active' && (u.active === false || u.deletedAt)) return false;
      if (state.status === 'inactive' && !(u.active === false && !u.deletedAt)) return false;
      if (state.status === 'deleted' && !u.deletedAt) return false;
      if (state.q && !matchesQuery(`${u.displayName} ${u.githubLogin}`, state.q)) return false;
      return true;
    });

    if (!rows.length) {
      listEl.innerHTML = emptyState({
        title: 'Không có thành viên nào khớp',
        message: 'Thử đổi bộ lọc hoặc từ khoá tìm kiếm.',
      });
      return;
    }

    listEl.innerHTML = `<div class="card table-wrap"><table class="tbl">
      <thead><tr>
        <th>Thành viên</th><th>Vai trò</th><th>Trạng thái</th>
        <th>Tiến độ</th><th>Tham gia</th><th style="width:1%"></th>
      </tr></thead>
      <tbody>${rows.map(u => {
        const s = summarize(allProgress.get(u.id), problemMap);
        const isMe = u.id === userId();
        return `<tr>
          <td>
            <div class="row-tight">
              ${u.avatarUrl ? `<img class="avatar" src="${escapeHtml(u.avatarUrl)}" alt="">` : ''}
              <div>
                <div class="strong">${escapeHtml(u.displayName ?? u.githubLogin)}
                  ${isMe ? '<span class="badge badge-accent">bạn</span>' : ''}</div>
                <div class="tiny faint mono">${escapeHtml(u.githubLogin)}</div>
              </div>
            </div>
          </td>
          <td>${roleBadge(u.role)}</td>
          <td>${u.deletedAt
            ? '<span class="badge badge-danger">đã xoá</span>'
            : u.active === false
              ? '<span class="badge badge-warn">vô hiệu hoá</span>'
              : '<span class="badge badge-ok">hoạt động</span>'}</td>
          <td class="tiny">${s.completed} xong · ${s.stuck} vướng</td>
          <td class="tiny faint">${escapeHtml(formatDateKey(String(u.joinedAt ?? '').slice(0, 10)))}</td>
          <td class="nowrap">
            <button class="btn btn-sm" data-edit="${escapeHtml(u.id)}">Sửa</button>
            <button class="btn btn-sm btn-ghost" data-menu="${escapeHtml(u.id)}">⋯</button>
          </td>
        </tr>`;
      }).join('')}</tbody>
    </table></div>`;

    wireRows();
  }

  function wireRows() {
    for (const b of listEl.querySelectorAll('[data-edit]')) {
      b.addEventListener('click', () => editUser(users.find(u => u.id === b.dataset.edit)));
    }
    for (const b of listEl.querySelectorAll('[data-menu]')) {
      b.addEventListener('click', () => userMenu(users.find(u => u.id === b.dataset.menu)));
    }
  }

  document.getElementById('q').addEventListener('input', debounce(e => {
    state.q = e.target.value; draw();
  }, 200));
  for (const id of ['role', 'status']) {
    document.getElementById(id).addEventListener('change', e => { state[id] = e.target.value; draw(); });
  }

  wirePending();
  draw();
}

/* --------------------------------------------------------- yêu cầu tham gia -- */

function pendingCard(pending) {
  if (!pending.length) return '';
  return `<div class="card" style="border-color:var(--warn)">
    <div class="card-head"><h2>Yêu cầu tham gia</h2>
      <span class="badge badge-warn">${pending.length}</span></div>
    <div class="table-wrap"><table class="tbl">
      <thead><tr><th>Tài khoản GitHub</th><th>Gửi lúc</th><th style="width:1%"></th></tr></thead>
      <tbody>${pending.map(p => `
        <tr>
          <td>
            <div class="row-tight">
              ${p.avatarUrl ? `<img class="avatar" src="${escapeHtml(p.avatarUrl)}" alt="">` : ''}
              <span class="mono">${escapeHtml(p.githubLogin)}</span>
            </div>
            ${p.note ? `<div class="tiny faint">${escapeHtml(p.note)}</div>` : ''}
          </td>
          <td class="tiny faint">${escapeHtml(timeAgo(p.requestedAt))}</td>
          <td class="nowrap">
            <button class="btn btn-sm btn-primary" data-approve="${escapeHtml(p.githubId)}">Duyệt</button>
            <button class="btn btn-sm btn-ghost" data-reject="${escapeHtml(p.githubId)}">Từ chối</button>
          </td>
        </tr>`).join('')}</tbody>
    </table></div>
  </div>`;
}

function wirePending() {
  for (const b of document.querySelectorAll('[data-approve]')) {
    b.addEventListener('click', async () => {
      const values = await formDialog({
        title: 'Duyệt thành viên',
        fields: [
          { name: 'displayName', label: 'Tên hiển thị', placeholder: 'để trống sẽ dùng GitHub login' },
          { name: 'role', label: 'Vai trò', type: 'select', value: ROLE.USER,
            options: [{ value: ROLE.USER, label: 'Học viên' }, { value: ROLE.ADMIN, label: 'Quản trị viên' }] },
        ],
        submitLabel: 'Duyệt',
      });
      if (!values) return;
      try {
        await approveJoin(Number(b.dataset.approve), values);
        await refreshNavCounters(); renderHeader();
        toast('Đã duyệt thành viên.', 'ok');
        reload();
      } catch (err) { toast(err.message, 'err'); }
    });
  }

  for (const b of document.querySelectorAll('[data-reject]')) {
    b.addEventListener('click', async () => {
      const ok = await confirmDialog({
        title: 'Từ chối yêu cầu?',
        message: 'Người này sẽ không được thêm vào nhóm. Họ có thể gửi lại yêu cầu sau.',
        confirmLabel: 'Từ chối', danger: true,
      });
      if (!ok) return;
      try {
        await rejectJoin(Number(b.dataset.reject));
        await refreshNavCounters(); renderHeader();
        toast('Đã từ chối yêu cầu.', 'ok');
        reload();
      } catch (err) { toast(err.message, 'err'); }
    });
  }
}

/* ----------------------------------------------------------------- thao tác -- */

async function editUser(u) {
  if (!u) return;
  const values = await formDialog({
    title: `Sửa · ${u.displayName ?? u.githubLogin}`,
    fields: [
      { name: 'displayName', label: 'Tên hiển thị', required: true, value: u.displayName ?? '' },
      { name: 'targetScore', label: 'Mục tiêu điểm', type: 'number', value: u.targetScore ?? '' },
      { name: 'timezone', label: 'Múi giờ', value: u.timezone ?? '' },
    ],
    validate: v => !v.displayName.trim() ? 'Tên hiển thị không được để trống.' : null,
  });
  if (!values) return;
  try {
    await updateProfile(u.id, values);
    toast('Đã cập nhật.', 'ok');
    reload();
  } catch (err) { toast(err.message, 'err'); }
}

async function userMenu(u) {
  if (!u) return;
  const toAdmin = u.role !== ROLE.ADMIN;

  const { modal } = await import('../../ui/components.js');
  modal({
    title: u.displayName ?? u.githubLogin,
    body: `<p class="muted small">Các thao tác dưới đây ảnh hưởng tới quyền truy cập của thành viên.</p>`,
    actions: [
      {
        label: toAdmin ? 'Nâng lên quản trị viên' : 'Hạ xuống học viên',
        onClick: async ({ close }) => {
          close();
          try {
            await changeRole(u.id, toAdmin ? ROLE.ADMIN : ROLE.USER);
            toast('Đã đổi vai trò.', 'ok');
            reload();
          } catch (err) { toast(err.message, 'err'); }
        },
      },
      {
        label: u.active === false ? 'Kích hoạt lại' : 'Vô hiệu hoá',
        onClick: async ({ close }) => {
          close();
          if (u.active !== false) {
            const ok = await confirmDialog({
              title: 'Vô hiệu hoá thành viên?',
              message: 'Người này vẫn đăng nhập được nhưng chỉ có quyền xem. Dữ liệu tiến độ được giữ nguyên.',
              confirmLabel: 'Vô hiệu hoá', danger: true,
            });
            if (!ok) return;
          }
          try {
            await setUserActive(u.id, u.active === false);
            toast('Đã cập nhật trạng thái.', 'ok');
            reload();
          } catch (err) { toast(err.message, 'err'); }
        },
      },
      {
        label: 'Xoá mềm', variant: 'danger',
        onClick: async ({ close }) => {
          close();
          const ok = await confirmDialog({
            title: 'Xoá thành viên?',
            message: `<p>Thành viên bị đánh dấu đã xoá và mất quyền truy cập.</p>
              <p class="muted small">Dữ liệu tiến độ <strong>vẫn được giữ lại</strong> để không làm hỏng thống kê nhóm.</p>`,
            confirmLabel: 'Xoá', danger: true,
          });
          if (!ok) return;
          try {
            await softDeleteUser(u.id);
            toast('Đã xoá thành viên.', 'ok');
            reload();
          } catch (err) { toast(err.message, 'err'); }
        },
      },
    ],
  });
}

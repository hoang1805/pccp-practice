/**
 * Trang cấu hình repository — chỉ hiện khi không suy ra được owner/repo
 * từ URL (thường là khi chạy local, chưa deploy lên GitHub Pages).
 */

import { setMain, pageShell, renderHeader } from '../ui/layout.js';
import { setRepoConfig, getRepoConfig, initClient, restoreSession } from '../core/auth.js';
import { toast } from '../ui/components.js';
import { escapeHtml } from '../core/util.js';
import { navigate } from '../core/router.js';

export function render() {
  const cur = getRepoConfig();

  setMain(pageShell(`
    <h1>Kết nối tới repository</h1>
    <p class="muted">
      Ứng dụng lưu toàn bộ dữ liệu dưới dạng file JSON trong một repository GitHub.
      Khi chạy trên GitHub Pages, thông tin này được nhận ra tự động —
      màn hình này chỉ xuất hiện khi bạn chạy ở máy cá nhân.
    </p>

    <div class="card card-pad stack" style="margin-top:1.25rem">
      <div class="field">
        <label for="owner">Chủ sở hữu (user hoặc organization) <span style="color:var(--danger)">*</span></label>
        <input type="text" id="owner" class="mono" placeholder="vd: dhhoang203" value="${escapeHtml(cur?.owner ?? '')}">
      </div>
      <div class="field">
        <label for="repo">Tên repository <span style="color:var(--danger)">*</span></label>
        <input type="text" id="repo" class="mono" placeholder="vd: pccp-practicing" value="${escapeHtml(cur?.repo ?? '')}">
      </div>
      <div class="field">
        <label for="branch">Nhánh</label>
        <input type="text" id="branch" class="mono" value="${escapeHtml(cur?.branch ?? 'main')}">
        <div class="hint">Thường là <code>main</code>.</div>
      </div>
      <div class="field-error" id="err" hidden></div>
      <div class="row">
        <button class="btn btn-primary" id="save">Lưu &amp; kết nối</button>
        <a class="btn btn-ghost" href="#/">Bỏ qua</a>
      </div>
    </div>

    <div class="note note-info" style="margin-top:1.25rem">
      Thông tin này chỉ lưu trong trình duyệt của bạn, không gửi đi đâu cả.
    </div>

    <div class="card card-pad" style="margin-top:1.5rem">
      <h2 style="margin-top:0">Hoặc: dùng thử ở chế độ cục bộ</h2>
      <p class="muted small">
        Đọc thẳng thư mục <code>data/</code> đang được phục vụ cùng trang này,
        và lưu mọi thay đổi vào trình duyệt. Không cần token, không cần repo.
      </p>
      <div class="note note-warn" style="margin-bottom:.9rem">
        Thay đổi ở chế độ này <strong>chỉ nằm trong máy bạn</strong> — không đồng bộ
        cho ai khác và sẽ mất nếu bạn xoá dữ liệu site. Dùng để xem thử giao diện
        hoặc phát triển, không dùng để học nhóm thật.
      </div>
      <button class="btn" id="local">Vào chế độ cục bộ</button>
    </div>
  `, { narrow: true }));

  const $ = id => document.getElementById(id);

  $('save').addEventListener('click', async () => {
    const owner = $('owner').value.trim();
    const repo = $('repo').value.trim();
    const branch = $('branch').value.trim() || 'main';
    const err = $('err');

    if (!owner || !repo) {
      err.textContent = 'Vui lòng nhập đầy đủ chủ sở hữu và tên repository.';
      err.hidden = false;
      return;
    }

    setRepoConfig({ owner, repo, branch });
    initClient();
    try {
      await restoreSession();
    } catch { /* chưa có token là bình thường */ }
    renderHeader();
    toast('Đã kết nối repository.', 'ok');
    navigate('/');
  });

  $('local').addEventListener('click', async () => {
    setRepoConfig({ mode: 'local' });
    initClient();
    try {
      await restoreSession();
    } catch (err) {
      toast(`Không vào được chế độ cục bộ: ${err.message}`, 'err', 6000);
      return;
    }
    renderHeader();
    toast('Đang chạy ở chế độ cục bộ.', 'ok');
    navigate('/');
  });

  $('owner').focus();
}

/**
 * Đăng nhập bằng GitHub fine-grained PAT (FR-AUTH-01).
 * Kèm hướng dẫn tạo token từng bước để giảm rào cản sử dụng (RISK-07).
 */

import { setMain, pageShell, renderHeader, globalBanners } from '../ui/layout.js';
import { loginWithToken, session, gh } from '../core/auth.js';
import { toast } from '../ui/components.js';
import { escapeHtml, todayKey, addDays } from '../core/util.js';
import { navigate } from '../core/router.js';
import { refreshNavCounters } from '../domain/service.js';

export function render() {
  if (!session.isGuest) {
    setMain(pageShell(`
      ${globalBanners()}
      <div class="card card-pad center">
        <h2>Bạn đã đăng nhập</h2>
        <p class="muted">Đang đăng nhập với tài khoản <strong>${escapeHtml(session.githubLogin)}</strong>.</p>
        <a class="btn btn-primary" href="#/">Về trang chủ</a>
      </div>`, { narrow: true }));
    return;
  }

  const owner = gh?.owner ?? '';
  const repo = gh?.repo ?? '';
  const tokenUrl = 'https://github.com/settings/personal-access-tokens/new';
  const defaultExpiry = addDays(todayKey(), 90);

  setMain(pageShell(`
    <h1>Đăng nhập</h1>
    <p class="muted">
      Ứng dụng không có máy chủ riêng, nên mọi thay đổi được ghi thẳng vào repository
      bằng token GitHub của chính bạn.
    </p>

    <div class="card card-pad stack">
      <div class="field">
        <label for="token">GitHub fine-grained token <span style="color:var(--danger)">*</span></label>
        <input type="password" id="token" class="mono" autocomplete="off"
               placeholder="github_pat_…" spellcheck="false">
        <div class="hint">Token chỉ được lưu trong trình duyệt của bạn và chỉ gửi tới <code>api.github.com</code>.</div>
      </div>

      <div class="field">
        <label for="expiry">Ngày hết hạn của token (tuỳ chọn)</label>
        <input type="date" id="expiry" value="${escapeHtml(defaultExpiry)}">
        <div class="hint">Dùng để nhắc bạn trước 7 ngày. Ứng dụng không đọc được hạn thật của token.</div>
      </div>

      <div class="field-error" id="err" hidden></div>

      <div class="row">
        <button class="btn btn-primary" id="submit">Đăng nhập</button>
        <a class="btn btn-ghost" href="#/">Xem với tư cách khách</a>
      </div>
    </div>

    <div class="card" style="margin-top:1.5rem">
      <div class="card-head"><h2>Cách tạo token</h2></div>
      <div class="card-pad">
        <ol style="padding-left:1.2rem;line-height:1.9">
          <li>Mở <a href="${tokenUrl}" target="_blank" rel="noopener noreferrer">trang tạo fine-grained token</a>.</li>
          <li><strong>Resource owner</strong>: chọn <code>${escapeHtml(owner)}</code>.</li>
          <li><strong>Repository access</strong> → <em>Only select repositories</em> → chọn <code>${escapeHtml(repo)}</code>.</li>
          <li><strong>Repository permissions</strong> → <em>Contents</em> = <strong>Read and write</strong>.
              Không cần cấp thêm quyền nào khác.</li>
          <li><strong>Expiration</strong>: tối đa 90 ngày.</li>
          <li>Bấm <em>Generate token</em>, sao chép và dán vào ô phía trên.</li>
        </ol>
        <div class="note note-warn" style="margin-top:1rem">
          <strong>Đừng dùng token có phạm vi rộng.</strong> Token chỉ nên truy cập được đúng repo này.
          Nếu nghi ngờ lộ token, hãy thu hồi ngay trong phần cài đặt GitHub.
        </div>
        <div class="note note-info" style="margin-top:.75rem">
          Chưa được thêm vào nhóm? Cứ đăng nhập — hệ thống sẽ tự tạo yêu cầu tham gia
          để quản trị viên duyệt.
        </div>
      </div>
    </div>
  `, { narrow: true }));

  const $ = id => document.getElementById(id);
  const tokenInput = $('token');
  const btn = $('submit');
  const err = $('err');

  async function submit() {
    const token = tokenInput.value.trim();
    const expiry = $('expiry').value || null;
    err.hidden = true;

    if (!token) {
      err.textContent = 'Vui lòng dán token vào ô phía trên.';
      err.hidden = false;
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Đang kiểm tra…';
    try {
      await loginWithToken(token, expiry);
      renderHeader();
      refreshNavCounters().then(renderHeader).catch(() => {});

      if (session.isPending) {
        toast('Đã gửi yêu cầu tham gia. Chờ quản trị viên duyệt.', 'info', 6000);
      } else if (!session.canWrite) {
        toast('Đăng nhập thành công, nhưng token không có quyền ghi.', 'warn', 6000);
      } else {
        toast(`Xin chào, ${session.user?.displayName ?? session.githubLogin}!`, 'ok');
      }
      navigate('/');
    } catch (e) {
      err.textContent = e.message || 'Đăng nhập thất bại.';
      err.hidden = false;
    } finally {
      btn.disabled = false;
      btn.textContent = 'Đăng nhập';
    }
  }

  btn.addEventListener('click', submit);
  tokenInput.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
  tokenInput.focus();
}

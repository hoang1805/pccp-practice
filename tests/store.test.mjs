import { test } from 'node:test';
import assert from 'node:assert/strict';

import { mergeDocs } from '../assets/js/core/store.js';
import { GitHubClient, ConflictError, detectRepoFromLocation } from '../assets/js/core/github.js';
import { b64encode, b64decode } from '../assets/js/core/util.js';

/* =================================================== hợp nhất khi xung đột == */

test('RISK-05: hai người ghi song song, không ai mất dữ liệu', () => {
  const path = 'data/users.json';
  // Remote đã có thay đổi của người khác kể từ lúc ta đọc.
  const remote = {
    users: [
      { id: 'u_a', displayName: 'An',  updatedAt: '2026-08-30T10:00:00Z' },
      { id: 'u_c', displayName: 'Cường', updatedAt: '2026-08-30T10:05:00Z' }, // người khác vừa thêm
    ],
  };
  // Bản local của ta: sửa u_a và thêm u_b, nhưng chưa biết về u_c.
  const local = {
    users: [
      { id: 'u_a', displayName: 'An (đã sửa)', updatedAt: '2026-08-30T10:10:00Z' },
      { id: 'u_b', displayName: 'Bình', updatedAt: '2026-08-30T10:08:00Z' },
    ],
  };

  const merged = mergeDocs(remote, local, path);
  const byId = Object.fromEntries(merged.users.map(u => [u.id, u]));

  assert.equal(Object.keys(byId).length, 3, 'phải giữ cả 3 bản ghi');
  assert.equal(byId.u_a.displayName, 'An (đã sửa)', 'bản ghi mới hơn thắng');
  assert.equal(byId.u_b.displayName, 'Bình', 'bản ghi chỉ có ở local được giữ');
  assert.equal(byId.u_c.displayName, 'Cường', 'bản ghi chỉ có ở remote KHÔNG bị mất');
});

test('bản ghi cũ hơn không ghi đè bản mới hơn', () => {
  const remote = { items: [{ problemId: 'P-1', status: 'COMPLETED', updatedAt: '2026-08-30T12:00:00Z' }] };
  const local  = { items: [{ problemId: 'P-1', status: 'IN_PROGRESS', updatedAt: '2026-08-30T09:00:00Z' }] };
  const merged = mergeDocs(remote, local, 'data/progress/u_a.json');
  assert.equal(merged.items[0].status, 'COMPLETED');
});

test('hợp nhất đúng nhiều mảng trong cùng một tài liệu', () => {
  const path = 'data/grants/u_a.json';
  const remote = {
    grants:   [{ problemId: 'P-1', updatedAt: '2026-08-30T10:00:00Z' }],
    requests: [{ problemId: 'P-9', updatedAt: '2026-08-30T10:00:00Z' }],
  };
  const local = {
    grants:   [{ problemId: 'P-2', updatedAt: '2026-08-30T11:00:00Z' }],
    requests: [],
  };
  const merged = mergeDocs(remote, local, path);
  assert.deepEqual(merged.grants.map(g => g.problemId).sort(), ['P-1', 'P-2']);
  assert.deepEqual(merged.requests.map(r => r.problemId), ['P-9']);
});

test('tài liệu đơn khối (không có quy tắc mảng) thì local thắng', () => {
  const remote = { exam: { durationMinutes: 120 } };
  const local  = { exam: { durationMinutes: 90 } };
  assert.deepEqual(mergeDocs(remote, local, 'data/config.json'), local);
});

test('thiếu một phía thì trả về phía còn lại', () => {
  assert.deepEqual(mergeDocs(null, { a: 1 }, 'data/users.json'), { a: 1 });
  assert.deepEqual(mergeDocs({ a: 1 }, null, 'data/users.json'), { a: 1 });
});

/* ============================================================ GitHub API == */

/** Fetch giả lập, ghi lại mọi lời gọi để kiểm tra hành vi. */
function stubFetch(handlers) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method ?? 'GET', body: init.body });
    const h = handlers.shift();
    if (!h) throw new Error(`Không còn handler cho ${init.method ?? 'GET'} ${url}`);
    return {
      ok: h.status >= 200 && h.status < 300,
      status: h.status,
      headers: new Map(Object.entries(h.headers ?? {})),
      json: async () => h.json,
      text: async () => h.text ?? '',
    };
  };
  return calls;
}

function jsonFile(obj, sha) {
  return { status: 200, json: { content: b64encode(JSON.stringify(obj)), sha }, headers: {} };
}

test('AC-18: gặp 409 thì đọc lại, merge, và ghi thành công', async () => {
  const gh = new GitHubClient({ owner: 'o', repo: 'r', token: 't' });

  const calls = stubFetch([
    // 1. đọc lần đầu
    jsonFile({ items: [{ problemId: 'P-1', status: 'NOT_STARTED', updatedAt: '2026-08-30T09:00:00Z' }] }, 'sha-1'),
    // 2. ghi -> xung đột vì có người vừa ghi trước
    { status: 409, json: {}, headers: {} },
    // 3. đọc lại, thấy dữ liệu mới của người kia
    jsonFile({
      items: [
        { problemId: 'P-1', status: 'NOT_STARTED', updatedAt: '2026-08-30T09:00:00Z' },
        { problemId: 'P-2', status: 'COMPLETED', updatedAt: '2026-08-30T09:30:00Z' },
      ],
    }, 'sha-2'),
    // 4. ghi lại -> thành công
    { status: 200, json: { content: { sha: 'sha-3' } }, headers: {} },
  ]);

  const result = await gh.updateJson('data/progress/u_a.json', doc => ({
    ...doc,
    items: [...doc.items, { problemId: 'P-3', status: 'IN_PROGRESS', updatedAt: '2026-08-30T10:00:00Z' }],
  }), { message: 'test' });

  assert.equal(calls.length, 4, 'phải đọc lại rồi ghi lại sau khi gặp 409');
  const ids = result.data.items.map(i => i.problemId).sort();
  // P-2 là của người khác, phải còn nguyên; P-3 là của ta, phải được thêm.
  assert.deepEqual(ids, ['P-1', 'P-2', 'P-3']);

  // sha gửi lên ở lần ghi thứ hai phải là sha mới đọc được.
  assert.equal(JSON.parse(calls[3].body).sha, 'sha-2');
});

test('422 kèm thông báo sha lỗi thời cũng được coi là xung đột', async () => {
  const gh = new GitHubClient({ owner: 'o', repo: 'r', token: 't' });
  stubFetch([{ status: 422, json: { message: 'does not match' }, headers: {} }]);
  await assert.rejects(
    () => gh.writeFile('data/x.json', '{}', 'msg', 'old-sha'),
    e => e instanceof ConflictError);
});

test('file chưa tồn tại trả về null thay vì ném lỗi', async () => {
  const gh = new GitHubClient({ owner: 'o', repo: 'r', token: 't' });
  stubFetch([{ status: 404, json: {}, headers: {} }]);
  assert.equal(await gh.readFile('data/chua-co.json'), null);
});

test('ghi khi chưa đăng nhập bị chặn ngay, không gọi mạng', async () => {
  const gh = new GitHubClient({ owner: 'o', repo: 'r', token: null });
  const calls = stubFetch([]);
  await assert.rejects(() => gh.writeFile('data/x.json', '{}', 'msg'), /Cần đăng nhập/);
  assert.equal(calls.length, 0);
});

test('mất mạng được đánh dấu offline để tầng trên xếp hàng', async () => {
  const gh = new GitHubClient({ owner: 'o', repo: 'r', token: 't' });
  globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
  await assert.rejects(() => gh.readFile('data/x.json'), e => e.offline === true);
});

test('theo dõi được hạn mức API từ header', async () => {
  const gh = new GitHubClient({ owner: 'o', repo: 'r', token: 't' });
  stubFetch([{
    status: 200, json: { login: 'ai-do' },
    headers: { 'x-ratelimit-limit': '5000', 'x-ratelimit-remaining': '4987', 'x-ratelimit-reset': '1800000000' },
  }]);
  await gh.getAuthenticatedUser();
  assert.equal(gh.rateLimit.remaining, 4987);
  assert.equal(gh.rateLimit.limit, 5000);
});

/* ============================================================== base64 === */

test('DEC-02: base64 giữ nguyên tiếng Việt qua vòng mã hoá', () => {
  const payload = { approachMd: '## Ý tưởng\nDùng 0-1 BFS với deque — độ phức tạp O(n·m).' };
  const decoded = JSON.parse(b64decode(b64encode(JSON.stringify(payload))));
  assert.deepEqual(decoded, payload);
});

/* ======================================================== nhận diện repo == */

test('suy ra owner/repo từ URL GitHub Pages', () => {
  assert.deepEqual(
    detectRepoFromLocation({ hostname: 'dhhoang203.github.io', pathname: '/pccp-practicing/' }),
    { owner: 'dhhoang203', repo: 'pccp-practicing' });

  // Trang gốc <owner>.github.io tương ứng repo cùng tên.
  assert.deepEqual(
    detectRepoFromLocation({ hostname: 'dhhoang203.github.io', pathname: '/' }),
    { owner: 'dhhoang203', repo: 'dhhoang203.github.io' });

  // Chạy local thì không suy ra được, phải cấu hình tay.
  assert.equal(detectRepoFromLocation({ hostname: 'localhost', pathname: '/' }), null);
});

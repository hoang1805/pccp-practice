/**
 * Chạy toàn bộ unit test.
 *
 *   node scripts/run-tests.mjs
 *
 * Không dùng `node --test "tests/*.test.mjs"` vì glob nội bộ của test runner
 * chỉ có từ Node 22, còn `node --test tests/` lại không nhận thư mục trên mọi
 * nền tảng. Tự dò file rồi truyền đường dẫn tường minh là cách chạy được ở
 * mọi phiên bản Node và mọi hệ điều hành.
 */

import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const DIR = 'tests';

const files = readdirSync(DIR)
  .filter(f => f.endsWith('.test.mjs'))
  .sort()
  .map(f => join(DIR, f));

if (!files.length) {
  console.error(`Không tìm thấy file test nào trong ${DIR}/`);
  process.exit(1);
}

const res = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
process.exit(res.status ?? 1);

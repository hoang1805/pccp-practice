/**
 * Sinh `data/problems/_index.json` từ các file bài tập.
 *
 * Ứng dụng cũng tự cập nhật index khi admin tạo/sửa bài, nên script này chủ yếu
 * dùng để: (a) sửa index bị lệch, (b) tái sinh sau khi ai đó sửa file bằng tay,
 * (c) chạy trong CI để index luôn khớp nguồn.
 *
 *   node scripts/build-index.mjs [--check]
 *
 * `--check` chỉ so sánh và báo lệch (thoát 1), không ghi file.
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const DIR = 'data/problems';
const OUT = join(DIR, '_index.json');
const CHECK_ONLY = process.argv.includes('--check');

if (!existsSync(DIR)) {
  console.log('Chưa có thư mục data/problems — không có gì để làm.');
  process.exit(0);
}

const problems = readdirSync(DIR)
  .filter(f => f.endsWith('.json') && f !== '_index.json')
  .map(f => {
    const raw = readFileSync(join(DIR, f), 'utf8');
    try {
      return JSON.parse(raw);
    } catch (e) {
      console.error(`✖ ${join(DIR, f)}: JSON không hợp lệ — ${e.message}`);
      process.exit(1);
    }
  })
  .sort((a, b) => String(a.id).localeCompare(String(b.id)));

const entries = problems.map(p => ({
  id: p.id,
  title: p.title,
  level: p.level,
  tags: p.tags ?? [],
  estimatedMinutes: p.estimatedMinutes ?? null,
  archived: Boolean(p.archived),
  updatedAt: p.updatedAt ?? null,
}));

const prev = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : null;

// So sánh phần nội dung, bỏ qua `generatedAt` để không tạo diff giả mỗi lần chạy.
const same = prev && JSON.stringify(prev.problems ?? []) === JSON.stringify(entries);

if (CHECK_ONLY) {
  if (same) {
    console.log(`✓ Index khớp nguồn (${entries.length} bài).`);
    process.exit(0);
  }
  console.error('✖ Index lệch so với các file bài tập. Chạy `npm run build-index` rồi commit lại.');
  process.exit(1);
}

if (same) {
  console.log(`Index đã khớp (${entries.length} bài) — không ghi lại.`);
  process.exit(0);
}

writeFileSync(OUT, JSON.stringify({
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  problems: entries,
}, null, 2) + '\n', 'utf8');

const byLevel = entries.reduce((acc, p) => {
  if (!p.archived) acc[p.level] = (acc[p.level] ?? 0) + 1;
  return acc;
}, {});

console.log(`✓ Đã sinh index: ${entries.length} bài (Lv1: ${byLevel[1] ?? 0}, Lv2: ${byLevel[2] ?? 0}, Lv3: ${byLevel[3] ?? 0}).`);

const enough = (byLevel[1] ?? 0) >= 1 && (byLevel[2] ?? 0) >= 1 && (byLevel[3] ?? 0) >= 2;
if (!enough) {
  console.log('⚠ Chưa đủ bài để tạo một bộ đề đầy đủ (cần 1×Lv1, 1×Lv2, 2×Lv3).');
}

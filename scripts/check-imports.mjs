/**
 * Kiểm tra tĩnh: mọi tên import có thực sự được module đích export không.
 * Chạy được mà không cần trình duyệt, nên dùng được trong CI.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';

const ROOT = 'assets/js';

function walk(dir) {
  return readdirSync(dir).flatMap(name => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : (p.endsWith('.js') ? [p] : []);
  });
}

const files = walk(ROOT);
const exportsOf = new Map();

const reNamedExport = /export\s+(?:async\s+)?(?:function|class|const|let|var)\s+([A-Za-z0-9_$]+)/g;
const reExportList  = /export\s*\{([^}]*)\}/g;

for (const f of files) {
  const src = readFileSync(f, 'utf8');
  const names = new Set();
  for (const m of src.matchAll(reNamedExport)) names.add(m[1]);
  for (const m of src.matchAll(reExportList)) {
    for (const part of m[1].split(',')) {
      const t = part.trim();
      if (!t) continue;
      names.add((t.split(/\s+as\s+/)[1] ?? t).trim());
    }
  }
  if (/export\s+default/.test(src)) names.add('default');
  exportsOf.set(resolve(f), names);
}

const reImport = /import\s+([^'"]+?)\s+from\s+['"]([^'"]+)['"]/g;
let problems = 0;

for (const f of files) {
  const src = readFileSync(f, 'utf8');
  for (const m of src.matchAll(reImport)) {
    const clause = m[1].trim();
    const spec = m[2];
    if (!spec.startsWith('.')) continue;

    const target = resolve(dirname(f), spec);
    if (!exportsOf.has(target)) {
      console.log(`MISSING FILE  ${relative('.', f)} -> ${spec}`);
      problems++;
      continue;
    }
    const available = exportsOf.get(target);
    const braces = clause.match(/\{([^}]*)\}/);
    if (!braces) continue;
    for (const part of braces[1].split(',')) {
      const t = part.trim();
      if (!t) continue;
      const name = t.split(/\s+as\s+/)[0].trim();
      if (!available.has(name)) {
        console.log(`MISSING EXPORT  ${relative('.', f)}: "${name}" không có trong ${spec}`);
        problems++;
      }
    }
  }
}

console.log(problems === 0
  ? `OK — ${files.length} module, mọi import đều khớp export.`
  : `\n${problems} vấn đề cần sửa.`);
process.exit(problems ? 1 : 0);

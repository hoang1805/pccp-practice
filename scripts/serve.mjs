/**
 * Server tĩnh tối giản để chạy thử ở máy cá nhân.
 *
 *   node scripts/serve.mjs [port]
 *
 * Không phải server của ứng dụng — bản deploy thật chỉ là file tĩnh trên
 * GitHub Pages. Script này chỉ thay cho việc mở file:// (vốn chặn ES module).
 */

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';

const PORT = Number(process.argv[2]) || 8080;
const ROOT = process.cwd();

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.mjs':  'text/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.ico':  'image/x-icon',
  '.woff2': 'font/woff2',
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    let path = decodeURIComponent(url.pathname);
    if (path.endsWith('/')) path += 'index.html';

    // Chặn thoát khỏi thư mục gốc.
    const full = join(ROOT, normalize(path).replace(/^(\.\.[/\\])+/, ''));
    if (!full.startsWith(ROOT)) {
      res.writeHead(403).end('Forbidden');
      return;
    }

    const info = await stat(full).catch(() => null);
    if (!info?.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
         .end(`404 — không tìm thấy ${path}`);
      return;
    }

    const body = await readFile(full);
    res.writeHead(200, {
      'Content-Type': MIME[extname(full).toLowerCase()] ?? 'application/octet-stream',
      'Cache-Control': 'no-cache',
    }).end(body);
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' })
       .end(`500 — ${err.message}`);
  }
});

server.listen(PORT, () => {
  console.log(`PCCP Practicing đang chạy tại  http://localhost:${PORT}`);
  console.log('Lần đầu mở, ứng dụng sẽ hỏi owner/repo ở màn hình thiết lập.');
  console.log('Ctrl+C để dừng.');
});

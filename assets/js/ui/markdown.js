/**
 * Render Markdown an toàn (FR-PROB-05, NFR-S-03).
 *
 * Nguyên tắc fail-safe: DOMPurify là ranh giới an toàn. Nếu nó không tải được
 * thì **không** render HTML thô, mà rơi về hiển thị văn bản đã escape.
 * Thà xấu còn hơn để lọt XSS đánh cắp PAT (RISK-06).
 */

import { escapeHtml } from '../core/util.js';

const CDN = 'https://cdnjs.cloudflare.com/ajax/libs';
const SCRIPTS = {
  // cdnjs không có bản build nào cho markdown-it 14.x (thư mục rỗng → 404),
  // nên phải ghim 13.0.2 — bản mới nhất thực sự tải được. Đừng nâng lên 14 nếu
  // chưa kiểm tra URL trả về 200.
  markdownit: `${CDN}/markdown-it/13.0.2/markdown-it.min.js`,
  purify:     `${CDN}/dompurify/3.1.6/purify.min.js`,
  hljs:       `${CDN}/highlight.js/11.10.0/highlight.min.js`,
};

let mdInstance = null;
let purifier = null;
let hljs = null;
let readyPromise = null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = src;
    el.async = true;
    el.crossOrigin = 'anonymous';
    el.onload = () => resolve();
    el.onerror = () => reject(new Error(`Không tải được ${src}`));
    document.head.appendChild(el);
  });
}

/** Nạp thư viện render. Gọi một lần lúc khởi động; an toàn khi gọi lại. */
export function initMarkdown() {
  if (readyPromise) return readyPromise;

  readyPromise = (async () => {
    // DOMPurify là bắt buộc — thiếu nó thì không bật render HTML.
    try {
      await loadScript(SCRIPTS.purify);
      purifier = window.DOMPurify ?? null;
    } catch (err) {
      console.warn('[markdown] không tải được DOMPurify, chuyển sang chế độ văn bản thuần.', err);
      return;
    }
    if (!purifier) return;

    try {
      await loadScript(SCRIPTS.hljs);
      hljs = window.hljs ?? null;
    } catch { /* tô màu cú pháp là tuỳ chọn, thiếu vẫn chạy */ }

    try {
      await loadScript(SCRIPTS.markdownit);
      const markdownit = window.markdownit;
      if (!markdownit) return;
      mdInstance = markdownit({
        html: false,        // không cho HTML thô trong nguồn Markdown
        linkify: true,
        breaks: false,
        typographer: false,
        highlight(code, lang) {
          if (hljs && lang && hljs.getLanguage(lang)) {
            try {
              return `<pre class="hljs"><code>${hljs.highlight(code, { language: lang, ignoreIllegals: true }).value}</code></pre>`;
            } catch { /* rơi về không tô màu */ }
          }
          return `<pre class="hljs"><code>${escapeHtml(code)}</code></pre>`;
        },
      });
    } catch (err) {
      console.warn('[markdown] không tải được markdown-it, chuyển sang chế độ văn bản thuần.', err);
    }

    // Trang có thể đã dựng xong trước thời điểm này — vá lại các khối dự phòng.
    refreshPendingMarkdown();
  })();

  return readyPromise;
}

const PURIFY_CONFIG = {
  ALLOWED_TAGS: [
    'p', 'br', 'hr', 'strong', 'em', 'del', 's', 'code', 'pre', 'span',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'ul', 'ol', 'li', 'blockquote', 'a', 'img',
    'table', 'thead', 'tbody', 'tr', 'th', 'td', 'sup', 'sub',
  ],
  ALLOWED_ATTR: ['href', 'title', 'alt', 'src', 'class', 'colspan', 'rowspan'],
  ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|#)/i, // chặn javascript:, data: …
  FORBID_TAGS: ['style', 'script', 'iframe', 'form', 'input', 'object', 'embed'],
  FORBID_ATTR: ['style', 'onerror', 'onload', 'onclick'],
};

/**
 * Chuyển Markdown → HTML đã làm sạch.
 * @returns {string} chuỗi HTML an toàn để gán vào innerHTML
 */
export function renderMarkdown(src) {
  const text = String(src ?? '').trim();
  if (!text) return '<p class="faint"><em>(chưa có nội dung)</em></p>';

  if (!mdInstance || !purifier) {
    // Chế độ dự phòng: giữ nguyên xuống dòng, escape toàn bộ.
    return `<pre class="md-plain" data-md-src="${escapeHtml(text)}">${escapeHtml(text)}</pre>`;
  }

  const dirty = mdInstance.render(text);
  const clean = purifier.sanitize(dirty, PURIFY_CONFIG);
  return clean;
}

/** Link ngoài mở tab mới và không rò referrer. */
function decorateLinks(el) {
  for (const a of el.querySelectorAll('a[href^="http"]')) {
    a.target = '_blank';
    a.rel = 'noopener noreferrer nofollow';
  }
}

/** Gán markdown đã render vào một phần tử. */
export function mountMarkdown(el, src) {
  if (!el) return;
  el.innerHTML = renderMarkdown(src);
  decorateLinks(el);
}

/**
 * Render lại những khối đã rơi về chế độ văn bản thuần.
 *
 * Trang thường dựng xong trước khi thư viện từ CDN tải xong (initMarkdown chạy
 * song song, không chặn router). Thiếu bước này thì đề bài sẽ mãi hiển thị
 * Markdown thô. Mỗi khối dự phòng giữ nguyên nguồn trong `data-md-src`.
 */
export function refreshPendingMarkdown(root = document) {
  if (!markdownReady() || !root || typeof root.querySelectorAll !== 'function') return;
  for (const node of [...root.querySelectorAll('[data-md-src]')]) {
    const holder = document.createElement('div');
    holder.innerHTML = renderMarkdown(node.getAttribute('data-md-src'));
    decorateLinks(holder);
    node.replaceWith(...holder.childNodes);
  }
}

/** Rút gọn markdown thành văn bản thuần cho phần xem trước. */
export function markdownExcerpt(src, maxLen = 160) {
  const plain = String(src ?? '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_~-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return plain.length > maxLen ? `${plain.slice(0, maxLen - 1)}…` : plain;
}

export function markdownReady() { return Boolean(mdInstance && purifier); }

/**
 * Tiện ích dùng chung: mã hoá base64 an toàn Unicode, ngày tháng, id, escape HTML.
 */

/* ------------------------------------------------------------- base64 -- */
/*
 * btoa/atob chỉ làm việc với latin1 nên sẽ ném lỗi với tiếng Việt.
 * Đi vòng qua TextEncoder/TextDecoder để xử lý đúng UTF-8.
 */
export function b64encode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  const CHUNK = 0x8000; // tránh tràn stack khi apply với mảng lớn
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

export function b64decode(b64) {
  const bin = atob(String(b64).replace(/\s/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/* ----------------------------------------------------------------- id -- */
export function uid(prefix = '') {
  const rnd = crypto.getRandomValues(new Uint8Array(6));
  const hex = Array.from(rnd, b => b.toString(16).padStart(2, '0')).join('');
  return prefix ? `${prefix}${hex}` : hex;
}

/** Sinh id tuần tự dạng P-0014 dựa trên các id đã tồn tại. */
export function nextSeqId(existingIds, prefix, width = 4) {
  let max = 0;
  const re = new RegExp(`^${prefix}(\\d+)$`);
  for (const id of existingIds) {
    const m = re.exec(id || '');
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `${prefix}${String(max + 1).padStart(width, '0')}`;
}

/* --------------------------------------------------------------- date -- */
export function nowIso() { return new Date().toISOString(); }

/** YYYY-MM-DD theo múi giờ địa phương (không dùng toISOString để tránh lệch ngày). */
export function todayKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function monthKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function parseDateKey(key) {
  const [y, m, d] = String(key).split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(dateKey, n) {
  const d = parseDateKey(dateKey);
  d.setDate(d.getDate() + n);
  return todayKey(d);
}

export function daysBetween(aKey, bKey) {
  const a = parseDateKey(aKey), b = parseDateKey(bKey);
  return Math.round((b - a) / 86400000);
}

const DOW_VI = ['Chủ nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7'];

export function formatDateKey(key, { withDow = false } = {}) {
  if (!key) return '—';
  const d = parseDateKey(key);
  const s = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
  return withDow ? `${DOW_VI[d.getDay()]}, ${s}` : s;
}

export function formatDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(+d)) return '—';
  return d.toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' });
}

/** "3 giờ trước", "2 ngày trước" … */
export function timeAgo(iso) {
  if (!iso) return '—';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '—';
  const secs = Math.floor((Date.now() - then) / 1000);
  if (secs < 0) return 'vừa xong';
  if (secs < 60) return 'vừa xong';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins} phút trước`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} giờ trước`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days} ngày trước`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} tháng trước`;
  return `${Math.floor(months / 12)} năm trước`;
}

/** Khoảng thời gian đã trôi qua, dạng "2g 20p". */
export function durationSince(iso) {
  if (!iso) return '—';
  const mins = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
  return formatMinutes(mins);
}

export function formatMinutes(mins) {
  if (mins == null || Number.isNaN(mins)) return '—';
  const m = Math.round(mins);
  if (m < 60) return `${m}p`;
  const h = Math.floor(m / 60), r = m % 60;
  if (h < 24) return r ? `${h}g ${r}p` : `${h}g`;
  const d = Math.floor(h / 24), rh = h % 24;
  return rh ? `${d} ngày ${rh}g` : `${d} ngày`;
}

/** mm:ss hoặc h:mm:ss cho đồng hồ đếm ngược. */
export function formatClock(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const pad = n => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

/* --------------------------------------------------------------- html -- */
export function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Tag template escape mọi biến nội suy — dùng cho mọi chuỗi HTML động. */
export function html(strings, ...vals) {
  return strings.reduce((out, s, i) => {
    const v = vals[i - 1];
    const piece = Array.isArray(v) ? v.join('') : escapeHtml(v);
    return out + piece + s;
  });
}

/** Đánh dấu chuỗi đã an toàn để nhúng thẳng (bỏ qua escape của `html`). */
export function raw(s) {
  const arr = [String(s ?? '')];
  arr.join = () => arr[0];
  return arr;
}

/* -------------------------------------------------------------- async -- */
export const sleep = ms => new Promise(r => setTimeout(r, ms));

export function debounce(fn, ms) {
  let t;
  const wrapped = (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
  wrapped.cancel = () => clearTimeout(t);
  wrapped.flush = (...args) => { clearTimeout(t); fn(...args); };
  return wrapped;
}

/* --------------------------------------------------------------- misc -- */
export function deepClone(o) {
  return o == null ? o : (typeof structuredClone === 'function' ? structuredClone(o) : JSON.parse(JSON.stringify(o)));
}

export function groupBy(arr, keyFn) {
  const map = new Map();
  for (const it of arr) {
    const k = keyFn(it);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(it);
  }
  return map;
}

export function sortBy(arr, keyFn, dir = 'asc') {
  const sign = dir === 'desc' ? -1 : 1;
  return [...arr].sort((a, b) => {
    const ka = keyFn(a), kb = keyFn(b);
    if (ka == null && kb == null) return 0;
    if (ka == null) return 1;
    if (kb == null) return -1;
    return ka < kb ? -sign : ka > kb ? sign : 0;
  });
}

export function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }

export function pct(n, d) { return d > 0 ? Math.round((n / d) * 100) : 0; }

/** So khớp không dấu, không phân biệt hoa thường — cho ô tìm kiếm tiếng Việt. */
export function normalizeVi(s) {
  return String(s ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .toLowerCase().trim();
}

export function matchesQuery(haystack, query) {
  const q = normalizeVi(query);
  if (!q) return true;
  return normalizeVi(haystack).includes(q);
}

export function downloadFile(filename, content, mime = 'application/json') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function pickFile(accept = '.json') {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = accept;
    input.onchange = () => {
      const f = input.files?.[0];
      if (!f) return resolve(null);
      const reader = new FileReader();
      reader.onload = () => resolve({ name: f.name, text: String(reader.result) });
      reader.onerror = () => resolve(null);
      reader.readAsText(f);
    };
    input.click();
  });
}

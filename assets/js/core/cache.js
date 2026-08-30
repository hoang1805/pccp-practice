/**
 * Cache đọc + hàng đợi ghi offline, lưu trong IndexedDB.
 * Tham chiếu SRS §3.3 (hàng đợi offline) và §3.4 (cache có TTL).
 *
 * Mọi hàm đều "fail soft": nếu IndexedDB không dùng được (chế độ riêng tư,
 * trình duyệt chặn) thì ứng dụng vẫn chạy, chỉ mất cache.
 */

const DB_NAME = 'pccp-practicing';
const DB_VERSION = 1;
const STORE_DOCS = 'docs';    // cache tài liệu đã đọc
const STORE_QUEUE = 'queue';  // tài liệu chờ đồng bộ lên GitHub

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise(resolve => {
    let req;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      return resolve(null);
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_DOCS)) db.createObjectStore(STORE_DOCS, { keyPath: 'path' });
      if (!db.objectStoreNames.contains(STORE_QUEUE)) db.createObjectStore(STORE_QUEUE, { keyPath: 'path' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
  return dbPromise;
}

function tx(db, store, mode, fn) {
  return new Promise(resolve => {
    let result;
    try {
      const t = db.transaction(store, mode);
      const os = t.objectStore(store);
      result = fn(os);
      t.oncomplete = () => {
        // `fn` thường trả về IDBRequest. Phải lấy `.result` của nó kể cả khi
        // giá trị là `undefined` (bản ghi không tồn tại) — nếu so sánh
        // `!== undefined` thì lúc cache miss sẽ trả về chính IDBRequest,
        // và đối tượng đó là truthy nên tầng trên tưởng là cache hit.
        const isRequest = result != null && typeof result === 'object' && 'result' in result;
        resolve(isRequest ? result.result : result);
      };
      t.onerror = () => resolve(null);
      t.onabort = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

/* ---------------------------------------------------------- cache đọc -- */

/** TTL mặc định theo loại dữ liệu (ms). `progress` của chính mình luôn tươi. */
export const TTL = {
  config: 10 * 60_000,
  users: 10 * 60_000,
  problems: 30 * 60_000,
  daily: 5 * 60_000,
  own: 0,
  default: 5 * 60_000,
};

export async function cacheGet(path, maxAgeMs = TTL.default) {
  const db = await openDb();
  if (!db) return null;
  const rec = await tx(db, STORE_DOCS, 'readonly', os => os.get(path));
  // Bản ghi thiếu `data` cũng coi như không có, để tầng trên không nhận undefined.
  if (!rec || rec.data === undefined) return null;
  if (maxAgeMs >= 0 && Date.now() - rec.at > maxAgeMs) return { ...rec, stale: true };
  return { ...rec, stale: false };
}

export async function cacheSet(path, data, sha) {
  const db = await openDb();
  if (!db) return;
  await tx(db, STORE_DOCS, 'readwrite', os => os.put({ path, data, sha, at: Date.now() }));
}

export async function cacheDelete(path) {
  const db = await openDb();
  if (!db) return;
  await tx(db, STORE_DOCS, 'readwrite', os => os.delete(path));
}

export async function cacheClear() {
  const db = await openDb();
  if (!db) return;
  await tx(db, STORE_DOCS, 'readwrite', os => os.clear());
  await tx(db, STORE_QUEUE, 'readwrite', os => os.clear());
}

/* ------------------------------------------------------ hàng đợi ghi -- */
/*
 * Hàng đợi lưu **tài liệu kết quả**, không lưu hàm biến đổi (hàm không
 * serialize được). Khi đồng bộ lại, tầng store sẽ hợp nhất tài liệu này với
 * bản mới nhất trên GitHub theo `updatedAt` ở cấp bản ghi.
 */

export async function queuePut(path, data, message) {
  const db = await openDb();
  if (!db) return false;
  await tx(db, STORE_QUEUE, 'readwrite', os => os.put({ path, data, message, at: Date.now() }));
  return true;
}

export async function queueGetAll() {
  const db = await openDb();
  if (!db) return [];
  const all = await tx(db, STORE_QUEUE, 'readonly', os => os.getAll());
  return Array.isArray(all) ? all.sort((a, b) => a.at - b.at) : [];
}

export async function queueDelete(path) {
  const db = await openDb();
  if (!db) return;
  await tx(db, STORE_QUEUE, 'readwrite', os => os.delete(path));
}

export async function queueCount() {
  const db = await openDb();
  if (!db) return 0;
  const n = await tx(db, STORE_QUEUE, 'readonly', os => os.count());
  return typeof n === 'number' ? n : 0;
}

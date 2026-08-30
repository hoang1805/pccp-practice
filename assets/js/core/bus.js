/** Event bus tối giản dùng để tách tầng dữ liệu khỏi tầng giao diện. */

const listeners = new Map();

export function on(event, fn) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(fn);
  return () => off(event, fn);
}

export function off(event, fn) {
  listeners.get(event)?.delete(fn);
}

export function emit(event, payload) {
  const set = listeners.get(event);
  if (!set) return;
  for (const fn of [...set]) {
    try { fn(payload); }
    catch (err) { console.error(`[bus] lỗi ở handler "${event}"`, err); }
  }
}

export const EV = {
  SYNC_STATE:   'sync:state',    // {state:'idle'|'busy'|'pending'|'error', pending:number, message?:string}
  AUTH_CHANGED: 'auth:changed',  // session mới hoặc null
  DATA_CHANGED: 'data:changed',  // {path}
  ROUTE_CHANGED:'route:changed',
  TOAST:        'ui:toast',
};

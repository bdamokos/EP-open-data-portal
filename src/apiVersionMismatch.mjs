let mismatch = false;
const listeners = new Set();

export const apiVersionMismatch = () => mismatch;
export function subscribeApiVersionMismatch(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export function reportApiVersionMismatch(status, payload) {
  if (status !== 409 || payload?.error?.code !== 'api_version_mismatch') return false;
  if (!mismatch) {
    mismatch = true;
    for (const listener of listeners) listener();
  }
  return true;
}

// Missing public records may be published later. Keep probing, without a
// short fixed retry loop. attempts is the number of previous failures.
export const sourceMissing = error => error?.status === 404 || error?.status === 410;
export function missingSourceDelay(attempts) {
  return Math.min(7 * 86_400_000, 3_600_000 * 2 ** Math.min(Math.max(0, attempts), 8));
}

export function createPocClient(
  load: (route: string, signal: AbortSignal) => Promise<unknown>,
  options?: { maxEntries?: number; maxAge?: number; timeoutFor?: (route: string) => number },
): {
  expireMatching(matches: (route: string) => boolean): void;
  peek<T>(route: string): T | null;
  get<T>(route: string, options?: { force?: boolean }): Promise<T>;
};

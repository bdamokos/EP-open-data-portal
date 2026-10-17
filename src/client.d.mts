export function createDataClient(
  load: (route: string, signal: AbortSignal, options: { priority: 'auto' | 'low' }) => Promise<unknown>,
  options?: { maxEntries?: number; maxAge?: number; timeoutFor?: (route: string) => number; prefetchDelay?: number },
): {
  expireMatching(matches: (route: string) => boolean): void;
  peek<T>(route: string): T | null;
  get<T>(route: string, options?: { force?: boolean; priority?: 'auto' | 'low' }): Promise<T>;
  prefetch(routes: string[]): () => void;
};

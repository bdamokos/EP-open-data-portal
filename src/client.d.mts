export function dataTimeoutFor(route: string): number;
export function readJson<T>(url: string, options?: {
  signal?: AbortSignal; priority?: 'auto' | 'low'; getPriority?: () => 'auto' | 'low'; timeoutMs?: number; fetchImpl?: typeof fetch;
}, ui?: import('./uiI18n.mjs').UiFormatter): Promise<T>;
export function createDataClient(
  load: (route: string, signal: AbortSignal, options: { priority: 'auto' | 'low'; getPriority: () => 'auto' | 'low' }) => Promise<unknown>,
  options?: { maxEntries?: number; maxAge?: number; maxAgeFor?: (data: unknown, route: string) => number; timeoutFor?: (route: string) => number; prefetchDelay?: number },
): {
  expireMatching(matches: (route: string) => boolean): void;
  peek<T>(route: string): T | null;
  get<T>(route: string, options?: { force?: boolean; priority?: 'auto' | 'low'; signal?: AbortSignal }): Promise<T>;
  prefetch(routes: string[]): () => void;
};

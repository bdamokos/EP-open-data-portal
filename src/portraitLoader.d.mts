export function isManagedPortrait(url: string): boolean;
export function createPortraitLoader(options?: {
  concurrency?: number;
  backgroundConcurrency?: number;
  maxQueued?: number;
  startInterval?: number;
  fetchImpl?: typeof fetch;
  wait?: (milliseconds: number) => Promise<void>;
  now?: () => number;
}): {load(url: string, options?: {signal?: AbortSignal; priority?: 'visible'|'background'}): Promise<Blob> & {setPriority(priority: 'visible'|'background'): void}};
export const portraitLoader: ReturnType<typeof createPortraitLoader>;

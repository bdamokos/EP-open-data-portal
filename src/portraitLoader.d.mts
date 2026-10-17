export function isManagedPortrait(url: string): boolean;
export function createPortraitLoader(options?: {
  concurrency?: number;
  maxQueued?: number;
  startInterval?: number;
  fetchImpl?: typeof fetch;
  wait?: (milliseconds: number) => Promise<void>;
  now?: () => number;
}): {load(url: string, options?: {signal?: AbortSignal}): Promise<Blob>};
export const portraitLoader: ReturnType<typeof createPortraitLoader>;

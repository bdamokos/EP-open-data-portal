export function apiVersionMismatch(): boolean;
export function subscribeApiVersionMismatch(listener: () => void): () => void;
export function reportApiVersionMismatch(status: number, payload: unknown): boolean;

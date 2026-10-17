import type { SpeechMedia } from './explorerTypes';
export const PLAYER_ORIGIN: string;
export function validAudioMapping(mapping: unknown): boolean;
export function requestPlayerPlayback(target: Window, options: { eventTarget?: Window; onRequested: () => void; onError: (message:string) => void; timeoutMs?:number }): () => void;
export function requestPlayerAudio(target: Window, language: string, options: { mapping: NonNullable<SpeechMedia['audioMapping']>; eventTarget?: Window; onRequested: () => void; onError: (message:string) => void; intervalMs?:number;timeoutMs?:number;delayMs?:number;repairDelayMs?:number }): () => void;

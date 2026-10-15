import type { SpeechMedia } from './pocTypes';
export function speechFrameKey(speechId:string, language:string, audio:string, attempt:number, mapping:SpeechMedia['audioMapping']):string;
export function replayNeedsMediaRefresh(data:SpeechMedia|null, error:string|null):boolean;
export function speechEmbedUrl(media: SpeechMedia | null, speechId: string, language: string, audio: string): string | null;

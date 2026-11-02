import type { SpeechMedia } from './explorerTypes';
export function speechFrameKey(speechId:string, language:string, audio:string, mapping:SpeechMedia['audioMapping']):string;
export function speechEmbedUrl(media: SpeechMedia | null, speechId: string, language: string, audio: string): string | null;

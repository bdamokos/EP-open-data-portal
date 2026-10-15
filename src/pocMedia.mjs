import { validAudioMapping } from './pocPlayerAudio.mjs';
// Refresh timestamps do not change a playing frame. A replay or changed
// channel map starts a new, initially paused official player.
export function speechFrameKey(speechId, language, audio, attempt, mapping) {
  return JSON.stringify([speechId, language, audio, attempt, mapping?.channels ?? null]);
}
export function replayNeedsMediaRefresh(data, error) {
  return Boolean(error || !data?.available);
}
export function speechEmbedUrl(media, speechId, language, audio) {
  if (!media?.available || media.status !== 'matched' || media.speechId !== speechId || media.requestedAudio !== audio || !media.recording || !media.clip || !media.embedUrl) return null;
  if (media.initialAudio !== 'or' || media.requiresAudioCheck !== true || media.audioVerification !== 'official-content-map-runtime-check-required' || media.selectionMethod !== 'iframe-inventory-and-adaptation' || !validAudioMapping(media.audioMapping) || media.audioMapping.source?.recordingId !== media.recording.id || !media.audioMapping.channels.some(c => c.language === audio) || !media.availableAudioLanguages?.includes(audio)) return null;
  try {
    const url = new URL(media.embedUrl);
    if (url.protocol !== 'https:' || url.hostname !== 'webstreaming.europarl.europa.eu' || url.pathname !== '/ep/embed/embed.html' || url.username || url.password || url.hash) return null;
    const expected = { event: media.recording.id, language, audio: 'or', analytics: 'false', autoplay: 'false', start: media.clip.startUtc, end: media.clip.endUtc };
    if (Object.entries(expected).some(([key, value]) => url.searchParams.getAll(key).length !== 1 || url.searchParams.get(key) !== value)) return null;
    const start = Date.parse(media.clip.startUtc), end = Date.parse(media.clip.endUtc);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || end - start > 3_600_000) return null;
    return media.embedUrl;
  } catch { return null; }
}

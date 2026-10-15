import { useEffect, useRef, useState } from 'react';
import { requestPlayerAudio, requestPlayerPlayback } from './pocPlayerAudio.mjs';
import { useData } from './pocData';
import { speechEmbedUrl, speechFrameKey, replayNeedsMediaRefresh } from './pocMedia.mjs';
import type { Speech, SpeechMedia } from './pocTypes';

export function ParliamentFrame({ src, speechId, lang, audio, original, mapping }: { src:string;speechId:string;lang:string;audio:string;original:boolean;mapping:NonNullable<SpeechMedia['audioMapping']> }) {
  const frame=useRef<HTMLIFrameElement>(null);
  // The parent remounts on a changed channel map. Fetch dates alone must not
  // restart audio selection inside an already-playing iframe.
  const mappingRef=useRef(mapping);
  const [phase,setPhase]=useState('preparing');
  const [error,setError]=useState<string|null>(null);
  const [manual,setManual]=useState<string|null>(null);
  const [attempt,setAttempt]=useState(0);
  useEffect(()=>{
    setError(null);setManual(null);setPhase('preparing');
    const target=frame.current?.contentWindow;
    if(!target) {setError('Parliament’s player could not be opened.');setPhase('error');return;}
    let disposed=false;let stopPlay: (()=>void)|undefined;
    const stopAudio=requestPlayerAudio(target,audio,{mapping:mappingRef.current,eventTarget:window,onRequested:()=>{
      if(disposed)return;
      setPhase('ready');
      stopPlay=requestPlayerPlayback(target,{eventTarget:window,onRequested:()=>{},onError:message=>{if(!disposed)setManual(message);}});
    },onError:message=>{if(!disposed){stopPlay?.();setError(message);setPhase('error');}}});
    return ()=>{disposed=true;stopAudio();stopPlay?.();};
  },[src,audio,attempt]);
  useEffect(()=>{if(phase==='ready')frame.current?.parentElement?.scrollIntoView({block:'nearest'});},[phase]);
  return <>
    {phase==='preparing' && <p role="status">Preparing {original ? 'original' : lang.toUpperCase()} audio…</p>}
    {phase==='error' ? <div className="poc-notice" role="alert"><p>{error}</p><button onClick={()=>{setPhase('preparing');setAttempt(x=>x+1);}}>Retry player</button></div> : <>
      {phase==='ready' && <p className="poc-video-caption">{original ? 'Original audio' : `${lang.toUpperCase()} audio`} · European Parliament</p>}
      {manual && <p role="status">{manual}</p>}
      <div className="poc-player-frame" style={{visibility:phase==='ready' ? 'visible' : 'hidden'}} aria-hidden={phase!=='ready'}><iframe ref={frame} key={attempt} title={`European Parliament speech video · ${original ? 'original audio' : lang.toUpperCase()}`} src={src} allow="autoplay; clipboard-write; encrypted-media; picture-in-picture; web-share; fullscreen" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" tabIndex={phase==='ready' ? 0 : -1} data-speech-id={speechId} /></div>

    </>}
  </>;
}

export function PocSpeechPlayer({ speech, lang }: { speech: Speech; lang: string }) {
  const [frameAttempt,setFrameAttempt]=useState(0);
  const [request, setRequest] = useState<{ speechId: string; lang: string; original: boolean } | null>(null);
  const current = request?.speechId === speech.id && request.lang === lang ? request : null;
  const audio = current?.original ? 'or' : lang;
  const media = useData<SpeechMedia>(current ? `speech-media/${encodeURIComponent(speech.id)}?lang=${lang}${current.original ? '&audio=or' : ''}` : null);
  if (speech.kind === 'PLENARY_DEBATE_WRITTEN_STATEMENT') return <div className="poc-video-gap"><strong>Written statement · no video</strong><p>This contribution was submitted in writing.</p></div>;
  if (!speech.start || !speech.end) return <div className="poc-video-gap"><strong>Video timings unavailable</strong><p>No bounded speaking times were returned for this contribution.</p></div>;
  const embed = speechEmbedUrl(media.data, speech.id, lang, audio);
  const start = (original: boolean) => { if (current?.original === original) {setFrameAttempt(x=>x+1);if(replayNeedsMediaRefresh(media.data,media.error))media.retry();} else setRequest({ speechId: speech.id, lang, original }); };
  return <section className="poc-video" aria-label="Speech video">
    <div className="poc-video-actions">
      <button onClick={() => start(false)} aria-pressed={Boolean(current && !current.original)}>Play · {lang.toUpperCase()}</button>
      <button onClick={() => start(true)} aria-pressed={Boolean(current?.original)}>Original audio</button>
      {current && <button onClick={() => setRequest(null)}>Close video</button>}
    </div>
    {media.loading && !media.data && <p role="status">Loading video…</p>}
    {media.error && <div className="poc-notice" role="alert"><p>{media.error}</p><button onClick={media.retry}>Try video again</button></div>}
    {current && media.data && <>
      {!media.data.available ? <div className="poc-notice"><strong>{media.data.status === 'audio-unavailable' ? `${lang.toUpperCase()} audio unavailable` : ['audio-unverified','audio-selection-unverified'].includes(media.data.status) ? `${lang.toUpperCase()} audio not verified` : 'No matched speech video'}</strong><p>{media.data.reason || 'A recording with the requested audio could not be established.'}</p></div>
        : !embed ? <p role="alert">This clip is unavailable. Open the full recording below.</p>
        : <>
          <ParliamentFrame key={speechFrameKey(speech.id,lang,audio,frameAttempt,media.data.audioMapping)} src={embed} speechId={speech.id} lang={lang} audio={audio} original={current.original} mapping={media.data.audioMapping!} />
        </>}
      {media.data.recording && <p className="poc-source-link"><a href={media.data.recording.websiteUrl} target="_blank" rel="noreferrer">Full recording ↗</a>{media.data.recording.stale && <small> · Cached recording metadata</small>}</p>}
    </>}
  </section>;
}

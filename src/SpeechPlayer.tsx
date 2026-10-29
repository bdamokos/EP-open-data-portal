import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { requestPlayerAudio, requestPlayerPlayback } from './playerAudio.mjs';
import { useData } from './data';
import { speechEmbedUrl, speechFrameKey, replayNeedsMediaRefresh } from './media.mjs';
import type { Speech, SpeechMedia } from './explorerTypes';

function audioLanguageName(language:string) {
  try { return new Intl.DisplayNames(['en'],{type:'language'}).of(language)||language.toUpperCase(); }
  catch { return language.toUpperCase(); }
}

export function ParliamentFrame({ src, speechId, lang, audio, original, mapping, returnFocus }: { src:string;speechId:string;lang:string;audio:string;original:boolean;mapping:NonNullable<SpeechMedia['audioMapping']>;returnFocus?:()=>void }) {
  const frame=useRef<HTMLIFrameElement>(null);
  // The parent remounts on a changed channel map. Fetch dates alone must not
  // restart audio selection inside an already-playing iframe.
  const mappingRef=useRef(mapping);
  const [phase,setPhase]=useState('preparing');
  const [error,setError]=useState<string|null>(null);
  const [manual,setManual]=useState<string|null>(null);
  const [attempt,setAttempt]=useState(0);
  const returnFocusRef=useRef(returnFocus);returnFocusRef.current=returnFocus;
  useLayoutEffect(()=>{
    const element=frame.current;
    return()=>{
      if(!element||document.activeElement!==element)return;
      // A new channel map can replace a focused frame. Wait until removal is
      // complete so navigation or another chosen focus target wins instead.
      queueMicrotask(()=>{if(!element.isConnected&&document.activeElement===document.body)returnFocusRef.current?.();});
    };
  },[attempt]);
  useEffect(()=>{
    setError(null);setManual(null);setPhase('preparing');
    const target=frame.current?.contentWindow;
    if(!target) {setError('Parliament’s player could not be opened.');setPhase('error');return;}
    let disposed=false;let stopPlay: (()=>void)|undefined;
    const stopAudio=requestPlayerAudio(target,audio,{mapping:mappingRef.current,eventTarget:window,onRequested:()=>{
      if(disposed)return;
      setPhase('ready');
      stopPlay=requestPlayerPlayback(target,{eventTarget:window,onRequested:()=>{},onError:message=>{if(!disposed)setManual(message);}});
    },onError:message=>{if(!disposed){stopPlay?.();if(document.activeElement===frame.current)returnFocusRef.current?.();setError(message);setPhase('error');}}});
    return ()=>{disposed=true;stopAudio();stopPlay?.();};
  },[src,audio,attempt]);
  useEffect(()=>{if(phase==='ready')frame.current?.parentElement?.scrollIntoView({block:'nearest'});},[phase]);
  return <>
    {phase==='preparing' && <p role="status" lang="en">Preparing {original ? 'original' : audioLanguageName(lang)} audio…</p>}
    {phase==='error' ? <div className="explorer-notice" role="alert" lang="en"><p>{error}</p><button onClick={()=>{returnFocusRef.current?.();setPhase('preparing');setAttempt(x=>x+1);}}>Retry player</button></div> : <>
      {phase==='ready' && <p className="explorer-video-caption" lang="en">European Parliament</p>}
      {manual && <p role="status" lang="en">{manual}</p>}
      <div className="explorer-player-frame" lang="en" style={{visibility:phase==='ready' ? 'visible' : 'hidden'}} aria-hidden={phase!=='ready'}><iframe ref={frame} key={attempt} title="European Parliament speech video" src={src} allow="autoplay; clipboard-write; encrypted-media; picture-in-picture; web-share; fullscreen" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" tabIndex={phase==='ready' ? 0 : -1} data-speech-id={speechId} /></div>

    </>}
  </>;
}

export function useSpeechVideo(speech:Speech|null,lang:string,defaultOriginal=false) {
  const section=useRef<HTMLElement>(null),toggle=useRef<HTMLButtonElement>(null),audioControl=useRef<HTMLSelectElement>(null);
  const panelId='speech-video-'+useId().replace(/[^A-Za-z0-9_-]/g,'');
  const opener=useRef<{speechId:string;lang:string}|null>(null);
  const identity=useRef({speechId:speech?.id,lang});identity.current={speechId:speech?.id,lang};
  const [frameAttempt,setFrameAttempt]=useState(0);
  const [selectedOriginal,setSelectedOriginal]=useState(false);
  const [request, setRequest] = useState<{ speechId: string; lang: string; original: boolean } | null>(null);
  const written=speech?.kind==='PLENARY_DEBATE_WRITTEN_STATEMENT';
  const playable=Boolean(speech&&!written&&speech.start&&speech.end);
  const current = playable && request && request.speechId === speech?.id && request.lang === lang ? request : null;
  const audio = current?.original ? 'or' : lang;
  const media = useData<SpeechMedia>(current ? `speech-media/${encodeURIComponent(current.speechId)}?lang=${lang}${current.original ? '&audio=or' : ''}` : null);
  useEffect(()=>{setRequest(null);setSelectedOriginal(false);},[speech?.id,lang,playable]);
  const embed = speech ? speechEmbedUrl(media.data, speech.id, lang, audio) : null;
  const returnFocus=()=>{
    if(!section.current?.isConnected)return;
    const saved=opener.current;
    if(!saved||saved.speechId!==identity.current.speechId||saved.lang!==identity.current.lang)return;
    if(toggle.current?.isConnected)toggle.current.focus({preventScroll:true});
  };
  const close=()=>{returnFocus();setRequest(null);setSelectedOriginal(false);};
  const start = (original: boolean) => {
    if(!speech||!playable)return;
    opener.current={speechId:speech.id,lang};setSelectedOriginal(original);
    if (current?.original === original) {setFrameAttempt(x=>x+1);if(replayNeedsMediaRefresh(media.data,media.error))media.retry();}
    else setRequest({ speechId: speech.id, lang, original });
  };
  const languageName=audioLanguageName(lang),activeName=current?.original?'Original':languageName;
  const changed=Boolean(current&&selectedOriginal!==current.original);
  const panel=<section ref={section} id={panelId} hidden={!current} className="explorer-video" lang="en" aria-label="Speech video" onKeyDown={event=>{if(event.key==='Escape'){event.stopPropagation();close();}}}>
    {current&&<>
      <div className="explorer-video-heading"><strong>Speech video</strong><button onClick={close}>Close video</button></div>
      <div className="explorer-video-controls">
        <label>Audio<select ref={audioControl} value={selectedOriginal?'original':'language'} onChange={event=>setSelectedOriginal(event.target.value==='original')}>
          <option value="language">{languageName}</option><option value="original">Original (floor audio)</option>
        </select></label>
        {changed?<button onClick={()=>{audioControl.current?.focus({preventScroll:true});start(selectedOriginal);}}>Restart video</button>:<button disabled={media.loading||!media.data?.available} onClick={()=>{if(replayNeedsMediaRefresh(media.data,media.error))audioControl.current?.focus({preventScroll:true});start(current.original);}}>Replay video</button>}
      </div>
      {media.loading && !media.data && <p role="status">Loading video…</p>}
    {media.error && <div className="explorer-notice" role="alert"><p>{media.error}</p><button onClick={()=>{returnFocus();media.retry();}}>Try video again</button></div>}
    {media.data && <>
      {!media.data.available ? <div className="explorer-notice" role="alert"><strong>{media.data.status === 'audio-unavailable' ? `${activeName} audio unavailable` : ['audio-unverified','audio-selection-unverified'].includes(media.data.status) ? `${activeName} audio unavailable` : 'Video unavailable'}</strong>{media.data.reason&&<p>{media.data.reason}</p>}{!current.original&&media.data.status?.startsWith('audio-')&&<button onClick={()=>{audioControl.current?.focus({preventScroll:true});start(true);}}>Try original audio</button>}</div>
        : !embed ? <p role="alert">This clip is unavailable. Open the full recording below.</p>
        : <>
          <ParliamentFrame key={speechFrameKey(current.speechId,lang,audio,frameAttempt,media.data.audioMapping)} src={embed} speechId={current.speechId} lang={lang} audio={audio} original={current.original} mapping={media.data.audioMapping!} returnFocus={returnFocus} />
        </>}
      {media.data.recording && <p className="explorer-source-link"><a href={media.data.recording.websiteUrl} target="_blank" rel="noreferrer">Full recording ↗</a>{media.data.recording.stale && <small> · Cached recording metadata</small>}</p>}
    </>}
    </>}
  </section>;
  if(!speech)return {toggle:null,panel:null};
  if(!playable)return {toggle:<span className="explorer-video-gap" lang="en"><strong>{written?'Written statement · no video':'Video unavailable'}</strong></span>,panel:null};
  return {toggle:<button ref={toggle} className="explorer-video-toggle" lang="en" title={current?'Close this speech’s video':'Open this speech’s video'} aria-expanded={Boolean(current)} aria-controls={panelId} onClick={()=>current?close():start(defaultOriginal)}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m10 9 5 3-5 3Z" fill="currentColor" stroke="none"/></svg><span>Video</span></button>,panel};
}

export function SpeechPlayer({speech,lang}:{speech:Speech;lang:string}) {
  const video=useSpeechVideo(speech,lang);
  return <>{video.toggle}{video.panel}</>;
}

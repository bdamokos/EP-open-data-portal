import {UiMessage, useUiI18n} from './UiI18nReact';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { useData } from './data';
import { speechEmbedUrl, speechFrameKey, replayNeedsMediaRefresh } from './media.mjs';
import type { Speech, SpeechMedia } from './explorerTypes';

function audioLanguageName(language:string,locale='en') {
  try { return new Intl.DisplayNames([locale],{type:'language'}).of(language)||language.toUpperCase(); }
  catch { return language.toUpperCase(); }
}

export function ParliamentFrame({ src, speechId, returnFocus }: { src:string;speechId:string;lang:string;audio:string;original:boolean;mapping:NonNullable<SpeechMedia['audioMapping']>;returnFocus?:()=>void }) {
  const ui = useUiI18n();
  const frame=useRef<HTMLIFrameElement>(null);
  const returnFocusRef=useRef(returnFocus);returnFocusRef.current=returnFocus;
  useLayoutEffect(()=>{
    const element=frame.current;
    return()=>{
      if(!element||document.activeElement!==element)return;
      // A new channel map can replace a focused frame. Wait until removal is
      // complete so navigation or another chosen focus target wins instead.
      queueMicrotask(()=>{if(!element.isConnected&&document.activeElement===document.body)returnFocusRef.current?.();});
    };
  },[]);
  useEffect(()=>{frame.current?.parentElement?.scrollIntoView({block:'nearest'});},[]);
  return <>
    <p className="explorer-video-caption" lang={ui.language}><UiMessage id="batch5.speechplayer.tsx.25.75"/></p>
    <div className="explorer-player-frame" lang={ui.language}><iframe ref={frame} title={ui.t("batch5.speechplayer.tsx.26.76")} src={src} allow="autoplay; clipboard-write; encrypted-media; picture-in-picture; web-share; fullscreen" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" data-speech-id={speechId} /></div>
  </>;
}

export function useSpeechVideo(speech:Speech|null,lang:string,defaultOriginal=false) {
  const ui = useUiI18n();
  const section=useRef<HTMLElement>(null),toggle=useRef<HTMLButtonElement>(null),audioControl=useRef<HTMLSelectElement>(null);
  const panelId='speech-video-'+useId().replace(/[^A-Za-z0-9_-]/g,'');
  const opener=useRef<{speechId:string;lang:string}|null>(null);
  const identity=useRef({speechId:speech?.id,lang});identity.current={speechId:speech?.id,lang};
  const [frameAttempt,setFrameAttempt]=useState(0);
  const [selectedOriginal,setSelectedOriginal]=useState(false);
  const [request, setRequest] = useState<{ speechId: string; lang: string; original: boolean } | null>(null);
  const written=speech?.kind==='PLENARY_DEBATE_WRITTEN_STATEMENT';
  const playable=Boolean(speech&&!written&&speech.start&&speech.end);
  const current = (((playable && request) && (request.speechId === speech?.id)) && (request.lang === lang)) ? request : null;
  const audio = current?.original ? 'or' : lang;
  const media = useData<SpeechMedia>(current ? (`speech-media/${encodeURIComponent(current.speechId)}?lang=${lang}${current.original ? '&audio=or' : ''}`) : null);
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
  const languageName=audioLanguageName(lang,ui.locale),activeName=current?.original ? ui.t("speechplayer.original.c0a806") : languageName;
  const changed=Boolean(current&&selectedOriginal!==current.original);
  const panel=<section ref={section} id={panelId} hidden={!current} className="explorer-video" lang={ui.language} aria-label={ui.t("batch5.speechplayer.tsx.60.77")} onKeyDown={event=>{if(event.key==='Escape'){event.stopPropagation();close();}}}>
    {current&&<>
      <div className="explorer-video-heading"><strong><UiMessage id="batch5.speechplayer.tsx.60.77"/></strong><button onClick={close}><UiMessage id="batch5.speechplayer.tsx.62.79"/></button></div>
      <div className="explorer-video-controls">
        <label><UiMessage id="batch5.speechplayer.tsx.64.80"/><select ref={audioControl} value={selectedOriginal ? 'original' : 'language'} onChange={event=>setSelectedOriginal(event.target.value==='original')}>
          <option value="language">{languageName}</option><option value="original"><UiMessage id="batch5.speechplayer.tsx.65.81"/></option>
        </select></label>
        {changed ? <button onClick={()=>{audioControl.current?.focus({preventScroll:true});start(selectedOriginal);}}><UiMessage id="batch5.speechplayer.tsx.67.83"/></button> : <button disabled={media.loading||!media.data?.available} onClick={()=>{if(replayNeedsMediaRefresh(media.data,media.error))audioControl.current?.focus({preventScroll:true});start(current.original);}}><UiMessage id="batch5.speechplayer.tsx.67.82"/></button>}
      </div>
      {media.loading && !media.data && <p role="status"><UiMessage id="batch5.speechplayer.tsx.69.84"/></p>}
    {media.error && <div className="explorer-notice" role="alert"><p>{media.error}</p><button onClick={()=>{returnFocus();media.retry();}}><UiMessage id="batch5.speechplayer.tsx.70.85"/></button></div>}
    {media.data && <>
      {(!media.data.available) ? <div className="explorer-notice" role="alert"><strong>{(media.data.status === 'audio-unavailable') ? ui.t("speechplayer.activename_audio_unavailable.545cd9", {activeName: String(activeName)}) : (['audio-unverified','audio-selection-unverified'].includes(media.data.status) ? ui.t("speechplayer.activename_audio_unavailable.545cd9", {activeName: String(activeName)}) : ui.t("speechplayer.video_unavailable.d0baed"))}</strong>{media.data.reason&&<p>{media.data.reason}</p>}{!current.original&&media.data.status?.startsWith('audio-')&&<button onClick={()=>{audioControl.current?.focus({preventScroll:true});start(true);}}><UiMessage id="batch5.speechplayer.tsx.72.86"/></button>}</div> : ((!embed) ? <p role="alert"><UiMessage id="batch5.speechplayer.tsx.73.87"/></p> : <>
          <ParliamentFrame key={speechFrameKey(current.speechId,lang,audio,frameAttempt,media.data.audioMapping)} src={embed} speechId={current.speechId} lang={lang} audio={audio} original={current.original} mapping={media.data.audioMapping!} returnFocus={returnFocus} />
        </>)}
      {media.data.recording && <p className="explorer-source-link"><a href={media.data.recording.websiteUrl} target="_blank" rel="noreferrer"><UiMessage id="batch5.speechplayer.tsx.77.88"/></a>{media.data.recording.stale && <small>  <UiMessage id="speechplayer.cached_recording_metadata.2a07a8"/></small>}</p>}
    </>}
    </>}
  </section>;
  if(!speech)return {toggle:null,panel:null};
  if(!playable)return {toggle:<span className="explorer-video-gap" lang={ui.language}><strong>{written ? ui.t("speechplayer.written_statement_no_video.6220cd") : ui.t("speechplayer.video_unavailable.d0baed")}</strong></span>,panel:null};
  return {toggle:<button ref={toggle} className="explorer-video-toggle" lang={ui.language} title={current ? ui.t("speechplayer.close_this_speech_s_video.635e95") : ui.t("speechplayer.open_this_speech_s_video.9e0813")} aria-expanded={Boolean(current)} aria-controls={panelId} onClick={()=>current ? close() : start(defaultOriginal)}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m10 9 5 3-5 3Z" fill="currentColor" stroke="none"/></svg><span><UiMessage id="batch5.speechplayer.tsx.83.89"/></span></button>,panel};
}

export function SpeechPlayer({speech,lang}:{speech:Speech;lang:string}) {
  const video=useSpeechVideo(speech,lang);
  return <>{video.toggle}{video.panel}</>;
}

export const PLAYER_ORIGIN = 'https://webstreaming.europarl.europa.eu';

// Call only after the requested audio has been established. The official method
// response acknowledges the play Promise; it does not acknowledge audio setters.
export function requestPlayerPlayback(target, { eventTarget = globalThis, onRequested, onError, timeoutMs = 8_000 } = {}) {
  if (!target) throw new Error('Invalid player playback request.');
  let finished = false;
  const stop = () => {
    clearTimeout(deadline);
    eventTarget.removeEventListener('message', receive);
    finished = true;
  };
  const fail = () => { if (!finished) { stop(); onError?.('Press Play in the player.'); } };
  const receive = event => {
    if (finished || event.origin !== PLAYER_ORIGIN || event.source !== target || event.data?.key !== 'method:play') return;
    if (event.data.isError === true) return fail();
    if (event.data.isError !== false) return;
    stop(); onRequested?.();
  };
  eventTarget.addEventListener('message', receive);
  const deadline = setTimeout(fail, timeoutMs);
  try { target.postMessage({ type: 'method', name: 'play' }, PLAYER_ORIGIN); } catch { fail(); }
  return stop;
}

const EVENTS = ['audioadaptation', 'audiodownloadqualitychanged'];
const bounded = value => typeof value === 'string' && value.length > 0 && value.length <= 128;
export function validAudioMapping(mapping) {
  if (mapping?.schemaVersion !== 1 || !Array.isArray(mapping.channels) || !mapping.channels.length || mapping.channels.length > 32) return false;
  const slots=new Set(), codes=new Set(), languages=new Set();
  return mapping.channels.every(c => {
    if (!Number.isInteger(c.slot) || c.slot < 0 || c.slot >= 32 || !/^[a-z]{2}$/.test(c.language) || !/^q[a-z]{2}$/.test(c.providerCode) || slots.has(c.slot) || codes.has(c.providerCode) || languages.has(c.language)) return false;
    slots.add(c.slot);codes.add(c.providerCode);languages.add(c.language);return true;
  });
}
export function playerAudioTarget(language, mapping, tracks, labels) {
  if (!validAudioMapping(mapping) || !Array.isArray(tracks) || !Array.isArray(labels)) return null;
  const channel=mapping.channels.find(c=>c.language===language);
  if (!channel || !tracks.length || tracks.length>128 || !tracks.every(bounded) || new Set(tracks).size!==tracks.length || !labels.length || labels.length>128 || !labels.every(p=>Array.isArray(p)&&p.length===2&&p.every(bounded)) || new Set(labels.map(p=>p[0])).size!==labels.length) return null;
  // ISO-coded archives are authoritative at runtime; private codes use the
  // server's original array slot mapping, never a display/sort position.
  const code=tracks.includes(language) ? language : channel.providerCode;
  if (!tracks.includes(code)) return null;
  const pair=labels.find(p=>p[0]===code);
  if (!pair || labels.filter(p=>tracks.includes(p[0]) && p[1]===pair[1]).length!==1) return null;
  return {code,label:pair[1]};
}
export function matchesAudioRepresentation(label, representation) {
  if (!bounded(label) || !bounded(representation)) return false;
  const escaped=label.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  return new RegExp(`^${escaped}\\s+(?:AUDIO|audio[0-9]+)$`).test(representation);
}
function representation(data) {
  if (data?.isError!==false || !data.result || typeof data.result!=='object') return null;
  const r=data.result;
  if (data.key==='event:audioadaptation' && r.type==='audioadaptation') return bounded(r.representationID) ? r.representationID : null;
  if (data.key==='event:audiodownloadqualitychanged' && r.type==='audiodownloadqualitychanged' && bounded(r.targetQualityId) && r.targetQuality?.id===r.targetQualityId && (r.targetQuality.label===undefined || r.targetQuality.label===r.targetQualityId)) return r.targetQualityId;
  return null;
}

// Both the content map and live getters must agree. A setter response is not
// selection proof; only the requested representation event releases playback.
// Once verified, the official player's controls own subsequent audio choices.
export function requestPlayerAudio(target, language, { mapping, eventTarget=globalThis, onRequested, onError, intervalMs=500, timeoutMs=25_000, delayMs=500, repairDelayMs=2_000 }={}) {
  if (!target || !/^[a-z]{2}$/.test(language) || !validAudioMapping(mapping)) throw new Error('Invalid player audio request.');
  let finished=false, verified=false, tracks=null, labels=null, selected=null, initial=null, sent=false, delay, repairTimer, repairPhase=null, probe=null, latestRepresentation=null;
  const post=data=>target.postMessage(data,PLAYER_ORIGIN);
  const stop=()=>{
    if (finished) return;
    finished=true;clearInterval(poll);clearTimeout(deadline);clearTimeout(delay);clearTimeout(repairTimer);
    eventTarget.removeEventListener('message',receive);
    for(const name of EVENTS) {try {post({type:'off',name});} catch { /* detached frame */ }}
  };
  const fail=()=>{if(!finished){stop();onError?.('Audio could not be loaded. Try again or choose Original audio.');}};
  const success=()=>{if(!finished && !verified){verified=true;stop();onRequested?.();}};
  const selectAfterInitial=()=>{
    if(finished || sent || !selected || !initial || !matchesAudioRepresentation(initial.label,latestRepresentation))return;
    clearTimeout(repairTimer);
    if(language==='or')return success();
    clearTimeout(delay);
    // The wrapper applies audio=or after its getters first become available.
    // Let those initial original events settle before the requested setter.
    // Only a subsequent requested representation event establishes selection.
    delay=setTimeout(()=>{if(finished)return;sent=true;try{post({type:'set',name:'audio',value:language});}catch{fail();}},delayMs);
  };
  const repairInitial=()=>{
    if(finished || verified || matchesAudioRepresentation(initial.label,latestRepresentation))return;
    // If Original was already active before subscriptions, a same-track setter
    // emits no event. One paused, event-verified round trip obtains fresh proof.
    const channel=mapping.channels.find(c=>c.language!=='or' && playerAudioTarget(c.language,mapping,tracks,labels));
    if(!channel)return fail();
    probe={language:channel.language,...playerAudioTarget(channel.language,mapping,tracks,labels)};
    repairPhase='probe';clearTimeout(delay);
    try{post({type:'set',name:'audio',value:probe.language});}catch{fail();}
  };
  const ready=()=>{
    if(selected || !tracks?.length || !labels?.length) return;
    selected=playerAudioTarget(language,mapping,tracks,labels);
    initial=playerAudioTarget('or',mapping,tracks,labels);
    if(!selected || !initial) return fail();
    // Getters can be ready before the lower player's event subscriptions.
    // Re-register through the public off/on interface and keep polling until
    // an actual representation arrives; cached early callbacks are not replayed.
    subscribe();selectAfterInitial();
    if(!verified && !matchesAudioRepresentation(initial.label,latestRepresentation))repairTimer=setTimeout(repairInitial,repairDelayMs);
    if(language==='or' && !verified){
      delay=setTimeout(()=>{if(finished || verified)return;sent=true;try{post({type:'set',name:'audio',value:'or'});}catch{fail();}},delayMs);
    }
  };
  const receive=event=>{
    if(finished || event.origin!==PLAYER_ORIGIN || event.source!==target) return;
    const data=event.data;
    const id=representation(data);
    if(id){
      if(repairPhase==='probe'){
        if(matchesAudioRepresentation(probe.label,id)){repairPhase='original';try{post({type:'set',name:'audio',value:'or'});}catch{fail();}}
        return;
      }
      if(repairPhase==='original'){
        if(!matchesAudioRepresentation(initial.label,id))return;
        repairPhase='restored';sent=false;
      }
      latestRepresentation=id;
      if(selected && sent && matchesAudioRepresentation(selected.label,id))success();else selectAfterInitial();return;
    }
    if(verified || !['get:availableAudio','get:availableLang'].includes(data?.key))return;
    if(data.isError===true)return fail();
    if(data.isError!==false || !Array.isArray(data.result))return;
    if(data.key==='get:availableAudio') tracks=data.result;else labels=data.result;
    ready();
  };
  const subscribe=()=>{for(const name of EVENTS){post({type:'off',name});post({type:'on',name});}};
  const ask=()=>{if(finished || verified)return;try{
    subscribe();
    post({type:'get',name:'availableAudio'});post({type:'get',name:'availableLang'});
  }catch{fail();}};
  eventTarget.addEventListener('message',receive);
  const poll=setInterval(ask,intervalMs),deadline=setTimeout(fail,timeoutMs);
  ask();return stop;
}

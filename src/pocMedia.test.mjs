import test from 'node:test';
import assert from 'node:assert/strict';
import { speechEmbedUrl, speechFrameKey, replayNeedsMediaRefresh } from './pocMedia.mjs';
const id='MTG-PL-2026-10-07-OTH-2017097993206';
const example = () => ({ speechId:id,status:'matched',available:true,requestedAudio:'hu',initialAudio:'or',requiresAudioCheck:true,availableAudioLanguages:['or','hu'],audioVerification:'official-content-map-runtime-check-required',selectionMethod:'iframe-inventory-and-adaptation',selectionVerifiedLanguages:[],audioMapping:{schemaVersion:1,channels:[{slot:0,language:'or',providerCode:'qbf'},{slot:16,language:'hu',providerCode:'qaw'}],source:{recordingId:'20261007-0900-PLENARY'}},recording:{id:'20261007-0900-PLENARY'},clip:{startUtc:'2026-10-07T09:19:15Z',endUtc:'2026-10-07T09:20:55Z'},embedUrl:'https://webstreaming.europarl.europa.eu/ep/embed/embed.html?event=20261007-0900-PLENARY&language=hu&audio=or&analytics=false&autoplay=false&start=2026-10-07T09:19:15Z&end=2026-10-07T09:20:55Z' });
test('replay remounts without refreshing matched media; timestamp-only refresh keeps the frame',()=>{
  const media=example(), key=attempt=>speechFrameKey(id,'hu','hu',attempt,media.audioMapping);
  const initial=key(0);assert.notEqual(key(1),initial);
  assert.equal(replayNeedsMediaRefresh(media,null),false);
  media.audioMapping.source.sourceFetchedAt='2026-10-14T10:00:00Z';media.audioMapping.source.stale=true;
  assert.equal(key(0),initial);
  media.audioMapping.channels=[...media.audioMapping.channels,{slot:1,language:'en',providerCode:'qbd'}];
  assert.notEqual(key(0),initial);
  assert(replayNeedsMediaRefresh(media,'failed'));assert(replayNeedsMediaRefresh({...media,available:false},null));
});
test('accepts the matched official clip without deriving recording IDs',()=>assert(speechEmbedUrl(example(),id,'hu','hu')));
test('rejects wrong language, unknown tracks and unrelated destinations',()=>{
  assert.equal(speechEmbedUrl(example(),id,'fr','fr'),null);
  const unverified=example();unverified.audioVerification='unverified';assert.equal(speechEmbedUrl(unverified,id,'hu','hu'),null);
  const wrongHost=example();wrongHost.embedUrl=wrongHost.embedUrl.replace('webstreaming.europarl.europa.eu','example.org');assert.equal(speechEmbedUrl(wrongHost,id,'hu','hu'),null);
});
test('requires the returned clip, recording and privacy parameters',()=>{
  for(const change of [m=>m.available=false,m=>m.recording.id='other-recording',m=>m.embedUrl=m.embedUrl.replace('analytics=false','analytics=true'),m=>m.embedUrl+='&audio=en',m=>m.clip.endUtc=m.clip.startUtc]){
    const m=example();change(m);assert.equal(speechEmbedUrl(m,id,'hu','hu'),null);
  }
});
test('original is a separate explicit request, even without a decoded inventory claim',()=>{
  const original=example();original.requestedAudio='or';original.availableAudioLanguages=['or'];
  assert(speechEmbedUrl(original,id,'hu','or'));assert.equal(speechEmbedUrl(original,id,'hu','hu'),null);
});

test('a track menu alone does not establish selected interpretation',()=>{const m=example();m.audioVerification='official-player-menu';assert.equal(speechEmbedUrl(m,id,'hu','hu'),null);});

test('runtime guard requires content map, recording provenance and paused original entry',()=>{
  for(const change of [m=>m.requiresAudioCheck=false,m=>m.selectionMethod='query',m=>delete m.audioMapping,m=>m.audioMapping.source.recordingId='other',m=>m.embedUrl=m.embedUrl.replace('autoplay=false','autoplay=true'),m=>m.embedUrl=m.embedUrl.replace('audio=or','audio=hu'),m=>m.audioMapping.channels=m.audioMapping.channels.filter(c=>c.language!=='hu')]) {const m=example();change(m);assert.equal(speechEmbedUrl(m,id,'hu','hu'),null);}
});

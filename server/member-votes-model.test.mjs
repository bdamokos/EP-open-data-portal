import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {projectMemberDecision,projectMemberSitting,memberVoteAlignment} from './member-votes-model.mjs';

const fixture=JSON.parse(readFileSync(new URL('./fixtures/member-votes.json',import.meta.url),'utf8'));
const full=JSON.parse(readFileSync(new URL('./fixtures/insights-live-20261014.json',import.meta.url),'utf8'));
const snapshot=fixture.snapshots[0];
const decision=suffix=>snapshot.decisions.find(node=>node.activity_id.endsWith(suffix));
// The older selected-fields fixture omitted type. Restore it from the exact
// same public decision before reusing that fixture's untrimmed voter arrays.
const fullDecision={...decision('197457'),...full.decisions.payload.data.find(node=>node.activity_id.endsWith('197457'))};
const project=(raw,memberId='197591',state=snapshot,language='en')=>projectMemberDecision(raw,state,memberId,language);

test('decision reference text decodes XML characters once while preserving percentages and source labels',()=>{
  const raw={...fullDecision,activity_label:{fr:'Ordre du jour - S&D - Émeutes'},referenceText:{
    fr:'Demande du groupe S&amp;D - Émeutes ',
    en:'10% &lt; 20% &amp; &#49;&#48;&#37; &#x1F600; &quot;quoted&quot; &apos;text&apos;',
    hu:'Árvíztűrő tükörfúrógép: 10% > 5% & S&D',
  }},before=structuredClone(raw),vote=project(raw);
  assert.equal(vote.referenceTexts.fr,'Demande du groupe S&D - Émeutes ');
  assert.equal(vote.referenceTexts.en,'10% < 20% & 10% 😀 "quoted" \'text\'');
  assert.equal(vote.referenceTexts.hu,raw.referenceText.hu);
  assert.deepEqual(vote.titles,raw.activity_label);
  assert.deepEqual(raw,before,'decoding must not change retained source text');
  const fallback=project({...raw,activity_label:undefined,headingLabel:undefined},'197591',snapshot,'fr');
  assert.equal(fallback.title,'Demande du groupe S&D - Émeutes ');
  assert.equal(fallback.titleLanguage,'fr');
});

test('reference text preserves unknown, invalid and nested escapes without interpreting markup or URL encoding',()=>{
  for(const [input,expected] of [
    ['&amp;lt;tag&amp;gt;','&lt;tag&gt;'],
    ['&lt;img src=x onerror=alert(1)&gt;','<img src=x onerror=alert(1)>'],
    ['10% / 10%20 / %26 / A+B','10% / 10%20 / %26 / A+B'],
    ['&unknown; &nbsp; &amp without semicolon','&unknown; &nbsp; &amp without semicolon'],
    ['&#0; &#xD800; &#1114112; &#xFFFF; &#999999999999999999999;','&#0; &#xD800; &#1114112; &#xFFFF; &#999999999999999999999;'],
  ])assert.equal(project({...fullDecision,referenceText:{en:input}}).referenceTexts.en,expected);
});
const absolute=path=>'https://data.europarl.europa.eu/'+path;

test('public Tinagli sample keeps actual FOR separate from intended abstention and preserves source provenance',()=>{
  const vote=project(decision('197457'));
  assert.equal(vote.id,'MTG-PL-2026-10-07-DEC-197457');
  assert.equal(vote.uri,absolute('eli/dl/event/'+vote.id));
  assert.equal(vote.sittingId,'MTG-PL-2026-10-07');assert.equal(vote.date,'2026-10-07');
  assert.deepEqual(vote.actualPosition,{status:'recorded',position:'for'});
  assert.deepEqual(vote.intention,{status:'reported',positions:['abstaining']});
  assert.deepEqual(vote.scope,{kind:'whole-text',basis:'english-reference-label'});
  assert.equal(vote.ballotStatus,'conducted');assert.equal(vote.method,'VOTE_ELECTRONIC_ROLLCALL');
  assert.equal(vote.outcome,'ADOPTED');assert.equal(vote.historicalGroup,null);
  assert.deepEqual(vote.totals,{for:454,against:86,abstaining:110});
  assert.equal(vote.namedVoters.available,true);
  assert.equal(vote.namedVoters.totalsMatch,false,'selected voter fixture must not pretend to contain all published voters');
  assert.match(fixture.description,/Trimmed counts/);
  assert.strictEqual(vote.sources.decisions,snapshot.sources.decisions);
  assert.deepEqual(vote.sources,snapshot.sources);
  assert.equal(vote.sources.decisions[0].fetchedAt,'2026-10-17T18:39:08.315787Z');
});

test('full existing public vote validates each published tally without deriving a participation denominator',()=>{
  const vote=project(fullDecision);
  assert.deepEqual(vote.namedVoters.counts,{for:454,against:86,abstaining:110});
  assert.equal(vote.namedVoters.totalsMatch,true);
  assert.deepEqual(vote.namedVoters.conflictingPersonIds,[]);
  assert.equal(vote.namedVoters.malformedReferences,0);
  assert.deepEqual(project(fullDecision,'999999').actualPosition,{status:'no-record',position:null});
  assert.equal('attendance' in vote,false);assert.equal('participation' in vote,false);
  assert.equal('group' in vote,false);
});

test('exact decision → result → agenda joins preserve document and nested procedure references',()=>{
  const vote=project(decision('197457'));
  assert.deepEqual(vote.context.resultIds,['MTG-PL-2026-10-07-VOT-ITM-993151']);
  assert.deepEqual(vote.context.agendaItemIds,['MTG-PL-2026-10-07-OJ-ITM-V-48']);
  assert(vote.context.documentIds.includes('A-10-2026-0237'));
  assert(vote.context.documentIds.includes('PV-10-2026-10-07-RCV-ITM-054'));
  assert.deepEqual(vote.context.procedureIds,['2025-2117']);
  assert.deepEqual(vote.context.missingResultIds,[]);assert.deepEqual(vote.context.missingAgendaItemIds,[]);
  const from=absolute('eli/dl/event/MTG-PL-2026-10-07-VOT-ITM-993151');
  assert(vote.context.relationships.some(row=>row.from===from&&row.field==='inverse_consists_of'&&row.to===absolute('eli/dl/proc/2025-2117')));
  assert(vote.context.relationships.some(row=>row.from===vote.uri&&row.field==='inverse_consists_of'&&row.to===from));
  const unrelated={...snapshot.results[0],id:'eli/dl/event/unrelated',consists_of:[],based_on_a_realization_of:['eli/dl/doc/UNRELATED']};
  const missing=project(decision('197457'),'197591',{...snapshot,results:[unrelated]});
  assert.deepEqual(missing.context.missingResultIds,['MTG-PL-2026-10-07-VOT-ITM-993151']);
  assert.deepEqual(missing.context.agendaItemIds,[]);assert.deepEqual(missing.context.procedureIds,[]);
  assert(!missing.context.documentIds.includes('UNRELATED'));
  const missingAgenda=project(decision('197457'),'197591',{...snapshot,agenda:[]});
  assert.deepEqual(missingAgenda.context.missingAgendaItemIds,['MTG-PL-2026-10-07-OJ-ITM-V-48']);
  assert.deepEqual(missingAgenda.context.agendaItemIds,['MTG-PL-2026-10-07-OJ-ITM-V-48']);
});

test('197847 remains the exact split part and amendment references are retained without inventing a parent document',()=>{
  const split=project(decision('197847'));
  assert.deepEqual(split.scope,{kind:'split-part',basis:'exact-component-reference'});
  assert.deepEqual(split.context.componentIds,['MTG-PL-2026-10-07-VOT-ITM-993151-SPLIT-1-2']);
  assert.deepEqual(split.context.amendmentIds,[]);
  assert(split.context.relationships.some(row=>row.field==='decided_on_a_realization_of'&&row.to.endsWith('/MTG-PL-2026-10-07-VOT-ITM-993151-SPLIT-1-2')));
  const amendment=project(decision('197819'));
  assert.deepEqual(amendment.scope,{kind:'amendment',basis:'exact-component-reference'});
  assert.deepEqual(amendment.context.amendmentIds,['A-10-2026-0237-AM-12']);
  const splitAmendment=project(decision('197866'));
  assert.deepEqual(splitAmendment.scope,{kind:'split-part',basis:'exact-component-reference'});
  assert.deepEqual(splitAmendment.context.amendmentIds,['A-10-2026-0237-AM-40']);
  assert.deepEqual(splitAmendment.context.componentIds,['MTG-PL-2026-10-07-VOT-ITM-993151-SPLIT-3-2']);
  const isolated=project(decision('197819'),'197591',{...snapshot,results:[]});
  assert(!isolated.context.documentIds.includes('A-10-2026-0237'),'do not derive a document relationship merely by removing an AM suffix');
});

test('forward declared decision children retain result context without inventing an inverse observation',()=>{
  const raw={...decision('197457')};delete raw.inverse_consists_of;
  const vote=project(raw);
  assert.deepEqual(vote.context.resultIds,['MTG-PL-2026-10-07-VOT-ITM-993151']);
  assert.deepEqual(vote.context.agendaItemIds,['MTG-PL-2026-10-07-OJ-ITM-V-48']);
  assert(vote.context.documentIds.includes('A-10-2026-0237'));
  assert.deepEqual(vote.context.procedureIds,['2025-2117']);
  assert(vote.context.relationships.some(row=>row.from.endsWith('/MTG-PL-2026-10-07-VOT-ITM-993151')&&row.field==='consists_of'&&row.to===vote.uri));
  assert(!vote.context.relationships.some(row=>row.from===vote.uri&&row.field==='inverse_consists_of'));
});

test('unlinked 5 October procedural roll call remains available without normal agenda context',()=>{
  const state=fixture.snapshots[1],raw=state.decisions[0],vote=project(raw,'197591',state);
  assert.equal(vote.id,'MTG-PL-2026-10-05-DEC-197673');
  assert.equal(vote.ballotStatus,'conducted');
  assert.deepEqual(vote.scope,{kind:'procedural',basis:'english-reference-label'});
  assert.deepEqual(vote.context.resultIds,['MTG-PL-2026-10-05-VOT-ITM-000001']);
  assert.deepEqual(vote.context.agendaItemIds,[]);assert.deepEqual(vote.context.procedureIds,[]);
  assert.deepEqual(vote.context.missingResultIds,[]);assert.deepEqual(vote.context.missingAgendaItemIds,[]);
});

test('lapsed rollcall-method decision is not a conducted ballot and supplies no zero totals',()=>{
  const vote=project(decision('197491'));
  assert.equal(vote.method,'VOTE_ELECTRONIC_ROLLCALL');assert.equal(vote.outcome,'LAPSED');
  assert.equal(vote.ballotStatus,'not-conducted');
  assert.deepEqual(vote.actualPosition,{status:'not-conducted',position:null});
  assert.equal(vote.namedVoters.available,false);assert.equal(vote.namedVoters.counts,null);
  assert.equal(vote.namedVoters.totalsMatch,null);
  assert.deepEqual(vote.totals,{for:null,against:null,abstaining:null});
  const withdrawn=project({...fullDecision,decision_outcome:'def/ep-statuses/WITHDRAWN'});
  assert.equal(withdrawn.ballotStatus,'not-conducted');assert.equal(withdrawn.actualPosition.status,'not-conducted');
  assert.equal(withdrawn.namedVoters.available,false);
});

test('missing actual arrays and non-named votes remain unavailable, not absence or abstention',()=>{
  const missing={...fullDecision};delete missing.had_voter_against;
  const vote=project(missing);
  assert.equal(vote.ballotStatus,'unknown');assert.equal(vote.namedVoters.available,false);
  assert.equal(vote.namedVoters.counts,null);assert.equal(vote.namedVoters.totalsMatch,null);
  assert.deepEqual(vote.actualPosition,{status:'unavailable',position:null});
  const methodOnly=project({id:fullDecision.id,activity_id:fullDecision.activity_id,type:'Decision',decision_method:'def/ep-decision-methods/VOTE_ELECTRONIC_ROLLCALL'});
  assert.equal(methodOnly.ballotStatus,'unknown');
  const hand=project({...missing,decision_method:'def/ep-decision-methods/VOTE_HAND'});
  assert.equal(hand.ballotStatus,'conducted');assert.equal(hand.namedVoters.available,false);
  assert.deepEqual(hand.actualPosition,{status:'unavailable',position:null});
  const unavailable=project(decision('197457'),'999999');
  assert.equal(unavailable.actualPosition.status,'unavailable','a tally mismatch cannot certify a missing member position');
});

test('conflicting named positions are explicit and valid duplicates are deduplicated',()=>{
  const duplicate={...fullDecision,had_voter_favor:[...fullDecision.had_voter_favor,'person/197591',{id:absolute('person/197591')}]};
  assert.equal(project(duplicate).namedVoters.totalsMatch,true);
  const conflicting={...fullDecision,had_voter_against:[...fullDecision.had_voter_against,'person/197591']};
  const vote=project(conflicting);
  assert.deepEqual(vote.actualPosition,{status:'conflicting',position:null});
  assert.deepEqual(vote.namedVoters.conflictingPersonIds,['197591']);
  assert.deepEqual(vote.namedVoters.counts,{for:453,against:86,abstaining:110});
  assert.equal(vote.namedVoters.totalsMatch,false);
  assert.deepEqual(vote.intention,{status:'reported',positions:['abstaining']});
});

test('malformed or non-official voter references do not silently count as missing records',()=>{
  const raw={...fullDecision,had_voter_against:[...fullDecision.had_voter_against,'https://example.com/person/999999',null,{name:'Unidentified person'}]};
  const vote=project(raw,'999999');
  assert.equal(vote.namedVoters.malformedReferences,3);assert.equal(vote.namedVoters.totalsMatch,false);
  assert.deepEqual(vote.actualPosition,{status:'unavailable',position:null});
  assert.deepEqual(project(raw).actualPosition,{status:'recorded',position:'for'},'valid recorded position survives a malformed unrelated reference');
  const brokenArray=project({...fullDecision,had_voter_against:null});
  assert.equal(brokenArray.namedVoters.available,false);assert.equal(brokenArray.namedVoters.malformedReferences,1);
});

test('missing declarations mean not-reported and malformed declarations preserve uncertainty',()=>{
  const raw={...fullDecision};delete raw.had_voter_intended_abstention;
  assert.deepEqual(project(raw).intention,{status:'not-reported',positions:[]});
  assert.deepEqual(project({...raw,had_voter_intended_favor:['person/197591'],had_voter_intended_against:['person/197591']}).intention,{status:'reported',positions:['for','against']});
  const malformed=project({...raw,had_voter_intended_against:[{label:'No identity'}]});
  assert.deepEqual(malformed.intention,{status:'unavailable',positions:[]});
  assert.deepEqual(malformed.actualPosition,{status:'recorded',position:'for'});
});

test('null and malformed tallies remain distinct from explicitly supplied zero',()=>{
  const vote=project({...fullDecision,number_of_votes_favor:0,number_of_votes_against:null,number_of_votes_abstention:''});
  assert.deepEqual(vote.totals,{for:0,against:null,abstaining:null});assert.equal(vote.namedVoters.totalsMatch,null);
  assert.deepEqual(project({...fullDecision,number_of_votes_favor:'0',number_of_votes_against:false,number_of_votes_abstention:-1}).totals,{for:0,against:null,abstaining:null});
  const missing={...fullDecision};delete missing.number_of_votes_favor;
  assert.equal(project(missing).totals.for,null);
});

test('source languages are retained and label selection reports its actual fallback language',()=>{
  const raw=decision('197457');
  const hu=project(raw,'197591',snapshot,'hu');
  assert.equal(hu.title,raw.activity_label.hu);assert.equal(hu.titleLanguage,'hu');
  assert.deepEqual(hu.titles,raw.activity_label);assert.deepEqual(hu.referenceTexts,raw.referenceText);
  const fallback=project(raw,'197591',snapshot,'xx');
  assert.equal(fallback.title,raw.activity_label.en);assert.equal(fallback.titleLanguage,'en');
  const frOnly=project({...raw,activity_label:{fr:'Texte officiel'},referenceText:{fr:'Référence officielle'}},'197591',snapshot,'hu');
  assert.equal(frOnly.titleLanguage,'fr');assert.equal(frOnly.title,'Texte officiel');
  assert.deepEqual(frOnly.scope,{kind:'unclassified',basis:'unclassified'},'a translated or similar title must not invent an exact scope');
  const referenceOnly=project({...raw,activity_label:undefined,referenceText:{fr:'Référence officielle'}});
  assert.equal(referenceOnly.title,'Référence officielle');assert.equal(referenceOnly.titleLanguage,'fr');
  const missing=project({...raw,activity_label:undefined,referenceText:undefined});
  assert.equal(missing.title,null);assert.equal(missing.titleLanguage,null);
});

test('external and malformed relation targets never join and projection never mutates source snapshots',()=>{
  const before=JSON.stringify(snapshot);
  project(decision('197847'));
  assert.equal(JSON.stringify(snapshot),before);
  const raw={...decision('197457'),inverse_consists_of:['https://example.com/eli/dl/event/MTG-PL-2026-10-07-VOT-ITM-993151','eli/dl/event/MTG-PL-2026-10-07-VOT-ITM-993151?member=197591']};
  const vote=project(raw,'197591',{...snapshot,results:snapshot.results.map(node=>({...node,consists_of:[]}))});
  assert.deepEqual(vote.context.resultIds,[]);assert.deepEqual(vote.context.agendaItemIds,[]);
  assert.deepEqual(vote.context.procedureIds,[]);
});

test('alignment uses conducted recorded ballots and the official outcome, never intentions or tallies',()=>{
  for(const outcome of ['ADOPTED','REJECTED','LAPSED','WITHDRAWN',null,'UNKNOWN'])for(const position of ['for','against','abstaining',null])for(const status of ['recorded','no-record','unavailable','conflicting','not-conducted'])for(const ballotStatus of ['conducted','not-conducted','unknown']){
    const vote={outcome,actualPosition:{status,position},ballotStatus,intention:{status:'reported',positions:['for']},totals:{for:500,against:0,abstaining:0}};
    const expected=ballotStatus!=='conducted'||status!=='recorded'||!['ADOPTED','REJECTED'].includes(outcome)||!position?'unclassified':position==='abstaining'?'abstained':(position==='for')===(outcome==='ADOPTED')?'with':'against';
    assert.equal(memberVoteAlignment(vote),expected,JSON.stringify(vote));
  }
});

test('recognised non-named conducted ballots require no supplied actual voter fields',()=>{
  const base={...fullDecision};for(const key of ['had_voter_favor','had_voter_against','had_voter_abstention'])delete base[key];
  for(const method of ['VOTE_HAND','VOTE_ELECTRONIC','VOTE_SECRET','VOTE_SECRET_BALLOT']){
    const raw={...base,decision_method:'def/ep-decision-methods/'+method},vote=project(raw);
    assert.deepEqual(vote.actualPosition,{status:'not-individually-recorded',position:null},method);assert.equal(memberVoteAlignment(vote),'unclassified');
    assert.equal(project({...raw,decision_outcome:'def/ep-statuses/LAPSED'}).actualPosition.status,'not-conducted');
    for(const value of [[],['person/197591'],null,'bad',['malformed']])assert.equal(project({...raw,had_voter_favor:value}).actualPosition.status,'unavailable',method+':'+JSON.stringify(value));
    assert.equal(project({...raw,had_voter_favor:['person/197591'],had_voter_against:['person/197591']}).actualPosition.status,'conflicting');
    assert.equal(project({...raw,_conflictingSourceObservations:{fields:['decision_method']}}).actualPosition.status,'conflicting');
    assert.equal(project({...raw,type:'Decision'}).actualPosition.status,'unavailable');
  }
  for(const method of [undefined,'def/ep-decision-methods/VOTE_UNKNOWN','def/ep-decision-methods/VOTE_ELECTRONIC_ROLLCALL'])assert.equal(project({...base,decision_method:method}).actualPosition.status,'unavailable');
});


test('whole-text summaries retain authoritative non-named status without classifying alignment',()=>{
  const raw={...fullDecision,decision_method:'def/ep-decision-methods/VOTE_HAND'};
  for(const key of ['had_voter_favor','had_voter_against','had_voter_abstention'])delete raw[key];
  const projected=projectMemberSitting({...snapshot,decisions:[raw]},'197591');
  assert.equal(projected.items[0].alignment,'unclassified');
  const summaries=projected.subjects.flatMap(subject=>subject.wholeTextDecisions);
  assert.equal(summaries.length,1);assert.deepEqual(summaries[0].actualPosition,{status:'not-individually-recorded',position:null});
});

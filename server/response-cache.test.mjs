import test from 'node:test';
import assert from 'node:assert/strict';
import {apiCachePolicy, portraitCachePolicy} from './response-cache.mjs';
import {activityDocument} from './activities.mjs';
import {SpeakerIdentities} from './speaker-identity.mjs';

const now = Date.parse('2026-10-17T12:00:00Z');
const request = {method: 'GET', headers: {}};
const policy = (path, value = {}, options = {}) => apiCachePolicy({...request, ...options}, new URL(path, 'https://example.test'), value, {now});
const seconds = value => Number(value.cdnCacheControl.match(/max-age=(\d+)/)?.[1]);

test('current plenary week lists use an hourly CDN lifetime',()=>{
  const value={detail:null,agendaSittings:[{date:'2026-10-14'}],coverage:{agendaComplete:true,sources:[]}};
  assert.equal(seconds(policy('/api/insights/legislation?week=latest',value)),3600);
  value.agendaSittings=[{date:'2026-10-07'}];
  assert.equal(seconds(policy('/api/insights/legislation?week=2026-10-05',value)),21600);
});

test('preliminary and unresolved agenda selections retain their shorter CDN lifetimes',()=>{
  const value={detail:null,agendaSittings:[{date:'2026-10-07'}],coverage:{agendaComplete:true,sources:[{apiUrl:'https://data.europarl.europa.eu/api/v2/meetings/MTG-PL-2026-10-07/foreseen-activities',fetchedAt:'2026-10-08T12:00:00Z'}]}};
  assert.equal(seconds(policy('/api/insights/legislation?week=2026-10-05',value)),60,'a preliminary observation still needs its final read');
  assert.equal(seconds(policy('/api/insights/legislation?week=latest',{detail:null,selectionUnavailable:true})),300);
  assert.equal(policy('/api/insights/legislation?week=latest',{...value,stale:true}).cdnCacheControl,'no-store');
});

test('unavailable parliamentary service dates remain an explicit uncached profile gap',()=>{
  assert.equal(policy('/api/profile/43',{parliamentaryService:{complete:false,currentSince:null,error:'Some parliamentary service dates are unavailable or inconsistent.'}}).cdnCacheControl,'no-store');
});

test('incomplete or stale profile committee history cannot acquire a public cache lifetime',()=>{
  for(const history of [{complete:false,error:'Some committee history is unavailable.'},{complete:false,error:'Some committee history is unavailable.',sources:[]},{complete:true,error:null,sources:[{stale:true}]}])
    assert.equal(policy('/api/profile/43',{committeeMemberships:history}).cdnCacheControl,'no-store');
  assert.equal(seconds(policy('/api/profile/43',{committeeMemberships:{complete:true,error:null,sources:[{stale:false}]}})),21600);
});

test('ordinary public reads use six hours and recent lists one hour without changing browser freshness', () => {
  for (const path of ['/api/directory', '/api/profile/43?lang=hu', '/api/insights/questions?lang=en', '/api/corpus/search?lang=hu&q=water', '/api/amendments', '/api/outside/directory']) {
    const value = {index: {complete: true}, coverage: {complete: false, authoritativeComplete: false}, fetchedAt: '2026-10-16T00:00:00Z'};
    assert.equal(seconds(policy(path, value)), 21600, path);
    assert.equal(policy(path, value).cacheControl, 'public, max-age=0');
    assert.match(policy(path, value).cdnCacheControl, /stale-if-error=0/);
    assert.equal(value.coverage.complete, false);
  }
  for (const path of ['/api/activities/43', '/api/latest-activities/43', '/api/speeches/43?offset=20']) assert.equal(seconds(policy(path)), 3600, path);
  assert.equal(seconds(policy('/api/profile/43', {}, {method: 'HEAD'})), 21600);
});

test('directory membership progress is never stored while completed snapshots retain their public lifetime', () => {
  for (const index of [undefined, {}, {complete: false, loaded: 0, total: 719, failed: 0, error: null}, {complete: false, loaded: 300, total: 719, failed: 0, error: null}, {complete: false, loaded: 718, total: 719, failed: 1, error: null}]) {
    for (const method of ['GET', 'HEAD']) {
      assert.deepEqual(policy('/api/directory', {index}, {method}), {cacheControl: 'no-store', cdnCacheControl: 'no-store'});
    }
  }
  assert.equal(seconds(policy('/api/directory', {index: {complete: true, loaded: 719, total: 719, failed: 0, error: null}})), 21600);
  assert.equal(seconds(policy('/api/directory', {index: {complete: true, loaded: 0, total: 0, failed: 0, error: null}})), 21600);
  assert.deepEqual(policy('/api/directory', {index:{complete:true},committeeDetails:{complete:false,loaded:0,total:26,failed:0,error:null}}), {cacheControl:'no-store',cdnCacheControl:'no-store'});
});

test('only established positive speech and document reads use a day; unanswered questions remain mutable', () => {
  const speech = {date: '2026-09-01', xml: '<speech>Retained text</speech>', video: {available: false}, textCache: {stale: false, refreshError: null}};
  assert.equal(seconds(policy('/api/speech/MTG-PL-2026-09-01-INT-1', speech)), 86400);
  assert.equal(seconds(policy('/api/speech/MTG-PL-2026-10-16-INT-1', {...speech, date: '2026-10-16'})), 21600);
  assert.equal(policy('/api/speech/MTG-PL-2026-09-01-INT-1', {...speech, xml: null}).cacheControl, 'no-store');
  assert.equal(seconds(policy('/api/document/E-10-2026-000001', {date: '2026-09-01', answers: [], selectedText: {status: 'available'}})), 21600);
  assert.equal(seconds(policy('/api/document/E-10-2026-000001', {date: '2026-09-01', answers: [{id: 'E-10-2026-000001-ASW'}], selectedText: {status: 'available'}})), 86400);
  assert.equal(seconds(policy('/api/document/B-10-2026-0001', {date: '2026-09-01', selectedText: {status: 'available'}})), 86400);
  assert.equal(seconds(policy('/api/corpus/text?source-id=S&source-key=hu', {date: '2026-09-01', body: 'Text'})), 86400);
  for (const date of [null, '2026-02-30', '2026-12-01']) assert.equal(seconds(policy('/api/document/B-10-2026-0001', {date})), 21600);
});

test('operational, stateful, unknown and non-read routes fail closed', () => {
  for (const path of ['/healthz', '/api/healthz', '/api/activity-index/status', '/api/corpus/status', '/api/amendments/failures', '/api/speech-statistics/43?page=0', '/api/insights/speech-cloud?page=0', '/api/insights/topic-trends?page=0', '/api/new-resource', '/api/profile/43/extra', '/portal/api/session']) assert.equal(policy(path).cdnCacheControl, 'no-store', path);
  for (const method of ['POST', 'OPTIONS', 'PUT']) assert.equal(policy('/api/corpus/search', {}, {method}).cacheControl, 'no-store');
  assert.equal(policy('/api/profile/43', {}, {headers: {authorization: 'test'}}).cacheControl, 'no-store');
});

test('flat transport preserves the finite cache allowlist and excludes retired namespaces and new APIs', () => {
  const paths = ['directory', 'references', 'reference-summary', 'source-record', 'amendments',
    'profile/43', 'activities/43', 'speeches/43', 'latest-activities/43',
    'speech/MTG-PL-2026-09-01-INT-1', 'speech-context/MTG-PL-2026-09-01-INT-1',
    'speech-media/MTG-PL-2026-09-01-INT-1', 'document/B-10-2026-0001',
    'motion-comparison/B-10-2026-0001', 'corpus/search', 'corpus/text',
    'outside/directory', 'outside/43', ...['questions', 'legislation', 'saved', 'participation',
      'speech-words', 'procedure-context', 'group-voices'].map(view => 'insights/' + view)];
  for (const suffix of paths) {
    const payload = {index: {complete: true}, xml: '<speech>Retained text</speech>'};
    const expected = suffix==='insights/legislation'?60:/^(activities|speeches|latest-activities)\//.test(suffix) ? 3600 : 21600;
    assert.equal(seconds(policy('/api/' + suffix, payload)), expected, suffix);
    for (const prefix of ['/api/poc/', '/api/explorer/']) {
      assert.deepEqual(policy(prefix + suffix, payload), {cacheControl: 'no-store', cdnCacheControl: 'no-store'}, prefix + suffix);
    }
  }
  for (const suffix of ['motion-amendments/B-10-2026-0001', 'member-votes/43', 'member-attendance/43', 'speech-transcript/MTG-PL-2026-09-01-INT-1']) {
    assert.deepEqual(policy('/api/' + suffix), {cacheControl: 'no-store', cdnCacheControl: 'no-store'}, suffix);
  }
});

test('temporary failure and refresh states inside successful responses are never stored', () => {
  const values = [{stale: true}, {textCache: {refreshInProgress: true}}, {selectedText: {status: 'error'}}, {selectedText: {status: 'unavailable'}}, {coverage: {sourceError: true}}, {sources: [{refreshError: 'timeout'}]}, {index: {loading: true}}, {viewCache: {nextRetryAt: '2026-10-17T12:01:00Z'}}, {coverage: {gaps: [{kind: 'agenda-unavailable'}]}}, {coverage: {gaps: [{kind: 'votes-unavailable'}]}}];
  for (const value of values) assert.equal(policy('/api/document/B-10-2026-0001', value).cdnCacheControl, 'no-store', JSON.stringify(value));
  assert.equal(policy('/api/speech-media/MTG-PL-2026-09-01-INT-1', {available: false}).cacheControl, 'no-store');
  assert.equal(seconds(policy('/api/profile/43', {errors: [], error: null, sourceError: false})), 21600);
});

test('temporary identity lookup failures prevent speech caching while an absent historical office remains cacheable', async () => {
  let failing = true;
  const resolver = new SpeakerIdentities({request: async () => {
    if (failing) throw new Error('Public identity source unavailable');
    return {url: 'https://data.europarl.europa.eu/api/v2/meps', fetchedAt: now, payload: {data: [{id: 'person/43', identifier: '43', givenName: 'Public', familyName: 'Speaker', hasMembership: []}]}};
  }});
  const read = () => resolver.enrich([{id: '43', name: 'Public Speaker'}], '2026-09-01', {chairs: ['43']});
  const cases = [
    ['/api/speech/MTG-PL-2026-09-01-INT-1', speakers => ({date: '2026-09-01', xml: '<speech>Retained text</speech>', speakers}), 86400],
    ['/api/speech-context/MTG-PL-2026-09-01-INT-1', speakers => ({debates: [{records: [{intervention: {speaker: speakers[0]}}]}]}), 21600],
  ];
  const temporary = await read();
  assert.equal(temporary[0].name, 'Public Speaker', 'a failed enrichment preserves the supplied transcript name');
  assert(temporary[0].identityIssues.includes('person-names-unavailable'));
  for (const [path, payload] of cases) assert.deepEqual(policy(path, payload(temporary)), {cacheControl: 'no-store', cdnCacheControl: 'no-store'}, path);

  failing = false;
  const recovered = await read();
  assert.equal(recovered[0].office, null);
  assert.deepEqual(recovered[0].identityIssues, ['parliament-office-unavailable'], 'a successful public lookup can lack exact historical office evidence');
  for (const [path, payload, ttl] of cases) assert.equal(seconds(policy(path, payload(recovered))), ttl, path);
});

test('a fresh roster cannot conceal failed individual speaker profiles from speech and context cache policy', async () => {
  let failing = true;
  const record = data => ({url: 'https://data.europarl.europa.eu/api/v2/meps', fetchedAt: now, payload: {data}});
  const resolver = new SpeakerIdentities({request: async route => {
    if (route === '/meps/show-current') return record([{id: 'person/44', identifier: '44', givenName: 'Current', familyName: 'Member'}]);
    if (failing) throw new Error('Public profile temporarily unavailable');
    return record([{id: 'person/43', identifier: '43', givenName: 'Public', familyName: 'Speaker', hasMembership: []}]);
  }});
  const cases = [
    ['/api/speech/MTG-PL-2026-09-01-INT-1', speakers => ({date: '2026-09-01', xml: '<speech>Retained text</speech>', speakers}), 86400],
    ['/api/speech-context/MTG-PL-2026-09-01-INT-1', speakers => ({debates: [{records: [{intervention: {speaker: speakers[0]}}]}]}), 21600],
  ];
  for (const options of [{chairs: ['43']}, {profileIds: ['43']}]) {
    failing = true;
    const temporary = await resolver.enrich([{id: '43', name: 'Public Speaker'}], '2026-09-01', options);
    assert(temporary[0].identityIssues.includes('person-profile-unavailable'));
    assert(temporary[0].identitySources.every(source => source.stale === false));
    for (const [path, payload] of cases) assert.deepEqual(policy(path, payload(temporary)), {cacheControl: 'no-store', cdnCacheControl: 'no-store'}, path);

    failing = false;
    const recovered = await resolver.enrich([{id: '43', name: 'Public Speaker'}], '2026-09-01', options);
    assert.deepEqual(recovered[0].identityIssues, options.chairs ? ['parliament-office-unavailable'] : []);
    for (const [path, payload, ttl] of cases) assert.equal(seconds(policy(path, payload(recovered))), ttl, path);
  }
});

test('identity source freshness survives empty and mismatched profile results for chairs and selected speakers', async () => {
  const person = {id: '43', name: 'Public Speaker'};
  const other = {id: 'person/44', identifier: '44', givenName: 'Other', familyName: 'Member'};
  const cases = [
    ['/api/speech/MTG-PL-2026-09-01-INT-1', speakers => ({date: '2026-09-01', xml: '<speech>Retained text</speech>', speakers}), 86400],
    ['/api/speech-context/MTG-PL-2026-09-01-INT-1', speakers => ({debates: [{records: [{intervention: {speaker: speakers[0]}}]}]}), 21600],
  ];
  for (const options of [{chairs: ['43']}, {profileIds: ['43']}]) for (const data of [[], [other]]) for (const flags of [{}, {stale: true}, {refreshInProgress: true}, {refreshError: 'Public profile refresh failed'}]) {
    const resolver = new SpeakerIdentities({request: async route => ({url: 'https://data.europarl.europa.eu/api/v2' + route, fetchedAt: now, payload: {data: route === '/meps/show-current' ? [other] : data}, ...(route === '/meps/43' ? flags : {})})});
    const people = await resolver.enrich([person], '2026-09-01', options);
    const source = people[0].identitySources.find(value => value.url.endsWith('/meps/43'));
    assert(source, 'the consulted source is retained even without an exact person');
    assert.equal(source.stale, Boolean(flags.stale));
    assert.equal(source.refreshInProgress, Boolean(flags.refreshInProgress));
    assert.equal(source.refreshError, flags.refreshError || null);
    assert.deepEqual(people[0].identityIssues, options.chairs ? ['parliament-office-unavailable'] : []);
    for (const [path, payload, ttl] of cases) {
      if (Object.keys(flags).length) assert.equal(policy(path, payload(people)).cdnCacheControl, 'no-store');
      else assert.equal(seconds(policy(path, payload(people))), ttl, 'fresh absence remains cacheable');
    }
  }
});

test('identity roster evidence retains refresh state even when its records are empty', async () => {
  for (const data of [[], [{id: 'person/43', identifier: '43', givenName: 'Public', familyName: 'Speaker'}]]) for (const flags of [{}, {stale: true}, {refreshInProgress: true}, {refreshError: 'Public roster refresh failed'}]) {
    const resolver = new SpeakerIdentities({request: async route => ({url: 'https://data.europarl.europa.eu/api/v2' + route, fetchedAt: now, payload: {data}, ...flags})});
    const people = await resolver.enrich([{id: '43', name: 'Public Speaker'}], '2026-09-01');
    assert.equal(people[0].identitySources.length, 1);
    const source = people[0].identitySources[0];
    assert.equal(source.stale, Boolean(flags.stale));
    assert.equal(source.refreshInProgress, Boolean(flags.refreshInProgress));
    assert.equal(source.refreshError, flags.refreshError || null);
    const value = policy('/api/speech/MTG-PL-2026-09-01-INT-1', {date: '2026-09-01', xml: '<speech>Retained text</speech>', speakers: people});
    if (Object.keys(flags).length) assert.equal(value.cdnCacheControl, 'no-store');
    else assert.equal(seconds(value), 86400);
  }
});

test('document reading retains stale source state and uses the exact selected answer date', async () => {
  const questionId = 'E-10-2026-000001', answerId = questionId + '-ASW';
  const work = {identifier: questionId, document_date: '2026-09-01', inverse_answers_to: [{identifier: answerId, document_date: '2026-10-17'}]};
  const record = {url: 'https://data.europarl.europa.eu/api/v2/parliamentary-questions/' + questionId, fetchedAt: now - 7 * 3600_000, payload: {data: [work]}};
  const readText = async () => ({status: 'available', paragraphs: ['Published answer'], textLanguage: 'en'});
  const read = value => activityDocument(answerId, null, 'en', {request: async () => value, readText});
  const recent = await read(record);
  assert.equal(recent.date, '2026-09-01');
  assert.equal(recent.selectedDocumentDate, '2026-10-17');
  assert.equal(seconds(policy('/api/document/' + answerId, recent)), 21600);
  for (const selectedDate of ['2026-09-02', null]) {
    const old = await read({...record, payload: {data: [{...work, inverse_answers_to: [{identifier: answerId, document_date: selectedDate}]}]}});
    assert.equal(seconds(policy('/api/document/' + answerId, old)), selectedDate ? 86400 : 21600);
  }
  const stale = await read({...record, stale: true, refreshInProgress: true, refreshError: 'Retained after timeout'});
  assert.deepEqual(stale.sourceCache, {stale: true, refreshInProgress: true, refreshError: 'Retained after timeout'});
  assert.equal(policy('/api/document/' + answerId, stale).cdnCacheControl, 'no-store');
});

test('portrait cache expires with its retained source and never re-caches an expired image for another week', () => {
  const fresh = portraitCachePolicy({fetchedAt: now}, {now});
  assert.equal(seconds(fresh), 604800);
  assert.equal(fresh.cacheControl, 'public, max-age=86400');
  const almostExpired = portraitCachePolicy({fetchedAt: now - 7 * 86400_000 + 120_000}, {now});
  assert.equal(seconds(almostExpired), 120);
  assert.equal(almostExpired.cacheControl, 'public, max-age=120');
  for (const fetchedAt of [undefined, now - 7 * 86400_000, now - 8 * 86400_000]) assert.equal(portraitCachePolicy({fetchedAt}, {now}).cdnCacheControl, 'no-store');
});

test('vote-period calendar is admitted while stale, failed and unavailable source evidence remains no-store',()=>{
 const payload={version:1,weeks:[],coverage:{status:'complete',years:[{year:2026,state:'complete',sources:[{stale:false,refreshInProgress:false,refreshError:null}]}]}};
 assert.equal(policy('/api/vote-periods',payload).cdnCacheControl,'no-store');
 assert.equal(policy('/api/vote-periods',payload).cacheControl,'no-store');
 for(const state of [{stale:true},{refreshInProgress:true},{refreshError:{message:'Failed refresh'}}]){const value=structuredClone(payload);Object.assign(value.coverage.years[0].sources[0],state);assert.equal(policy('/api/vote-periods',value).cdnCacheControl,'no-store');}
 assert.equal(policy('/api/vote-periods',{coverage:{status:'unavailable'}}).cdnCacheControl,'no-store');
});

test('demographic acquisition gaps and failed refreshes reach the origin while observed omissions keep the normal lifetime',()=>{
 for(const path of ['/api/insights/questions','/api/insights/legislation']) {
  const payload=field=>{const value={stats:{demographicEvidence:{'42':{bday:field}}}};return path.endsWith('/legislation')?{detail:value}:value;};
  for(const field of [{status:'missing_acquisition'},{status:'fetch_failed'},{status:'available',lastAttempt:{status:'fetch_failed'}}])assert.equal(policy(path,payload(field)).cdnCacheControl,'no-store');
  assert.equal(seconds(policy(path,payload({status:'source_omission',lastAttempt:{status:'success'}}))),21600);
 }
});

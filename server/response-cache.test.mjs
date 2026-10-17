import test from 'node:test';
import assert from 'node:assert/strict';
import {apiCachePolicy, portraitCachePolicy} from './response-cache.mjs';
import {activityDocument} from './activities.mjs';
import {SpeakerIdentities} from './speaker-identity.mjs';

const now = Date.parse('2026-10-17T12:00:00Z');
const request = {method: 'GET', headers: {}};
const policy = (path, value = {}, options = {}) => apiCachePolicy({...request, ...options}, new URL(path, 'https://example.test'), value, {now});
const seconds = value => Number(value.cdnCacheControl.match(/max-age=(\d+)/)?.[1]);

test('ordinary public reads use six hours and recent lists one hour without changing browser freshness', () => {
  for (const path of ['/api/poc/directory', '/api/poc/profile/43?lang=hu', '/api/poc/insights/questions?lang=en', '/api/poc/corpus/search?lang=hu&q=water', '/api/poc/amendments', '/api/poc/outside/directory']) {
    const value = {coverage: {complete: false, authoritativeComplete: false}, fetchedAt: '2026-10-16T00:00:00Z'};
    assert.equal(seconds(policy(path, value)), 21600, path);
    assert.equal(policy(path, value).cacheControl, 'public, max-age=0');
    assert.match(policy(path, value).cdnCacheControl, /stale-if-error=0/);
    assert.equal(value.coverage.complete, false);
  }
  for (const path of ['/api/poc/activities/43', '/api/poc/latest-activities/43', '/api/poc/speeches/43?offset=20']) assert.equal(seconds(policy(path)), 3600, path);
  assert.equal(seconds(policy('/api/poc/profile/43', {}, {method: 'HEAD'})), 21600);
});

test('only established positive speech and document reads use a day; unanswered questions remain mutable', () => {
  const speech = {date: '2026-09-01', xml: '<speech>Retained text</speech>', video: {available: false}, textCache: {stale: false, refreshError: null}};
  assert.equal(seconds(policy('/api/poc/speech/MTG-PL-2026-09-01-INT-1', speech)), 86400);
  assert.equal(seconds(policy('/api/poc/speech/MTG-PL-2026-10-16-INT-1', {...speech, date: '2026-10-16'})), 21600);
  assert.equal(policy('/api/poc/speech/MTG-PL-2026-09-01-INT-1', {...speech, xml: null}).cacheControl, 'no-store');
  assert.equal(seconds(policy('/api/poc/document/E-10-2026-000001', {date: '2026-09-01', answers: [], selectedText: {status: 'available'}})), 21600);
  assert.equal(seconds(policy('/api/poc/document/E-10-2026-000001', {date: '2026-09-01', answers: [{id: 'E-10-2026-000001-ASW'}], selectedText: {status: 'available'}})), 86400);
  assert.equal(seconds(policy('/api/poc/document/B-10-2026-0001', {date: '2026-09-01', selectedText: {status: 'available'}})), 86400);
  assert.equal(seconds(policy('/api/poc/corpus/text?source-id=S&source-key=hu', {date: '2026-09-01', body: 'Text'})), 86400);
  for (const date of [null, '2026-02-30', '2026-12-01']) assert.equal(seconds(policy('/api/poc/document/B-10-2026-0001', {date})), 21600);
});

test('operational, stateful, unknown and non-read routes fail closed', () => {
  for (const path of ['/healthz', '/api/healthz', '/api/poc/activity-index/status', '/api/poc/corpus/status', '/api/poc/amendments/failures', '/api/poc/speech-statistics/43?page=0', '/api/poc/insights/speech-cloud?page=0', '/api/poc/insights/topic-trends?page=0', '/api/poc/new-resource', '/api/poc/profile/43/extra', '/portal/api/session']) assert.equal(policy(path).cdnCacheControl, 'no-store', path);
  for (const method of ['POST', 'OPTIONS', 'PUT']) assert.equal(policy('/api/poc/corpus/search', {}, {method}).cacheControl, 'no-store');
  assert.equal(policy('/api/poc/profile/43', {}, {headers: {authorization: 'test'}}).cacheControl, 'no-store');
});

test('temporary failure and refresh states inside successful responses are never stored', () => {
  const values = [{stale: true}, {textCache: {refreshInProgress: true}}, {selectedText: {status: 'error'}}, {selectedText: {status: 'unavailable'}}, {coverage: {sourceError: true}}, {sources: [{refreshError: 'timeout'}]}, {index: {loading: true}}, {viewCache: {nextRetryAt: '2026-10-17T12:01:00Z'}}, {coverage: {gaps: [{kind: 'agenda-unavailable'}]}}, {coverage: {gaps: [{kind: 'votes-unavailable'}]}}];
  for (const value of values) assert.equal(policy('/api/poc/document/B-10-2026-0001', value).cdnCacheControl, 'no-store', JSON.stringify(value));
  assert.equal(policy('/api/poc/speech-media/MTG-PL-2026-09-01-INT-1', {available: false}).cacheControl, 'no-store');
  assert.equal(seconds(policy('/api/poc/profile/43', {errors: [], error: null, sourceError: false})), 21600);
});

test('temporary identity lookup failures prevent speech caching while an absent historical office remains cacheable', async () => {
  let failing = true;
  const resolver = new SpeakerIdentities({request: async () => {
    if (failing) throw new Error('Public identity source unavailable');
    return {url: 'https://data.europarl.europa.eu/api/v2/meps', fetchedAt: now, payload: {data: [{id: 'person/43', identifier: '43', givenName: 'Public', familyName: 'Speaker', hasMembership: []}]}};
  }});
  const read = () => resolver.enrich([{id: '43', name: 'Public Speaker'}], '2026-09-01', {chairs: ['43']});
  const cases = [
    ['/api/poc/speech/MTG-PL-2026-09-01-INT-1', speakers => ({date: '2026-09-01', xml: '<speech>Retained text</speech>', speakers}), 86400],
    ['/api/poc/speech-context/MTG-PL-2026-09-01-INT-1', speakers => ({debates: [{records: [{intervention: {speaker: speakers[0]}}]}]}), 21600],
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
    ['/api/poc/speech/MTG-PL-2026-09-01-INT-1', speakers => ({date: '2026-09-01', xml: '<speech>Retained text</speech>', speakers}), 86400],
    ['/api/poc/speech-context/MTG-PL-2026-09-01-INT-1', speakers => ({debates: [{records: [{intervention: {speaker: speakers[0]}}]}]}), 21600],
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
    ['/api/poc/speech/MTG-PL-2026-09-01-INT-1', speakers => ({date: '2026-09-01', xml: '<speech>Retained text</speech>', speakers}), 86400],
    ['/api/poc/speech-context/MTG-PL-2026-09-01-INT-1', speakers => ({debates: [{records: [{intervention: {speaker: speakers[0]}}]}]}), 21600],
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
    const value = policy('/api/poc/speech/MTG-PL-2026-09-01-INT-1', {date: '2026-09-01', xml: '<speech>Retained text</speech>', speakers: people});
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
  assert.equal(seconds(policy('/api/poc/document/' + answerId, recent)), 21600);
  for (const selectedDate of ['2026-09-02', null]) {
    const old = await read({...record, payload: {data: [{...work, inverse_answers_to: [{identifier: answerId, document_date: selectedDate}]}]}});
    assert.equal(seconds(policy('/api/poc/document/' + answerId, old)), selectedDate ? 86400 : 21600);
  }
  const stale = await read({...record, stale: true, refreshInProgress: true, refreshError: 'Retained after timeout'});
  assert.deepEqual(stale.sourceCache, {stale: true, refreshInProgress: true, refreshError: 'Retained after timeout'});
  assert.equal(policy('/api/poc/document/' + answerId, stale).cdnCacheControl, 'no-store');
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

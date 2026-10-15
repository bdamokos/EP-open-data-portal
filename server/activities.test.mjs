import { test } from "node:test";
import assert from "node:assert/strict";
import { parseActivities, activityFeedUrl, documentEndpoint, documentSummary } from "./activities.mjs";
import { speechWebsite } from "./ep-links.mjs";

test("published activity RSS preserves source links, IDs and publication order without reading HTML descriptions", () => {
  const xml = '<rss><channel><item><title>Question</title><link>https://www.europarl.europa.eu/doceo/document/E-10-2026-003840_EN.html</link><description><![CDATA[<script>never render me</script>]]></description><category domain="type">Written question</category><guid>QE_E-10-2026-003840_EN</guid><pubDate>Thu, 01 Oct 2026 07:23:07 GMT</pubDate></item><item><title>Speech video</title><link>https://www.europarl.europa.eu/plenary/en/vod.html?mode=unit</link><category domain="type">Video of an MEP\'s speech</category><guid>VD-ORAPL_2017097993206_202610071135_EN</guid><pubDate>Wed, 07 Oct 2026 09:35:00 GMT</pubDate></item><item><title>Unsafe</title><link>https://untrusted.example/doc</link><guid>bad</guid><pubDate>Wed, 07 Oct 2026 09:35:00 GMT</pubDate></item></channel></rss>';
  const items = parseActivities(xml);
  assert.equal(items.length,2);
  assert.equal(items[0].speechNumber,'2017097993206');
  assert.equal(items[1].documentId,'E-10-2026-003840');
  assert.equal(items[1].detailsAvailable,true);
  assert(!JSON.stringify(items).includes('script'));
  assert.throws(()=>parseActivities('<!DOCTYPE rss><rss/>'));
  assert.throws(()=>parseActivities('<html/>'));
  assert.throws(()=>parseActivities('<rss><channel><item></channel></rss>'));
});
test("feed and document lookup URLs are constrained to published EP paths", () => {
  assert.equal(activityFeedUrl('maravillas.abadiajover@europarl.europa.eu','en'),'https://www.europarl.europa.eu/rss/mep/maravillas.abadiajover/en.xml');
  assert.equal(activityFeedUrl('../private@europarl.europa.eu','en'),null);
  assert.equal(activityFeedUrl('a@untrusted.example','en'),null);
  assert.equal(documentEndpoint('E-10-2026-003031-ASW'),'/parliamentary-questions/E-10-2026-003031');
  assert.equal(documentEndpoint('JURI-AL-792186'),'/committee-documents/JURI-AL-792186');
  assert.equal(documentEndpoint('../meps'),null);
});
test("document adaptation uses exact person IDs, roles, translated files and embedded answers", () => {
  const work={identifier:'E-10-2026-003031',workHadParticipation:[{had_participant_person:['person/257043'],participation_role:'def/ep-roles/AUTHOR'},{had_participant_person:['person/42'],participation_role:'def/ep-roles/RAPPORTEUR'}],is_realized_by:[{language:'http://publications.europa.eu/resource/authority/language/SPA',is_embodied_by:[{is_exemplified_by:'distribution/doc/test_es.pdf',format:'http://publications.europa.eu/resource/authority/file-type/PDF'},{is_exemplified_by:'https://untrusted.example/test.pdf'}]}],inverse_answers_to:[{identifier:'E-10-2026-003031-ASW',document_date:'2026-09-18',is_realized_by:[]}]};
  const result=documentSummary(work,257043);
  assert.deepEqual(result.roles,['AUTHOR']);
  assert.equal(result.files.length,1);assert.equal(result.files[0].language,'es');
  assert.equal(result.answers[0].id,'E-10-2026-003031-ASW');
});
test("speech website link uses the API identifier and actual original language, not a claimed CRE translation", () => {
  assert.deepEqual(speechWebsite({identifier:'CRE-10-2026-10-07-OTH-2017097993206',originalLanguage:['http://publications.europa.eu/resource/authority/language/SPA']}),{websiteUrl:'https://www.europarl.europa.eu/doceo/document/CRE-10-2026-10-07-INT-2017097993206_ES.html',websiteLanguage:'es'});
  assert.equal(speechWebsite({}).websiteUrl,null);
});

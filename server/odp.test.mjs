import { test } from "node:test";
import assert from "node:assert/strict";
import { transcriptLanguage } from "./transcript-language.mjs";
import {
  validDuring,
  memberships,
  orderedSpeeches,
  parseFeed,
  memberSummary,
  activeCommittee,
} from "./odp.mjs";

test("current committee membership excludes expired and future roles, includes the final day", () => {
  const person = {
    hasMembership: [
      {
        organization: "org/6572",
        role: "def/ep-roles/MEMBER",
        membershipClassification:
          "def/ep-entities/COMMITTEE_PARLIAMENTARY_STANDING",
        memberDuring: { startDate: "2024-07-16", endDate: "2026-10-13" },
      },
      {
        organization: "org/6581",
        role: "def/ep-roles/MEMBER_SUBSTITUTE",
        membershipClassification:
          "def/ep-entities/COMMITTEE_PARLIAMENTARY_STANDING",
        memberDuring: { startDate: "2026-10-14" },
      },
      {
        organization: "org/6585",
        role: "def/ep-roles/MEMBER",
        membershipClassification:
          "def/ep-entities/COMMITTEE_PARLIAMENTARY_STANDING",
        memberDuring: { startDate: "2024-07-16", endDate: "2026-10-12" },
      },
      {
        organization: "org/7018",
        role: "def/ep-roles/MEMBER",
        membershipClassification: "def/ep-entities/EU_POLITICAL_GROUP",
        memberDuring: { startDate: "2024-07-16" },
      },
    ],
  };
  const rows = memberships(person, "2026-10-13");
  assert.equal(rows.length, 3);
  assert.deepEqual(
    rows.filter((x) => x.current).map((x) => x.id),
    ["6572"],
  );
  assert.equal(rows[1].role, "MEMBER_SUBSTITUTE");
  assert.equal(validDuring({}, "2026-10-13"), false);
});
test("active committee bodies exclude expired, future and joint bodies", () => {
  const classification = "def/ep-entities/COMMITTEE_PARLIAMENTARY_STANDING";
  assert(activeCommittee({ classification, temporal: { startDate: "2024-07-16", endDate: "2026-10-13" } }, "2026-10-13"));
  assert(!activeCommittee({ classification, temporal: { endDate: "2026-10-12" } }, "2026-10-13"));
  assert(!activeCommittee({ classification, temporal: { startDate: "2026-10-14" } }, "2026-10-13"));
  assert(!activeCommittee({ classification: "def/ep-entities/COMMITTEE_PARLIAMENTARY_JOINT" }, "2026-10-13"));
});
test("speech order uses matched API hits and full timestamps even with oldest-first graph nodes", () => {
  const data = [
    {
      id: "old",
      activity_id: "old",
      activity_date: "2026-01-21",
      activity_start_date: "2026-01-21T15:00:00+01:00",
    },
    {
      id: "new",
      activity_id: "new",
      activity_date: "2026-01-21",
      activity_start_date: "2026-01-21T20:00:00+01:00",
    },
    { id: "unrelated", activity_id: "unrelated", activity_date: "2026-10-01" },
  ];
  assert.deepEqual(
    orderedSpeeches({
      data,
      searchResults: { hits: [{ id: "new" }, { id: "old" }] },
    }).map((x) => x.id),
    ["new", "old"],
  );
});
test("Atom updates deduplicate and restrict entity identifiers rather than following supplied links", () => {
  const xml =
    '<feed xmlns="http://www.w3.org/2005/Atom"><entry><id>https://data.europarl.europa.eu/person/257043</id><updated>2026-10-01T10:00:00Z</updated></entry><entry><id>https://data.europarl.europa.eu/person/257043</id><updated>2026-10-02T10:00:00Z</updated></entry><entry><id>https://untrusted.example/person/42</id><updated>2026-10-03T10:00:00Z</updated></entry><entry><id>https://data.europarl.europa.eu/org/6572</id><updated>2026-10-03T10:00:00Z</updated></entry></feed>';
  assert.deepEqual(parseFeed(xml, "person"), [
    { id: "257043", updated: "2026-10-02T10:00:00Z" },
  ]);
  assert.equal(parseFeed(xml, "org")[0].id, "6572");
  assert.deepEqual(
    parseFeed('<feed xmlns="http://www.w3.org/2005/Atom"/>', "person"),
    [],
  );
  assert.throws(() => parseFeed("<!DOCTYPE feed><feed/>", "person"));
});
test("JSON-LD multivalued profile properties do not break roster adaptation", () => {
  const p = memberSummary({
    identifier: "257043",
    givenName: "Maravillas",
    familyName: "Abadía Jover",
    hasGender: [
      "http://publications.europa.eu/resource/authority/human-sex/FEMALE",
    ],
    hasEmail: ["mailto:a@example.org", "mailto:b@example.org"],
  });
  assert.equal(p.gender, "f");
  assert.equal(p.id, 257043);
  assert.equal(p.hasEmail, true);
});

test("unavailable requested transcript falls back to original text before an unrelated translation", async () => {
  const { chooseTranscript } = await import("./odp.mjs");
  const docs = [
    {
      "api:xmlFragment": {
        fr: '<oralStatements><speech xml:lang="es-t-fr-mtec"><p>Texte</p></speech></oralStatements>',
        es: '<oralStatements><speech xml:lang="es"><p>Texto</p></speech></oralStatements>',
      },
    },
  ];
  assert.equal(chooseTranscript(docs, "fr").textLanguage, "fr");
  assert.equal(chooseTranscript(docs, "hu").textLanguage, "es");
  assert.deepEqual(chooseTranscript([], "en"), {
    textLanguage: null,
    xml: null,
    languageTags: [],
    translationType: null,
    availableTextLanguages: [],
  });
});

test("October 7 question fragments label EP machine translations and fall back to Spanish original", async () => {
  const { chooseTranscript } = await import("./odp.mjs");
  const fragments = {
    en: '<oralStatements><question xml:lang="es-t-en-mtec"><blockContainer><p>English</p></blockContainer></question></oralStatements>',
    hu: '<oralStatements><question xml:lang="es-t-hu-mtec"><blockContainer><p>Magyar</p></blockContainer></question></oralStatements>',
    es: '<oralStatements><question xml:lang="es"><blockContainer><p>Español</p></blockContainer></question></oralStatements>',
  };
  assert.equal(transcriptLanguage(fragments.en).machine, true);
  assert.equal(transcriptLanguage(fragments.hu).machine, true);
  assert.equal(transcriptLanguage(fragments.es).machine, false);
  assert.equal(chooseTranscript([{ "api:xmlFragment": fragments }], "hu").textLanguage, "hu");
  assert.equal(chooseTranscript([{ "api:xmlFragment": fragments }], "ga").textLanguage, "es");
  assert.equal(chooseTranscript([{ originalLanguage: ["http://publications.europa.eu/resource/authority/language/SPA"], "api:xmlFragment": { en: fragments.en, es: '<oralStatements><question><p>Español</p></question></oralStatements>' } }], "ga").textLanguage, "es");
});

test("fragment language metadata follows nested structures and ignores comments or unsafe declarations", () => {
  const xml = '<document xml:lang="en"><!-- xml:lang="de" --><answer xml:lang="es-t-en-mtec"><p>Text</p></answer></document>';
  assert.deepEqual(transcriptLanguage(xml), {
    tags: ["en", "es-t-en-mtec"], machine: true, originalLanguage: "es",
  });
  assert.equal(transcriptLanguage('<statement xml:lang="es"><p>Texto</p></statement>').originalLanguage, null);
  assert.equal(transcriptLanguage('<!DOCTYPE doc><doc xml:lang="es"/>').originalLanguage, null);
});

test("older plain-language fragments use authority metadata for original and leave translation method unspecified", async () => {
  const { chooseTranscript } = await import("./odp.mjs");
  const docs = [{ originalLanguage: ["http://publications.europa.eu/resource/authority/language/SPA"], "api:xmlFragment": {
    en: '<oralStatements><speech><from xml:lang="en"/><p>English translation</p></speech></oralStatements>',
    hu: '<oralStatements><speech><from xml:lang="hu"/><p>Magyar fordítás</p></speech></oralStatements>',
    es: '<oralStatements><speech><from xml:lang="es"/><p>Original español</p></speech></oralStatements>',
  } }];
  assert.equal(chooseTranscript(docs, "en").translationType, "unspecified");
  assert.equal(chooseTranscript(docs, "hu").translationType, "unspecified");
  const fallback = chooseTranscript(docs, "ga");
  assert.equal(fallback.textLanguage, "es");
  assert.equal(fallback.translationType, "original");
  assert.deepEqual(fallback.languageTags, ["es"]);
  assert.equal(fallback.xml, docs[0]["api:xmlFragment"].es);
  assert.equal(chooseTranscript([{ "api:xmlFragment": { en: docs[0]["api:xmlFragment"].en } }], "ga").translationType, "unspecified");
});
test('single-language originals in mul select their XML language before an unrelated translation',async()=>{
  const {chooseTranscript}=await import('./odp.mjs');
  const english='<oralStatements><speech><from xml:lang="en"/><p>Original English speech</p></speech></oralStatements>';
  const docs=[{originalLanguage:['http://publications.europa.eu/resource/authority/language/ENG'],'api:xmlFragment':{de:'<oralStatements><speech xml:lang="en-t-de-mtec"><p>Deutsch</p></speech></oralStatements>',mul:english}}];
  const requested=chooseTranscript(docs,'en');assert.equal(requested.xml,english);assert.equal(requested.textLanguage,'en');assert.equal(requested.sourceFragmentKey,'mul');assert.equal(requested.translationType,'original');assert.deepEqual(requested.availableTextLanguages,['de','en']);
  assert.equal(chooseTranscript(docs,'hu').textLanguage,'en');assert.equal(chooseTranscript(docs,'de').translationType,'machine');
  const mixed=chooseTranscript([{'api:xmlFragment':{mul:'<oralStatements><speech><from xml:lang="en"/><p xml:lang="fr">Deux langues</p></speech></oralStatements>'}}],'en');
  assert.equal(mixed.textLanguage,'mul');assert(!mixed.sourceFragmentKey);
});
test('readable text selection preserves a translation when the original only contains a header',async()=>{
  const {chooseTranscript}=await import('./odp.mjs');
  const original='<speech xml:lang="de"><from>Original header</from><p/></speech>',translated='<speech xml:lang="fr-t-de-mtec"><p>Lesbarer Beitrag.</p></speech>';
  const docs=[{'api:xmlFragment':{de:translated,mul:original}}];
  assert.equal(chooseTranscript(docs,'de').xml,original,'header-only selection remains compatible');
  const body=chooseTranscript(docs,'de',{readableOnly:true});assert.equal(body.xml,translated);assert.equal(body.translationType,'machine');
});


test('a member catalogue 204 is unavailable rather than an observed zero',async()=>{
  const {odpSpeeches}=await import('./odp.mjs');
  const result=await odpSpeeches(256956,'en',0,{request:async()=>{throw Object.assign(Error('No content'),{code:'odp_no_content'});}});
  assert.equal(result.total,null);assert.equal(result.status,'unavailable');assert.deepEqual(result.items,[]);
  const empty=await odpSpeeches(256956,'en',0,{request:async()=>({fetchedAt:Date.now(),payload:{data:[],meta:{total:0}}})});
  assert.equal(empty.total,0);
});

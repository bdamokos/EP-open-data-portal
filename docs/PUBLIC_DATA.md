# Public data sources

This page lists the external sources the application uses, what each provides, and the quirks a contributor needs to know about them. How the application processes the data is in the code and tests.

| Source | Use | Access |
| --- | --- | --- |
| [Indicative voting lists](https://www.europarl.europa.eu/plenary/en/votes.html) | Voting order, amendments, splits, requests and fall rules | Anonymous Tabling Service DOCX linked from the plenary votes page |
| [European Parliament Open Data API v2](https://data.europarl.europa.eu/en/developer-corner/opendata-api) ([specification](https://data.europarl.europa.eu/api/v2)) | MEPs and dated rosters, memberships, questions and answers, speeches, agendas and meetings, procedures, plenary documents, adopted texts, Commission follow-up documents (`/external-documents`), vote results and decisions, corporate bodies | Anonymous JSON-LD, Atom and XML from `data.europarl.europa.eu/api/v2` |
| [Parliament’s public website](https://www.europarl.europa.eu/) | Portraits, press-release feeds and the releases they announce, document files (DOCX/PDF), minutes and verbatim reports | Only URLs the API supplies (portraits, document distributions) or validated official paths |
| [Legislative Observatory (OEIL)](https://oeil.europarl.europa.eu/oeil/en/find-out-more) | Dossier stages, policy areas and document summaries, in English and French where supplied | Anonymous HTML of exact procedure-file and document-summary pages |
| [Publications Office knowledge graph (Cellar)](https://op.europa.eu/en/web/cellar/cellar-data/metadata/knowledge-graph) | Legislative progress and event-linked documents, EuroVoc, country terminology, procedure-phase labels, cited EU acts, Commission proposals, Council positions and consolidated acts | Anonymous SPARQL GET to `publications.europa.eu/webapi/rdf/sparql`; RDF-tree, DOCX and XHTML reads from `publications.europa.eu/resource/` |
| [Council public document service](https://data.consilium.europa.eu/) | Council re-consultation baselines; verified recital and provision placements | Anonymous PDF at `doc/document/ST-{number}-{year}-INIT/{language}/pdf`, derived from the exact ST/C10/CNS reference in the EP report record |
| [Parliament Multimedia Centre](https://multimedia.europarl.europa.eu/) | Recording metadata and the official embed URL | Undocumented JSON endpoint behind the public website |
| [Parliament’s published player](https://webstreaming.europarl.europa.eu/) | Playback and the list of interpretation tracks | Official iframe, created only after Play; undocumented player metadata |
| [Hemicycle seating plans](https://www.europarl.europa.eu/plenary/en/hemicycle.html) | Allocated seat, political group and country of each Member, and seat positions, for the Strasbourg and Brussels chambers | Undocumented JSON and SVG files behind the public interactive plan |
| [Plenary live status](https://www.europarl.europa.eu/plenary/en/home.html) | Current debate title and update time, in English | Anonymous JSON behind the plenary homepage |
| [European Commission EbS+](https://audiovisual.ec.europa.eu/en/ebs/grid?ebs=no&ebsplus=yes) | Current broadcast metadata and live video | Anonymous JSON and the broadcaster’s official iframe |
| [EUR-Lex](https://eur-lex.europa.eu/), DOCEO and other official pages | Reader links | Outbound links only; never fetched |

Bundled data: committee labels from the corporate-bodies API, country labels from the Publications Office authority scheme, Parliament’s [procedure-type taxonomy](https://data.europarl.europa.eu/def/ep-procedure-types.ttl) (`server/procedure-types.mjs`), Natural Earth map geometry and stopword lists. See [Third-party notices](../THIRD_PARTY_NOTICES.md).

Council draft validation retains native paragraph object references and binds each note to one superscript owner. Council recital comparisons keep notes separate from provision text. Supported wording and citation differences carry short notes; unproved discrepancies remain explicit gaps. Only painted paths with matching operators, geometry and position on every page are treated as decoration (0.001 PDF point tolerance; 0.000001 for matrix coefficients). Their SHA-256 is retained in source evidence. Tagged content is never decoration. Native list bodies retain their own object references. Every marked text item needs exactly one paragraph owner. Note separators require one native Note block and a bounded gap above it; hyperlink underlines require a matching printed URI, tagged paragraph owner and annotation with no painted appearance or additional action. Link destinations remain in body or note spans. These are owned content formatting, not decoration. Other painting, untagged text, ambiguous notes and unrepresented annotations prevent a passage from being complete. Quoted provisions require an exact positive outer instruction whose printed targets own the quoted article, plus the named act and inner address. Replacement slices remain inside that scope; terminal insertions use a zero-width splice before its closing quote. Unsupported or ambiguous addresses stay withheld. Text extraction alone does not prove that visible content was retained.

## Access rules

- Every source is anonymous. Never use credentials, private exports or copied production caches, and never bypass a protection such as DOCEO’s browser challenge. A failed public request becomes a reported gap.
- Server routes are read-only. Callers cannot choose an upstream host, supply upstream query text (such as SPARQL) or make the server follow a URL. Endpoints are built from validated identifiers.
- Requests never forward the caller’s cookies or authorization and never forge an Origin.
- Join records only by exact identifiers, never by title, tally or name similarity. Keep source URLs, retrieval times and languages. A missing observation is a gap, not a zero, and a missing relationship is unknown, not absent.
- Use one source writer, one activity-index writer and at most one corpus writer. Page views never start an indexer or a corpus download.
- Caches, indexes, corpora, recording catalogues, Following data and hosting configuration stay outside Git.

`server/public-data-policy.test.mjs` and `server/public-serving.test.mjs` enforce the routing and configuration boundary.

To add a source, document it here (access path, licence, limits), route it through the existing client, cache and queue, and add a small test fixture that records its source URL and retrieval time.

### Request limits

The [API specification](https://data.europarl.europa.eu/api/v2) allows 500 requests in five minutes “to the same endpoint” without defining endpoint scope. The application therefore shares one rolling 500-request allowance across the whole API, and background work may use at most 80% of it so visitors keep headroom. The other sources publish no numeric allowance; they get separate, small per-origin pools, and every source’s `Retry-After` is honoured. Operating modes are in [Development](DEVELOPMENT.md#upstream-requests).

## Licences and attribution

| Material | Terms | Basis |
| --- | --- | --- |
| Open Data API records | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/); CC0 may apply to raw data and metadata | Article 4 of the Bureau decision on Parliament’s open data, [OJ C/2025/341](https://eur-lex.europa.eu/eli/C/2025/341/oj) |
| Website text, portraits, OEIL summaries, documents and recordings | Reuse allowed with the source acknowledged; third-party items keep their own rights | Parliament’s [legal notice](https://www.europarl.europa.eu/legal-notice/en/) |
| EuroVoc and country terminology | Commission reuse policy (CC BY 4.0) | [Decision 2011/833/EU](https://eur-lex.europa.eu/eli/dec/2011/833/oj) |
| Cellar legislative metadata | CC0; linked documents retain their own terms | Publications Office [Cellar legal notice](https://op.europa.eu/en/web/cellar/legal-notice) |
| Commission proposal and EU act texts | Reuse with acknowledgement; a derived diff must say it is modified and must not be presented as an official consolidated text | [EUR-Lex legal notice](https://eur-lex.europa.eu/content/legal-notice/legal-notice.html?locale=en) |
| EbS+ live video | Broadcaster’s conditions; attribution shown beside playback | [Audiovisual Service conditions](https://audiovisual.ec.europa.eu/en/conditions-of-use) |

Every page footer shows `src/components/DataNotice.tsx`: the attribution “© European Union – Source: European Parliament”, the licence, a note that the site is independent and its counts are derived, and a pointer to the original. Documents and recordings are linked or embedded from their official source; the application serves cached portraits and extracted text but offers no bulk download. The site does not use Parliament’s logo or present itself as a Parliament service. Upstream requests identify as `EP-OpenData-Explorer` (`server/user-agent.mjs`).

## Source notes

### Open Data API

- The current term (term 10) starts on 16 July 2024. `/meetings` accepts comma-separated years and offset pagination; speech and date-range filters have no span limit.
- `/meps/show-current?mandate-date=YYYY-MM-DD` gives the roster on a date. Use it, not today’s roster, to classify historical speakers. On a term’s first sitting day it omits newly elected members (`2024-07-16` fails with HTTP 500; `2019-07-02` returns 288 members with HTTP 200), so speakers on those days are checked against their own `MEMBER_PARLIAMENT` dates.
- `/plenary-documents/feed`, `/committee-documents/feed` and `/parliamentary-questions/feed` are fixed last-month Atom feeds without date parameters. `/procedures/feed` and `/adopted-texts/feed` accept `timeframe=custom&start-date=YYYY-MM-DD` but no end date. None documents pagination or an entry limit, so a missed month can’t be recovered from the feeds; the indexer pages catalogues instead.
- HTTP 204 is the API’s empty or terminal-page response. Treat it as an empty result only after a successful first page; otherwise it is unavailable.
- Records contain fields such as `notation_codictPersonId`. These are fields of the API, not calls to another service.
- Older website speech references use a hyphenated legacy number (e.g. `CRE-9-2021-11-24-INT-3-103-0000_EN.html`). No changeover date is known.
- There is no published publication deadline. Speech texts, roll-call annexes, translations and API records appear at different times, sometimes out of speaking order. Activity dates say when something happened, not when it became readable.

### Members and rosters

- Profile `countryCode` and `groupCode` come only from `/meps/show-current`, joined by exact `identifier`. The per-MEP record has country authority URIs and group organisation IDs instead, and citizenship is not the country of representation.
- Gender uses explicit `hasGender` authority values: MALE and FEMALE map to male and female; other supplied codes map to Other / unspecified without inferring an identity. In the [EU Human sex vocabulary](https://op.europa.eu/en/web/eu-vocabularies/at-dataset/-/resource/dataset/human-sex), NKN means not known and NST means not stated; neither establishes a non-binary identity. Missing values stay unavailable. Retained source values and retrieval provenance are preserved.
- The EP `sortLabel` can run surname and first initial together without a separator, so it is kept as metadata and not used for sorting.
- `hasEmail` in the source is three-valued: omitted means unknown, an explicit empty value means none.
- Corporate bodies (`/corporate-bodies/{id}`) supply multilingual names, classification, dates and `isVersionOf`, which links temporal versions of the same committee across reconstitutions. Matching names or abbreviations never establish continuity.
- Parliamentary service dates come from `MEMBER_PARLIAMENT` memberships of `org/ep-N` bodies. Committee roles, party memberships and the term’s opening date never substitute for missing mandate dates, and leaving the roster never supplies a departure date.
- Political-group history comes from `EU_POLITICAL_GROUP` periods in `/meps/{id}`. The current-member feeds do not refresh outgoing members, so they are re-read separately. Missing evidence never implies NI (non-attached).
- `/meps/show-outgoing` and `/meps/show-incoming` list current-term changes but declare no term parameter; the `org/ep-10` mandate is the filter.
- Names use the roster’s `givenName`/`familyName` and `officialGivenName`/`officialFamilyName`. Prefer the form in the reader’s script; never transliterate.

### Questions and answers

- Questions can be tabled by Members, political groups or committees ([Rule 142](https://www.europarl.europa.eu/doceo/document/lastrules/RULE-142_EN.html), [Rule 144](https://www.europarl.europa.eu/doceo/document/lastrules/RULE-144_EN.html)). The [question data model](https://europarl.github.io/eli-ep/dsd/parliamentary-questions/#participation) separates person authors from organisations and addressees.
- Addressees come only from explicit `ADDRESSEE` participations. `org/HRVP` is shown as “Vice-President / High Representative”, following Parliament’s [questions page](https://www.europarl.europa.eu/plenary/en/parliamentary-questions.html?tabType=wq).
- API author arrays are unordered. Publication order comes from the DOCX byline, matched to the API authors by exact full name.
- The answering institution comes from the answer’s `creator` or `AUTHOR` organisation. The API doesn’t name the office holder; the English answer header does (“Answer given by High Representative/Vice-President Kallas on behalf of the European Commission”). Council replies have no named signatory.
- Story question lists include exact answer references from retained metadata in one bounded local read, without upstream requests. An unavailable answer observation is `null`; an observed empty list is `[]`.
- Commission answers (`…-ASW`) are separate records linked by `inverse_answers_to`. A question or document with fewer than 24 language versions, or still unanswered, can still change.

### Outside-speaker countries

Outside-speaker stories use CRE role/debate agreement first, then a [Wikidata](https://www.wikidata.org/wiki/Wikidata:Data_access) (CC0) exact name match to a unique human politician or office-holder, with countries from a dated office or single citizenship, seven-day public API/SPARQL refreshes, and unreadable data withholding the quarter’s line.

### Speeches and debates

- Speech headers are in `recorded_in_a_realization_of[].api:xmlFragment.<lang>` under `oralStatements/*/from/process`; request them with `include-output=xml_fragment`. Without `include-output` the API returns metadata only; omitting `language` with `include-output=xml_fragment` returns all languages in one response. Fragments marked `mtec` are machine translations, and translations arrive later, so recent months are re-checked. Some language fragments repeat an untranslated role under a different language key; map titles suppress a mismatched plain-tag role when it repeats that tag language's title.
- The metadata listing does not reliably expose correction editions or translation manifests; only a full fragment read shows them. Some individually published speeches are missing from API records and whole-sitting reports even though typed speech searches name them; their API detail routes return HTTP 500 with a nested dataset 404. These remain source gaps, but dated speech-record gaps do not hide retained outside-speaker addresses in a checked quarter.
- The source writer logs each speech the list names without a record as `[speech-source-gap]`, once per state change, and the data-gap audit (`node server/data-gap-audit-cli.mjs`) lists them under `speechSourceGaps`. A maintainer can load one with `server/import-speech-record-xml.mjs` from website XML captured outside the app. Such a record carries `acquisition: 'website-xml'`, stays across generations, is re-read from the API monthly and gives way to any real API record. The application itself never reads DOCEO.
- Blue-card questions, answers and reactions share the type `PLENARY_DEBATE_SPEECH`. Classify them from the header label, never the speech body; a `question` element alone does not identify a blue card. English fragments sometimes keep German labels (`Frage`, `Antwort`, `Reaktion`, `blaue Karte`), and machine translation produces labels such as `Blue Carton Response` (French) and `Blue Card issue` (Estonian). A translated Dutch `Blue Card Response` collapses answer and reaction: there, `speech` means reaction.
- Debate order comes from joining `inverse_consists_of` to the parent’s `consists_of`, sorted by `numbering`. There is no reply-to field, so exchanges are derived.
- A speech can have contradictory `inverse_consists_of` agenda links. They are narrowed only when the speech documents’ `is_part_of` evidence names one parent by term, date and full CRE item number.
- A debate’s `consists_of` can list a chair record twice: as `PVCRE-CHA-<n>` and as `MTG-PL-<date>-OTH-<k>`. The `OTH` form is not served as an activity.
- `MEETING_NAME_CHAIR` records name the new chair in `communication/heading/person` and the role in `communication/subheading`.
- Catch-the-eye is a `PROCEEDING_ACTIVITY` section between start and end markers (`Catch-the-eye procedure`, machine-translated as `On-demand interventions`). Other `PROCEEDING_ACTIVITY` records are procedural notes. A debate’s child URI alone therefore doesn’t identify a speech.
- `had_participation.participation_in_name_of` records the speaking capacity (“on behalf of”), not group membership. NI is not a political group.
- Some oral explanations of vote and chair interventions have no API transcript link although the published CRE has their speech and speaker identifiers. `server/speech-intervention-annotations.json` records verified classifications with their public-source URLs, dates and hashes.
- The live plenary feed’s `D…` debate IDs are a different namespace from Open Data `…OJ-ITM-D-…` IDs; they can’t be joined.

### Votes, attendance and outcomes

- Actual plenary event links resolve exact `executed` relationships to scheduled items. Joint debates merge their agenda context and retain each contributor’s scheduled-item provenance. Retained vote types use the same vocabulary and conflict handling as story counts; vote links require one exact scheduled vote target.
- Votes come from `/meetings/{sitting}/decisions`, `/vote-results` and `/foreseen-activities`. Named roll calls use `vote-method=ROLL_CALL_EV`; add `filter-output=voters` when named voters aren’t needed. Decisions and results appear some time after each voting session; until then the agenda lists the scheduled `PLENARY_VOTE` items inside a `MEETING_PART` slot with its start time.
- Actual positions (`had_voter_favor`, `had_voter_against`, `had_voter_abstention`) are separate from declared intentions (`had_voter_intended_*`), which never change the result.
- Show-of-hands (`VOTE_HAND`), electronic non-roll-call (`VOTE_ELECTRONIC`) and secret ballots (`VOTE_ELECTRONIC_SECRET`, `VOTE_SECRET`, `VOTE_SECRET_BALLOT`) have no individual positions and can have no published tally. A missing position is not an absence.
- Documents link to votes through `inverse_based_on_a_realization_of`, amendments through `decided_on_a_realization_of`, and partial decisions through `decided_on_a_part_of_a_realization_of`. Joint motions link to their originals through `is_derivative_of`. Roll-call requesters attach only through the decision’s `was_motivated_by` edge.
- Rule 188(3) alternative motions use the exact replacement heading and report identifier in English or Spanish native DOCX text. Rejection scope comes from complete published sentences; Czech rejection headings and French Council-position rejections at first reading are supported. Unsupported languages and incomplete wording remain withheld.
- A provisional-agreement decision binds a whole-document replacement through its exact amendment ID. Placement also requires the selected native DOCX to identify that report, amendment number and a whole-document heading. The reader links to the published agreement; it does not compute a comparison with the proposal. Missing or conflicting identities stay withheld.
- The reader shows a verified provisional agreement as its whole text with Parliament’s own marks (bold italics for new or changed text, ▌ for deleted). The text comes from the adopted text when it holds the position, otherwise from the agreement DOCX. The adopted text is the one record in `/adopted-texts?year=` that `adopts` the report and carries the decision date; its English DOCX is read to see whether it only states the final act. A stated `Regulation`, `Directive` or `Decision (EU) year/number` becomes an outbound EUR-Lex ELI link; a statement without a complete number gets no link. The Commission proposal links to EUR-Lex by CELEX only when the Cellar identity check passes, which reads no proposal text; otherwise the COM number is plain text. No comparison with the proposal is computed.
- Split-vote descriptions are English free text (`server/amendment-splits.mjs`). A parsed split doesn’t establish the wording span.
- Corrections and intention declarations can be filed for about two weeks after a part-session; they don’t change announced results. See the [roll-call annex](https://www.europarl.europa.eu/doceo/document/PV-10-2026-04-30-RCV_EN.html) and the [Plenary Guide](https://www.europarl.europa.eu/sed/doc/ext/manual/Plenary_guide_en.pdf) (Friday noon of the second following week, Rule 195). Outcomes are re-read during that window.
- In the roll-call XML (`/plenary-session-documents/PV-10-{date}-RCV`), `PersId` is the Open Data person ID and `MepId` is a different identifier.
- The sitting city comes from `hasLocality`: Publications Office places `FRA_SXB` (Strasbourg) and `BEL_BRU` (Brussels).
- Attendance comes from `/meetings/MTG-PL-{date}` fields `had_participant_person` and `had_excused_person`; the yearly catalogue omits them. Under [Rule 162](https://www.europarl.europa.eu/doceo/document/RULES-10-2025-01-20-RULE-162_EN.html) the register records signatures for the sitting. It doesn’t prove presence or absence at a vote, and minutes can correct it later.
- The chair of a voting section comes from English minutes XML (chair handovers and `Pv.AnnexVote` numbers) plus same-day `MEETING_NAME_CHAIR` speeches.
- Motion categories use the document’s term-10 `based_on` rule: Rule 149 for individual motions, and Rules 114, 136 and 150 for motions for resolutions (see the [Rules of Procedure](https://www.europarl.europa.eu/doceo/document/RULES-10-2025-07-07_EN.pdf)). The MEP website’s category descriptions can carry older rule numbers.
- Adopted-text candidates come from `/procedures/{id}` `created_a_realization_of`, and the adopted text must `adopts` the exact motion. Commission follow-ups link through `/adopted-texts/{TA-id}` → `inverse_answers_to` → `/external-documents/{id}` with type `ACT_FOLLOWUP`.

### Amendments

- Term-9 plenary reports and motions enter amendment discovery only when an exact current-term vote agenda item names them. Upcoming scope uses each list’s document date after the latest earlier exact plenary vote event; unavailable dates remain unclassified. During a part-session window (07:00 Brussels four days before the first sitting to 23:00 on the last day), its vote documents are re-read about hourly within the shared background allocation. New or changed list metadata receives extraction priority; held bytes are reused.
- Amendment lists hang off `/plenary-documents/{id}` through `inverse_foresees_change_of`, and each list must point back with `foresees_change_of`. List detail uses `/documents/{id}`. Committee lists come from the procedure’s `COMMITTEE_TABLING_REPORT`, `_OPINION` and `_AMENDMENT` links, with draft detail from `/committee-documents/{id}`.
- Each list’s DOCX supplies amendment numbers, proposers (`<Members>` bylines), target provisions and the original/proposed columns. List number ranges don’t prove that every number exists.
- Offline adopted-text calibration reads `/adopted-texts?year=YYYY` listings and their declared English XML distributions. Exact `adopts` plus decision date binds the TA; `AMDLST/AMEND/TI.AMD` retains amendment numbers and `STI.AMD` the finalized path. The sealed calibration inputs stay outside Git and never feed runtime placement.
- Committee amendment numbers are local to their list; the internal identity `committee:{list-id}:{number}` is never an official URI.
- An omitted distribution isn’t an unpublished file. B-10-2026-0435 and B-10-2026-0436 have public English DOCX files on the website, but their API records omit `is_realized_by`. For a typed list or motion record without any files, the collectors may try the standard `distribution/reds_iPlRp[_Amd]`, `reds_iPlRe[_Amd]` or `reds_iPlRc[_Amd]` DOCX route for that exact identifier. The downloaded native template must prove the report or motion token, document class and complete amendment range before its text is accepted. A failed proof remains a source gap. This route is a retrieval candidate, not a declaration that an English edition exists. Existing accepted wording from a different declared source stays retained when that declaration disappears.
- Greek and Cyrillic bylines are linked to members through the same amendment in a Latin-script edition of the same list, never by transliteration.
- Comparison column headings identify the baseline (Commission proposal, present text, Council position, motion text) and are language-specific. An empty original column can introduce a first annex when the complete proposed column supplies its ANNEX frame. An English Commission act with no native annex can place it after a unique complete signature block and before the separate legislative financial statement. Native source bytes must prove both boundaries and the absence of competing annex evidence. A second annex can follow the new first annex in the immediately preceding amendment of the same published list. Its native heading, introduction and complete table are retained, with a short amendment-order note. An English document class and a complete target printed on two lines of one Word paragraph are recovered only with one native line break and no conflicting header, hidden text or opaque content. The class remains metadata; the target retains its printed wording. An English new paragraph with one native formula and an empty original column can retain its surrounding words when a complete two-column comparison proves them. The reader labels the omitted formula and links to the source; replacements and other embedded objects stay withheld.
- A whole replacement of the first numbered English Commission annex instruction can anchor on its exact native instruction line and complete quotation/table extent. Elided existing-law cells do not supply matching evidence; the proposed table must be complete, and unsupported native content or missing source bytes withholds placement.

### Documents (DOCX and PDF)

- Declared distributions are preferred; the exact-ID fileless-record fallback above is also supported. Distributions send no HTTP validators; the listing’s `byteSize` and `issued` are the change signal.
- Extraction reads `word/document.xml` plus styles, numbering, settings and notes. It omits deleted and hidden text (`w:vanish`, `w:webHidden`). Automatic numbering follows [Word’s documented restart rules](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-oi29500/140a2cd9-2f26-456d-9760-ae6ecef4e8b5).
- Symbol-font `w:sym` characters are mapped with the [Adobe Symbol table](https://www.unicode.org/Public/MAPPINGS/VENDORS/ADOBE/symbol.txt) and [Microsoft’s symbol-font offset](https://learn.microsoft.com/en-us/typography/opentype/spec/recom#non-standard-symbol-fonts). Equations, drawings and other unsupported objects keep a U+FFFC placeholder and mark the paragraph incomplete.
- Original PDF pages are rendered with PDF.js when a PDF is declared. Scanned pages are not OCRed.
- Display language order is the requested language, English, French, Spanish, German, then the rest by ISO code. Agenda titles in `mul` use a combined French–English–German format.
- Drafting conventions used by the parsers come from the [Interinstitutional Style Guide 3.3.2](https://style-guide.europa.eu/fr/content/-/isg/topic?identifier=3.3.2-additions-and-numbering) and its [Latin-numbering inventory](https://style-guide.europa.eu/fr/content/-/isg/topic?identifier=annex-b-use-of-italics) (bis, ter, quater…), and the [DGT English Style Guide, Annex 3](https://commission.europa.eu/system/files/2023-11/styleguide_english_dgt_en.pdf) (Greek serial labels).

### OEIL

- Procedure files and document summaries are parsed from visible HTML, reached through exact procedure references from the API. Final-act summaries are preferred over proposal summaries.
- Procedure progress reads the printed status and the Key events table. OEIL events have no identifiers, so they’re keyed by procedure, date and label.
- Policy areas (topics) come only from OEIL procedure pages.
- Policy-area names: `server/oeil-subjects.json` holds the official English and French labels and hierarchy (450 codes), taken from the subject filter of the [English](https://oeil.europarl.europa.eu/oeil/en/search) and [French](https://oeil.europarl.europa.eu/oeil/fr/search) search pages, with its retrieval date. The list grows each year: budget and discharge subjects get annual codes with irregular suffixes, so their translations use templates that substitute only a year stated in the official label.
- The explorer's own translations for other languages live in `server/oeil-subject-translations.json`, each marked `explorer-translation`; they never override English or French. Missing names follow the shared text-language preference order. The site notice says these translations are the explorer's own.

### Press releases

- Parliament publishes English RSS feeds for [press releases](https://www.europarl.europa.eu/rss/doc/press-releases/en.xml), [plenary](https://www.europarl.europa.eu/rss/doc/press-releases-plenary/en.xml) and [committee](https://www.europarl.europa.eu/rss/doc/press-releases-committees/en.xml). Each holds only its latest 20 items and carries no procedure or document references, so coverage starts when following starts.
- Each announced release page is read once. Press-room listings and search are never crawled, and page links are never followed. robots.txt allows `/rss/` and `/news/`; pages marked `noindex`, `nofollow` or `none` are not used.
- Only exact links in the page’s “Further information” list count: OEIL procedure files and summaries, and Doceo reports, motions, adopted texts and committee drafts (`A`, `B`, `RC`, `TA`, `PR`, `AD`, `AM`, `AL`, `PA`). A summary or document matches a dossier only when that dossier’s OEIL page links the same ID.
- The committee “latest news” feed is not used: its pages are `noindex, nofollow` and have no procedure links.

### Hemicycle

Parliament’s interactive plan loads `/erpl-public/hemicycle/{str,bru}/en.json` (seats, Members, groups, `startDate`) and an SVG of numbered seat circles under `/commonFrontResources/evostrap/4.0.1/lib/widgets/hemicycle/svg/`. That path carries the widget’s version, so a site release can retire it. Both need the `Mozilla/5.0 (compatible; …)` agent form. `persId` is the API’s MEP identifier.

- The plan records allocated seats; a Member may occasionally sit elsewhere. The chambers are numbered differently, and each file is updated separately: Parliament says for each part-session, but the Brussels file can lag by months and then lists former Members. The PDF plans on the same page are updated separately again and can disagree with the JSON.
- Only the latest plan is published. The single source writer checks each chamber every six hours with conditional requests and keeps a revision and a diff when seats or Members change, so history starts with the first check. A process without the index reads the source directly, at most hourly, or every five minutes after a failure.

### Voting lists

The Tabling Service lists are indicative and cover the current or next part-session. The public votes page links DOCX files under `/sedcms/votingList/` and the session schedule under `/sedcms/pubfile/VOTING_SCHEDULE/` on `www.europarl.europa.eu`; these and `/plenary/en/votes.html` are the only admitted website paths. Files are overwritten in place, and link version queries do not select historical editions.

The single source writer checks the page at most hourly between 07:00 and 23:00 Brussels time, from four days before a consecutive run of ODP sittings through its last sitting. Files use conditional requests every six hours, hourly from 06:00 on their sitting day until the last known voting slot ends. Writer contention can delay collection. Parsed revisions retain exact references and unclassified cells; no raw DOCX is retained. All list and schedule data expire 30 days after the part-session's last sitting. Ballot-to-decision bindings are separate.

### Publications Office (Cellar)

- Content negotiation: `application/rdf+xml;notice=tree` for metadata and `application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml` for DOCX. A DOCX item can return 406 advertising `application/zip;type=akn4eu`; one retry with that type returns a Word package.
- Only `publications.europa.eu/resource/celex/…` and discovered Cellar UUID paths are fetched. CELEX parentheses must be encoded.
- A Commission proposal is identified from a report’s explicit COM and typed COD, CNS or NLE references, checked against Cellar authorship, version and dossier. `AMEND_PROP_REG`, `AMEND_PROP_DIR` and `AMEND_PROP_DEC` use the same exact COM-reference checks as the corresponding proposal types. Expressions, manifestations and act/annex parts are discovered through RDF; the `_cp` suffix marks a separate annex part, not an ordinal. For competing numbered final editions of one COM reference, each edition must pass the same identity, language and complete-part checks. If their extracted body text, notes and note anchors are identical, the unqualified final edition supplies the baseline; evidence retains every compared edition and its source hashes. This establishes text equality, not legal-edition or package equivalence. Differing or unavailable text remains unresolved.
- An English NLE guidelines attachment can use the amendment's Annex I address only when it is the proposal's sole declared annex and the native act explicitly adopts that annex. Consecutive guideline headings divide a global sequence of unnumbered body paragraphs; they do not restart paragraph addresses. The native annex remains unnumbered, and an unreadable cover stays incomplete.
- English native NLE comparisons with detached notes keep the provision and note payloads separate. Every original note must match a complete Word footnote at the same body position; proposed markers must have unique payloads. An unchanged original payload can remain without a proposed marker, but no anchor is invented for it. A new recital −1 can precede a complete, consecutive recital block bounded by “Whereas:” and the decision's adoption formula.
- Council first-reading positions are identified by ST number, `POSIT` type and the first-reading event, and read from the same-language XHTML.
- Existing law comes from dated consolidations of the cited basic act. Historical selection uses the amendment date, or its exact list record date when the amendment has no date. XHTML grid-list dash indents retain their published text and ordinal ownership. Consolidations are documentation texts, not official versions ([EUR-Lex guide](https://eur-lex.europa.eu/collection/eu-law/consleg.html?locale=en)).
- When the existing act is unavailable, an amendment adding a new amending instruction to an A report (a new point under the amending paragraph, or a new article) is placed in the report’s Commission proposal, if its proposed column opens with that instruction’s printed number. NLE reports are excluded.
- EuroVoc topics: document `is_about` descriptors become keywords, and procedures get their initiating act’s EuroVoc. Place names use the held Publications Office [Countries and territories](https://op.europa.eu/en/web/eu-vocabularies/authority-tables) preferred labels (version 20260923-0, retrieved 3 November 2026), refreshed only on version change; missing local names fall back to client CLDR, then English. Countries use EuroVoc `skos:exactMatch` links to the country authority (`server/topic-country-*.json` record the queries and retrieval dates). EuroVoc 5695 (Kosovo) points to `XKX` while the authority uses `1A0`, so it maps to no place.
- Stories and topic records classify a verbatim item by its own ODP activity type: the newest retained observation decides, and a same-time disagreement keeps it a debate. Vote-family types are not debates. Without a type, an item whose own English label ends in “(vote)” is a voting-time item. `PROCEEDING_ACTIVITY` markers and chair announcements are not topic records. A story event read adopts the held complete debate snapshot for the same item (the same `/events/{id}` response) instead of fetching it again.
- Legal references in questions and answers (CELEX, ELI, COM/SWD/JOIN and procedure numbers) are resolved by SPARQL; a reference links only when exactly one work matches.
- `src/terms.json` holds procedure-phase labels in all 24 languages with their concept URIs. The interface labels **Vote** and **Amendment** are app-owned machine translations, because EuroVoc 4750 (electoral voting) has the wrong sense.

### Live plenary

- `GET /api/plenary-live` reads the [plenary JSON feed](https://www.europarl.europa.eu/plenary/en/getSpeakerListAndPlenaryMessages.html?dateSys=20261020) (`dateSys=YYYYMMDD`), today’s `/meetings/{sitting}/foreseen-activities` and the [EbS+ current-programme JSON](https://8hwk2cyeyb.execute-api.eu-west-1.amazonaws.com/parrotfish-prod/ebs/live/EBSPLUS). Both website JSON interfaces are undocumented.
- A timed `MEETING_PART` in the agenda says what is scheduled, not what is being debated.
- EbS+ plenary coverage is recognised from the programme metadata: `PUBLISHED`, `LIVE`, EbS+ channel `6082c9bb97ad8b2acf7fcc98`, institution `2618` (European Parliament) and the first title paragraph `EP Plenary Session`. The player is the broadcaster’s embed `https://audiovisual.ec.europa.eu/embed/ebsplus?language=EN`. Its timestamp is an editorial update, not a heartbeat.

### Multimedia Centre and player

- Videos play in Parliament’s own embed (`https://webstreaming.europarl.europa.eu/ep/embed/embed.html?event={recording-id}`), opened at the speech with its `start`, `end`, `language` and `audio` parameters (`server/mmc.mjs`).
- Recording metadata comes from `https://api.multimedia.europarl.europa.eu/o/epmp-frontend-rest/v1.0/media/{recording-id}` and discovery from the same API’s `search?type=105&subtype=2&df={date}&dt={date}`, the endpoints the Multimedia Centre website calls. They are undocumented and may change. A first page with an empty array and no pagination fields is the empty-result format.
- Candidates are identified by `mediaBusinessID`, `EventDateStart`, `EventDateEnd`, `statusName` and the plenary category, never by title. A speech’s start and end times select one recording.
- Interpretation tracks are listed over the player’s socket (`wss://websockets.services.eup.glcloud.eu/content-manager/api/v1/socket.io/?EIO=4&transport=websocket`, namespace `/content`, event `join:event`, with the recording’s `commonId`; `server/player-content.mjs`).
- A plain product-only user agent can receive HTTP 403, so searches use `Mozilla/5.0 (compatible; EP-OpenData-Explorer/0.1; recording catalogue)`. The [Multimedia API robots policy](https://api.multimedia.europarl.europa.eu/robots.txt) disallows crawling outside `/documents/`, so reads are date-scoped and happen only when playback is requested.

### Portraits

- Each MEP record’s `img` points to the website image, e.g. `https://www.europarl.europa.eu/mepphoto/4465.jpg`. Without `img`, the same pattern is built from the MEP ID; no other path is accepted.
- The website sends `ETag`/`Last-Modified`, so portraits are revalidated conditionally. The Open Data API, RSS, Multimedia Centre, OEIL and SPARQL send no validators.

## Full-text corpus

With `CORPUS_ENABLED=true`, a worker stores current-term speech fragments and question/answer texts in `corpus-v1.sqlite` for local full-text search. Question and answer texts prefer DOCX and fall back to an API-declared PDF in the same language. `CORPUS_LANGUAGES=primary` keeps only originals and English. Search uses SQLite FTS5 with Unicode tokenisation; Latin diacritics are folded, Greek accents are not.

## Test fixtures

`server/fixtures` holds small public API responses, OEIL pages and document excerpts used by tests. JSON fixtures record their source URLs and retrieval times; OEIL fixtures are named after their procedure or summary reference. Fixture counts are not live figures.

## Maltese speech analysis

The `mt` entry in `server/insights-speech-stopwords.json` is an app-authored list of function words (pronouns, demonstratives, possessives, conjunctions, prepositions, auxiliaries, particles and article/preposition forms at hyphen boundaries), enumerated by grammatical category rather than by frequency or from a third-party dataset. References consulted on 2 November 2026: [Universal Dependencies Maltese segmentation](https://universaldependencies.org/mt/index.html) and [Camilleri’s Maltese grammar notes](https://github.com/johnjcamilleri/Maltese-GF-Resource-Grammar/blob/master/doc/grammar.org).

## World map geometry

The Places map uses Natural Earth 1:110m Admin 0 countries and 1:50m tiny-country points, projected by `scripts/world-map.py` (Equal Earth). Places join by authority ISO alpha-3, except Kosovo (`1A0` → `KOS`). See [Third-party notices](../THIRD_PARTY_NOTICES.md) for source URLs.

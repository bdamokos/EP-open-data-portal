# Public data sources

This page lists the external sources the application uses, what each provides, and the quirks a contributor needs to know. It describes current behaviour. Change history belongs in Git and pull requests.

| Source | Use | Access |
| --- | --- | --- |
| [European Parliament Open Data API v2](https://data.europarl.europa.eu/en/developer-corner/opendata-api) ([specification](https://data.europarl.europa.eu/api/v2)) | MEPs and dated rosters, memberships, questions and answers, speeches, agendas and meetings, procedures, plenary documents, adopted texts, vote results and decisions, corporate bodies | Anonymous JSON-LD, Atom and XML from `data.europarl.europa.eu/api/v2` |
| [Parliament’s public website](https://www.europarl.europa.eu/) | Portrait images, activity RSS, official document files (DOCX/PDF) | Only URLs the API supplies (portraits, document distributions) or validated official paths |
| [Legislative Observatory (OEIL)](https://oeil.europarl.europa.eu/oeil/en/find-out-more) | Dossier stages and document summaries, English and French where supplied | Anonymous HTML parsing of exact procedure-file and document-summary pages |
| [Publications Office knowledge graph](https://op.europa.eu/en/web/cellar/cellar-data/metadata/knowledge-graph) | EuroVoc, country terminology, procedure-phase labels, topic timelines, cited EU acts and Commission documents | Anonymous SPARQL GET to `publications.europa.eu/webapi/rdf/sparql` |
| [Parliament Multimedia Centre](https://multimedia.europarl.europa.eu/) | Recording metadata and the official embed URL | Undocumented JSON endpoint behind the public website (see below) |
| [Parliament’s published player](https://webstreaming.europarl.europa.eu/) | Playback through the official embed, and the list of interpretation tracks | Official iframe, created only after Play; undocumented player metadata |
| [EUR-Lex](https://eur-lex.europa.eu/), DOCEO, official website pages | Reader links | Outbound links only; never fetched |

Bundled supporting data: committee labels from the corporate-bodies API, country labels from the Publications Office authority scheme, Natural Earth map geometry (simplified locally), and MIT-licensed stopword lists. See [Third-party notices](../THIRD_PARTY_NOTICES.md).

## Access rules

- Every source is anonymous. No adapter uses credentials, private exports or copied production caches. A failed public request becomes a reported gap. It must never lead to credentials or to bypassing a protection such as DOCEO's browser verification challenge.
- Server routes are read-only. Callers cannot choose an upstream host, supply upstream query text (such as SPARQL) or make the server follow a URL. Corpus search runs user queries only against locally stored text. Endpoints are built from validated identifiers (`server/odp.mjs`, `server/source-record.mjs`, `server/legal-references.mjs`).
- Requests never forward the caller's cookies or authorization and never forge an Origin. Open Data API and portrait downloads reject redirects. OEIL and Publications Office reads follow same-origin redirects only (`server/official-context.mjs`). Downloads stream within size limits.
- Upstream reads go through per-source admission queues with spacing, concurrency limits, cooldowns and `Retry-After` handling (`server/upstream-queue.mjs`, `server/request-budget.mjs`). Interactive reads keep a reserved slot.
- Use one source-cache writer, one leased activity-index writer and, when enabled, one leased corpus writer that opens the index read-only. Page views never start an indexer or a corpus download.
- Join records only by exact identifiers, never by title, tally or name similarity. Keep source URLs, retrieval times and languages. Missing observations stay null or explicit gaps, not zeroes.
- Caches, indexes, corpora, recording catalogues, following data and hosting configuration stay outside Git.

`server/public-data-policy.test.mjs` and `server/public-serving.test.mjs` enforce the routing and configuration boundary.

To add a source, document it here (access path, licence, limits), route it through the existing client, cache and queue, and add a small test fixture that records its source URL and retrieval time.

## Licences and attribution

| Material | Terms | Basis |
| --- | --- | --- |
| Open Data API records | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/); CC0 may apply to raw data and metadata | Article 4 of the Bureau decision on Parliament’s open data, [OJ C/2025/341](https://eur-lex.europa.eu/eli/C/2025/341/oj) |
| Website text, portraits, OEIL summaries, documents and recordings | Reuse allowed with the source acknowledged; third-party items keep their own rights | Parliament’s [legal notice](https://www.europarl.europa.eu/legal-notice/en/) |
| EuroVoc and country terminology | Commission reuse policy (CC BY 4.0) | [Decision 2011/833/EU](https://eur-lex.europa.eu/eli/dec/2011/833/oj) |

Every page footer shows `src/components/DataNotice.tsx`: the attribution “© European Union – Source: European Parliament”, the licence, a note that the site is independent and its counts are derived, and a pointer to check the original. Hiding it leaves an “About this site” toggle with the same text. Documents and recordings are linked or embedded from their official source. The application also serves cached portraits, extracted document and speech text, and bounded source-record views for reading, each with its source URL. It offers no bulk download of source material. The site is named for its data source (“European Parliament data explorer”) and does not use the Parliament’s logo or present itself as a Parliament service. Upstream requests identify as `EP-OpenData-Explorer` (`server/user-agent.mjs`).

## Source notes

### Member voting records

The member voting API reads a selected held plenary week or sitting through `/meetings`, sitting `/decisions`, `/vote-results` and `/foreseen-activities`. Named roll calls use `vote-method=ROLL_CALL_EV` without `filter-output=voters`; a separate voter-excluded decision read retains non-named and lapsed outcomes. Exact decision parents, result children and agenda references connect documents, procedures, amendments and split components. Procedural ballots without agenda links remain available with unresolved context. English reference labels provide an explicitly labelled scope heuristic when no exact amendment/component reference exists.

Actual `had_voter_favor`, `had_voter_against` and `had_voter_abstention` positions stay separate from `had_voter_intended_*` declarations. Non-named votes and missing positions never establish individual choices or physical absence. Omitted declarations are not reported as proof that none exist. A roll-call method on a lapsed decision does not establish a conducted ballot. Null tallies remain distinct from zero, and conflicting/malformed named references and tally mismatches remain explicit. Current roster metadata is not used as historical group membership or mandate eligibility.

Source coverage is bounded and independent of the activity index. Complete collection requires successful paging and all declared result/decision children; source errors, repeated pages and caps retain uncertainty. Retrieval times, content hashes and stale/refresh flags identify the source snapshot; no API publication SLA or publication version is inferred. Parliament's [roll-call annex](https://www.europarl.europa.eu/doceo/document/PV-10-2026-10-07-RCV_EN.xml) states that corrections/intention declarations do not change announced results and may update over the two weeks following a part-session. The endpoint is a selected-period observation, not a complete term history or participation statistic.

### Open Data API

- `/meetings` accepts comma-separated years and offset pagination. Some historical agenda endpoints return HTTP 204. The UI shows those as unavailable agendas and keeps the sitting selectable.
- Speech and date-range filters have no span limit in the API. The current term starts 16 July 2024.
- Records can contain fields such as `notation_codictPersonId`. These are fields of the open API, not calls to another service.
- `/meps/show-current?mandate-date=YYYY-MM-DD` gives the dated roster. Use it, not today's roster, to classify historical speakers.
- Parliamentary questions can be tabled by Members, political groups or committees ([Rule 142](https://www.europarl.europa.eu/doceo/document/lastrules/RULE-142_EN.html), [Rule 144](https://www.europarl.europa.eu/doceo/document/lastrules/RULE-144_EN.html)). The [question data model](https://europarl.github.io/eli-ep/dsd/parliamentary-questions/#participation) separates person authors from organisations and addressees. The Questions view counts exact person-author IDs as MEP authors at tabling and distinguishes current and former MEPs using the saved current roster. Its author total includes both; demographic charts cover current MEPs only. This question-specific classification does not apply to plenary speakers.
- Older website speech references use a hyphenated legacy document number (e.g. `CRE-9-2021-11-24-INT-3-103-0000_EN.html`). No archive-wide changeover date is known.

### Speeches and debate structure

- Speech headers are in `recorded_in_a_realization_of[].api:xmlFragment.<lang>` under `oralStatements/*/from/process`. Request them with `include-output=xml_fragment`.
- Blue-card questions, answers and reactions share the activity type `PLENARY_DEBATE_SPEECH`. Classify them from the header label, never from speech bodies. A `question` element alone does not identify a blue card. English fragments sometimes keep German labels (`Frage`, `Antwort`, `Reaktion`, `blaue Karte`). Machine translation can collapse a Dutch answer and reaction into `Blue Card Response`. In that case the XML element decides: `speech` means reaction, `answer` means answer.
- Debate order comes from joining `inverse_consists_of` to the parent's `consists_of`, sorted by `numbering`. The API has no reply-to field, so exchanges are derived. Gaps, duplicates or unclassified records stop reconstruction.
- Oral speeches can have contradictory `inverse_consists_of` agenda links. Outside voices and debate sequences narrow these only when all retained speech documents' `is_part_of` evidence identifies one of the published parents by the same term, date and complete CRE/PVCRE item number (including subitems, allowing CRE zero-padding). Missing or conflicting document evidence retains the supplied links; no parent is invented. Older Outside voices projections retained only one document basename: ambiguous rows are re-read once by the existing source writer under its normal budgets, with failed verification retained as a retry gap. Verification stays in the canonical queue across active-generation runs and daily snapshot changes, preserving backoff and pending coverage. Page reads never fetch or rewrite sources. Original links remain available in source details. Debate coverage reports fetched records explicitly resolved to another chapter separately from missing records; unavailable records remain gaps. A resumption is a separate procedural chapter, sometimes containing real speeches; it neither inherits the previous subject nor assigns the next one. Continued debates retain their explicitly numbered chapters. Chair-change and other procedural records keep their supplied containment.
- Catch-the-eye is a `PROCEEDING_ACTIVITY` section with start and end markers (`Catch-the-eye procedure` or, machine-translated, `On-demand interventions`). Other `PROCEEDING_ACTIVITY` records are procedural notes.
- `MEETING_NAME_CHAIR` records name a new chair in `communication/heading/person`, with the role in `communication/subheading`. The person must match the record's participation ID.
- `had_participation.participation_in_name_of` records speaking capacity for **On behalf of**, not group membership. Match the person and organisation on the same speaking participation. NI is not a political group.
- Display names use the roster/profile `givenName`/`familyName` and `officialGivenName`/`officialFamilyName`. The UI prefers a supplied form in its script and never transliterates. A President/Vice-President office requires an exact Parliament membership valid on the speech date.

### Group voices

The group view counts distinct oral speech/person/group designations from `had_participation.participation_in_name_of`, beginning with term 10. Missing designations, untranslated role headers, dated rosters and offices never create a group attribution. Localised names retain the exact person ID.

The activity writer stores a compact, generation-scoped metadata projection with exact participation, organisation, speech and agenda IDs, source URL and retrieval time. A separate optional queue re-reads monthly oral metadata catalogues once when upgrading an old index, under the existing lease, request, time and disk budgets. It preserves core and amendment cursors and does not block core publication. Older application versions ignore the additive tables; the next new writer adopts the last retained projection and pending cursors. Page reads use a group/date covering index, at most 20,000 scalar designations and 50 contribution records, without upstream requests or transcript scans. Coverage stays partial even when the local backfill finishes; an empty selection is not a parliamentary census.

Subjects use the versioned editorial primary-subject map in `server/group-voice-subjects.json`, joined only by exact agenda or speech ID. The map currently covers reviewed July, September and October 2026 headings. These are broad editorial groupings, not EuroVoc or official annotations of individual speeches. Each contribution has one primary subject; unlisted records and conflicting parents stay **Unclassified**. Add classifications by reviewing an exact published heading and updating the map and its version (which queues a bounded metadata re-projection), never by joining titles or assuming an MEP specialises in a topic. Subjects and people show contribution counts, not speaking time or political influence. Cross-group subject columns divide each group's count for a subject by that group's classified contributions in the same window and row cap, so group size and unclassified coverage do not drive the comparison; a group without classified records shows no share rather than zero.

### Motions and outcomes

- Outcomes use `/plenary-documents/{id}`, `/meetings/{sitting-id}/vote-results` and `/meetings/{sitting-id}/decisions`, requested with `filter-output=voters` to omit named voters. Documents link to votes through `inverse_based_on_a_realization_of`, and joint motions to their originals through `is_derivative_of`.
- A decision qualifies only if it belongs to the linked vote result, names the same B10/RC-B10 reference in its English heading, and covers the whole motion. Both “Motion for a resolution” and “Motion for a resolution (as a whole)” qualify. All declared decision children must be present. Show-of-hands decisions give an outcome without totals.
- Wording comparison: `/procedures/{id}` lists candidate adopted texts via `created_a_realization_of`, and `/adopted-texts/{id}` must `adopts` the exact joint motion. Both texts must share a published DOCX language.

### Plenary amendments

Amendment trails for reports and motions are collected by the activity-index worker in a separate job queue under the same writer lease. Reads never fetch sources (`server/amendments*.mjs`).

- `/plenary-documents/{id}` lists amendment-list documents through `inverse_foresees_change_of`. Each list must `foresees_change_of` the target. When the link is URI-only or the record incomplete, `/documents/{doc-id}` must confirm the URI, amendment-list type and forward target.
- Each list's API-linked DOCX supplies amendment numbers, proposers, group statements, target provisions and the original/proposed columns. When the table structure is ambiguous, both wording columns are withheld rather than guessed (`server/amendment-documents.mjs`).
- Outcomes come from the sitting `/vote-results` and `/decisions?filter-output=voters` records shared with motion outcomes, through `decided_on_a_realization_of`. Split votes keep separate component outcomes. A missing outcome is unavailable, never a rejection.
- Author links need an exact normalized full name or an official voting alias, plus an active mandate on the tabling date from the dated roster. Aliases come from the roll-call XML of `/plenary-session-documents/PV-10-{date}-RCV`, where `PersId` is the Open Data person ID and `MepId` is a different identifier. Ambiguous identities stay unlinked.
- Split-vote descriptions are parsed from English (`server/amendment-splits.mjs`). A parsed plan has `grounding: not_attempted`: it does not establish a validated wording span or the final adopted text. Unparsed descriptions are recorded, exposed read-only at `/api/amendments/failures`, and reparsed when the parser version changes.

The context-specific `/api/motion-amendments/{id}` endpoint reads those indexed observations for one exact original or joint motion. Text authorship comes only from that text's exact `creator` or person participation with role `AUTHOR`; original/joint links require `is_derivative_of` and do not transfer authorship. Selected-member amendment matches use the checked proposer date and resolved identities independently, including per-list variants. All-results annotation and member filtering share the same matching rule.

List number ranges do not establish the presence of every number. Revised or conflicting lists retain their separate wording and proposer evidence; ambiguous aggregate wording is withheld. Requested language, actual amendment wording language and queried-text file fallback are separate observations. Whole-amendment outcomes remain separate from split decisions, including mixed, lapsed, withdrawn and unavailable results. Adoption alone establishes neither causal credit nor wording survival. The endpoint preserves source URLs, retrieval dates, parser and distribution freshness, and retained evidence after partial refreshes. An empty unindexed target is unavailable evidence, not no amendments. An explicitly empty current list relationship has its own source proof and narrow `published-amendment-list-relationships` observation scope; it cannot erase retained records or establish absence of oral amendments or complete vote evidence. Global background work does not establish that this target is being processed.

### Documents (DOCX)

Distributions linked by the API are processed locally with bounded decompression (`server/document-text.mjs`). Extraction reads `word/document.xml` plus style, numbering, settings, footnote and endnote parts. It omits hidden text (`w:vanish`, including inherited styles, which Parliament uses for translation markers) and keeps automatic numbering and referenced notes. Page-dependent note restarts and unsupported numbering are explicit gaps. Answer PDFs carry the same link targets as their DOCX, so only DOCX is read.

Extracted texts are saved in `ODP_CACHE_DIR/document-text-v1` with source URL, retrieval time and the API's file size and issue time. Distributions send no HTTP validators, so the API listing is the change signal: a different size or issue time re-reads the file. Otherwise a text retrieved within 60 days of its document date is re-read at most weekly when viewed, and a text retrieved later is kept. The directory is capped by `DOCUMENT_TEXT_MAX_DISK_MIB` (default 256) and removes the least recently read texts first; a removed text is downloaded again when next opened.

### OEIL

Summaries are parsed from visible HTML, reached through the exact procedure reference from the API. Final-act summaries are preferred over proposal summaries. No summary is invented when none is published.

### Publications Office

- Legal references in questions and answers (CELEX, ELI, Cellar, COM/SWD/JOIN, procedure and question numbers) become lookup keys through fixed patterns and are resolved in batched SPARQL. A reference links only when exactly one work matches. Official Journal position links (`uri=uriserv:OJ…`) are not resolved.
- `src/terms.json` holds procedure-phase labels (RDG1, RDG2) in all 24 languages, with concept URIs and query provenance. IATE entries corroborate them but are not substituted.
- **Vote**, **Amendment** and some short interface labels are app-owned machine translations with model/date provenance. They are not official translations. EuroVoc 4750 (electoral voting) gives the wrong sense for parliamentary votes.

### Multimedia Centre and player

Videos play in the Parliament's own embedded player. The Multimedia Centre website offers embed URLs for its recordings, and we use the same official embed (`https://webstreaming.europarl.europa.eu/ep/embed/embed.html?event={recording-id}`). The only difference is that we look the URL up programmatically instead of copying it from the website (`server/mmc.mjs`):

1. The recording's metadata, including that embed URL and the recording's start and end times, comes from `https://api.multimedia.europarl.europa.eu/o/epmp-frontend-rest/v1.0/media/{recording-id}`, the endpoint the Multimedia Centre website itself calls.
2. A speech's start and end times from the Open Data API select exactly one recording. The embed URL gets the player's own `start`, `end`, `language` and `audio` parameters, so it opens at that speech.
3. Before playback, the player's metadata connection confirms that the requested interpretation track exists: `wss://websockets.services.eup.glcloud.eu/content-manager/api/v1/socket.io/?EIO=4&transport=websocket`, namespace `/content`, event `join:event`, with the recording's public `commonId` (`server/player-content.mjs`). Only `PUBLISHED` content matching the recording is accepted. The embed starts paused on the original audio (`audio=or`). The client then checks the iframe's actual track list and adaptation events before switching to the requested language, and does not play if that selection fails or is ambiguous.

Both endpoints are undocumented and may change. The server reads metadata only and never downloads video. There is no automatic recording search: speech-to-recording lookups use a saved catalogue of public Multimedia Centre search results, and missing coverage is shown.

### Portraits

The API supplies portrait URLs. Each MEP record's `img` field points to the website image, e.g. `https://www.europarl.europa.eu/mepphoto/4465.jpg`. The images themselves are hosted on the website, not served by the API. If `img` is missing, the same URL pattern is built from the MEP ID. Only that path pattern is accepted. Images are fetched on demand through `/api/portrait/{id}` and cached in `ODP_CACHE_DIR/portraits-v1` with source URL, retrieval time, checksum and the host's `ETag`/`Last-Modified` validators (`server/portrait-cache.mjs`). The roster is never prefetched. A portrait viewed more than 7 days after retrieval is refreshed in the background with a conditional request; a `304 Not Modified` keeps the saved image and records the confirmation as the new retrieval time. The Open Data API and the other periodically read sources (activity RSS, Multimedia Centre, OEIL, Publications Office SPARQL) send no validators, so they are re-read on their cache lifetimes.

## Full-text corpus

With `CORPUS_ENABLED=true`, a leased worker stores current-term texts in `corpus-v1.sqlite` (`server/corpus-worker.mjs`, `server/corpus-store.mjs`):

- Speeches come from `/speeches` with `include-output=xml_fragment`, month by month. Fragments marked `mtec` are machine translations. Recent months are rechecked because translations arrive later. Readers preserve the XML’s `<inline name="i">` italics in place, including editorial remarks within paragraphs and between speech paragraphs. Parentheses alone do not identify editorial remarks.
- Question and answer texts come from the DOCX distributions of saved index records. Original languages and English come first. `CORPUS_LANGUAGES=primary` keeps only those.

Search uses SQLite FTS5 with Unicode tokenisation. Latin diacritics are folded, Greek accents are not. Endpoints:

- `GET`/`POST /api/corpus/search` search retained text only. POST accepts exact `sourceIds` scopes. Results are grouped by document by default. With `group=question`, a question and its linked answers count as one group. `total`, `offset` and `nextOffset` count groups. Clients must follow `nextOffset`, because `responseLimited` pages can be shorter than `limit`. Pagination stops at offset 1,000 (`truncated: true` means more matches exist; narrow the filters). Queries run one at a time in read-only workers, and busy or slow queries return HTTP 503.
- `GET /api/corpus/text?source-id=…&source-key=…` returns one stored variant with provenance, optionally highlighted with `q`.
- `GET /api/speech-transcript/{id}?lang=…` reads the exact retained speech language and its compressed XML, with source key, translation type and retrieval provenance. The corpus writer also retains the full official metadata once per speech, without duplicating XML, and derives speaker/header and intervention projections from supplied or retained fragments. Header projections include translations excluded by the text retention policy; metadata-only refreshes retain known speaker-name variants for exact current participants. Readers use that metadata and cached person records without upstream calls. Metadata retrieval and header/text provenance remain separate. Missing corpus languages or metadata use the existing speech-detail fallback; metadata delays and errors cannot block retained text. The read-only transcript workers have a separate concurrency limit from full-text searches, and page reads never create a corpus or start collection.
- `GET /api/corpus/status` reports coverage. `authoritativeComplete` is always false, because upstream gaps and later publications rule out a completeness claim.

Older corpora gain metadata through the existing leased writer: a resumable, metadata-only monthly catalogue backfill, including missing-record recovery, uses the same request, retry, time and disk budgets and does not redownload transcript XML. New and refreshed speech pages retain metadata during normal ingestion. Individual metadata failures become separate retry tasks, so text ingestion and monthly cursors can continue; status keeps those gaps visible. Known source languages remain available in the picker independently of which variants the corpus retains; selecting a variant absent from the corpus uses the detail fallback. Metadata-only refreshes preserve that known availability. `/api/corpus/status` reports retained metadata and whether that backfill is pending; source gaps remain explicit.

Speech clouds and contribution statistics prefer bounded pages from the retained speech corpus. Their totals describe saved records, and coverage remains partial; a finished backfill does not establish an authoritative catalogue. The existing writer builds a small local selection index from saved metadata without source requests. Clouds use exact-language paragraph text without decompressing XML, preserving translation and retrieval provenance. An absent corpus, unfinished local projection, empty stored selection, or known source language excluded by text retention uses the existing public-source cloud pagination. A selection never mixes local and upstream offsets. Changes to matching retained records restart the page walk; metadata and its selection fields update atomically. Saved word analysis also uses corpus paragraphs first, retaining its saved-file fallback without downloads.

Exact-ID speech context, media lookup, legacy speech readers and legislation associations reuse retained metadata where available. Context uses the saved intervention projection rather than reclassifying metadata with its XML removed. Whole-sitting context still uses the broader source feed: the corpus does not retain all procedural markers. Legislation records already in the activity index are read there first when the saved fields support the requested relationships; incomplete procedure projections retain the source fallback. Document readers retain their existing structured DOCX cache because corpus paragraph text cannot replace notes and links; official source readers continue to distinguish source records from derived projections.

## Test fixtures

`server/fixtures` holds small public API responses and OEIL pages used by tests. JSON fixtures record their own source URLs and retrieval times. OEIL HTML fixtures are named after their exact procedure or summary reference. Fixtures are not runtime catalogues and their counts are not live figures.

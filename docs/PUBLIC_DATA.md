# Public data sources

| Source | Use | Acquisition |
| --- | --- | --- |
| [European Parliament Open Data API v2](https://data.europarl.europa.eu/en/developer-corner/opendata-api) | Current MEPs, memberships, activities, questions, answers, speech text, agendas, procedures and named votes | Anonymous JSON-LD, Atom and XML requests to `data.europarl.europa.eu/api/v2` |
| [Parliament’s public website](https://www.europarl.europa.eu/) | Portraits, published activity RSS and original document links | Validated official portrait and RSS paths; document downloads only from API-supplied official distributions |
| [Legislative Observatory](https://oeil.europarl.europa.eu/oeil/en/find-out-more) | Dossier stages and document summaries | Anonymous HTML parsing of exact procedure-file and document-summary pages; English and French where supplied |
| [Publications Office knowledge graph](https://op.europa.eu/en/web/cellar/cellar-data/metadata/knowledge-graph) | EuroVoc concepts, country terminology and legislative topic timelines | Anonymous SPARQL GET to `publications.europa.eu/webapi/rdf/sparql` |
| [Parliament Multimedia Centre](https://multimedia.europarl.europa.eu/) | Recording identity, coverage and official embeds | Anonymous public-site recording metadata, with a separately retained public-source recording catalogue |
| [Parliament’s published player](https://webstreaming.europarl.europa.eu/) | Available interpretation tracks and playback | Public player metadata and the official iframe, created only after Play |

## Licences and attribution

| Material | Terms | Basis |
| --- | --- | --- |
| Open Data API records | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/); CC0 may apply to raw data and metadata | Article 4 of the Bureau decision on Parliament’s open data, [OJ C/2025/341](https://eur-lex.europa.eu/eli/C/2025/341/oj) |
| Website text, portraits, OEIL summaries, documents and recordings | Reuse allowed with the source acknowledged; third-party items keep their own rights | Parliament’s [legal notice](https://www.europarl.europa.eu/legal-notice/en/); no separate licence is published for these items |
| EuroVoc and country terminology | Commission reuse policy, which adopts CC BY 4.0 | [Decision 2011/833/EU](https://eur-lex.europa.eu/eli/dec/2011/833/oj) |

Every page shows a short notice (`src/components/DataNotice.tsx`) with the attribution “© European Union – Source: European Parliament”, the licence, a statement that the site is independent and that its counts and charts are derived, and a pointer to check the original and its terms before reuse. Material is linked or embedded from its official source rather than redistributed. A public URL does not give this application additional redistribution rights, and the Parliament’s name and logo are not used as a brand.

## Transparent website processing

Portraits use only the public `https://www.europarl.europa.eu/mepphoto/{photo-id}.jpg` URL supplied by the exact member profile (or its existing member-ID fallback). They are fetched anonymously on demand, with redirects disabled. With `ODP_CACHE_DIR` configured, each saved binary record retains the exact member ID, source URL, retrieval timestamp, MIME type and a SHA-256 integrity checksum. Portraits have no language variant. Saved images are fresh for seven days; an expired image remains visible during refresh or if that refresh fails. At most two background refreshes run at once, with 120 queued member IDs; overflow remains stale until a later request can schedule it. Refresh profile reads use the shared upstream queue's background priority, leaving capacity for interactive text requests. Failures back off for five minutes and never become empty image records. The cache retains at most 128 MiB including record metadata and 2,048 records; it prunes by oldest save time and does not download the roster in advance. Each download is bounded to 2 MiB while streaming. The browser's existing six-hour private cache remains in place. Cached portraits stay outside Git and retain the source website's image terms.

OEIL summaries are parsed from visible HTML, linked through the exact procedure reference returned by the API. The adapter records the source page, retrieval date, language and summary stage. It does not invent a summary when none is supplied.

Parliamentary documents are read from official distributions linked by the Open Data API. DOCX is processed locally with bounded decompression; there is no document conversion service. Speaker headers, cover pages and document bodies remain distinguishable.

The public Multimedia Centre site uses `https://api.multimedia.europarl.europa.eu/o/epmp-frontend-rest/v1.0/media/{recording-id}`. The official player uses `wss://websockets.services.eup.glcloud.eu/content-manager/api/v1/socket.io/?EIO=4&transport=websocket`, namespace `/content`, event `join:event`, with the recording’s public `commonId`. These interfaces are exposed by the public website and are undocumented. The adapter sends no password, cookie, authorization header or forged Origin. It accepts only `PUBLISHED` content matching the recording identity and times.

The client verifies the requested audio representation before playback. Missing, ambiguous or mismatched tracks leave the player closed. The adapter downloads metadata, not video segments or an audiovisual archive. Automatic recording-catalogue search is unavailable; a catalogue needs source-page URLs and retrieval dates. Missing catalogue coverage is shown explicitly.

## Derived views

Analysis periods in questions, topic timelines and MEP speech clouds include **Current term**, from 16 July 2024 through today (Europe/Brussels), or through the chosen Until date where available. Numeric API windows may span any number of days within that term; there is no fixed 365-day maximum. Both boundaries are inclusive. Shorter presets remain available.

The [official API specification](https://data.europarl.europa.eu/api/v2) documents speech start/end dates and parliamentary-term selection without a 365-day span restriction. An anonymous, one-record check on 15 October 2026 spanning 16 July 2024–15 October 2026 returned a speech dated 16 September 2024; exact request and identifier are retained in [date-range-check.json](date-range-check.json). Questions and procedure timelines filter the existing saved index; selecting a wider period does not start a corpus download. Existing record, text and paging budgets remain, with truncated or incomplete coverage labelled separately from the date range.

Question topics use titles and bounded already-cached English bodies. Repeated phrases remain together; routine parliamentary terms are filtered. Counts deduplicate questions and co-authors. Country vocabulary comparisons use the same question selection and retain coverage and sample-size limits.

Speech clouds use supplied body text in the selected language. Counts describe distinct speeches mentioning a term; a single-speech cloud uses occurrences. Clicking a term opens exact source IDs and highlights literal whole words or phrases without rewriting the text. Machine translations are labelled. Absent translations are not generated.

Plenary participation uses actual named voters and exact speech-parent links. Unavailable observations are null rather than fabricated zeroes. Whole-sitting pagination compares unique IDs with declared totals and reports partial coverage for overlaps or missing records.

MEP motion cards show the final outcome for the exact motion document, using the anonymous `/plenary-documents/{id}`, `/meetings/{sitting-id}/vote-results` and `/meetings/{sitting-id}/decisions` API routes. Saved document projections retain `inverse_based_on_a_realization_of` links to vote results or voting agenda items, and joint motions' `is_derivative_of` links to their source motions. A decision must belong to the linked vote result and explicitly identify the same B10 or RC-B10 reference in its English heading/reference. Only whole-motion decisions or standalone document outcomes qualify; amendment and procedural decisions do not supply a motion's result. Every declared decision child of that result must be present before an outcome is assigned. Conflicting final decisions and missing records remain unavailable.

Outcome requests include every voting method and use `filter-output=voters` to omit named voter lists. Show-of-hands decisions can supply an adopted/rejected outcome without numerical totals; absent counts remain null. Original and joint texts are resolved independently, and related joint motions are linked only through `is_derivative_of`. Each outcome retains the exact document/decision IDs, source request URLs, retrieval dates and the English reference language used for matching. The bounded example in `server/fixtures/motion-outcomes-live-20261015.json` retains the 8 October 2026 sitting's outcome relationships and excludes named voters and unrelated graph nodes.

The existing activity-index writer acquires these records through its shared request queue, once per sitting for all authors. Loading a profile performs no vote-source request. Recent sittings refresh after six hours and older sittings after seven days when the daily job runs; recent motions without vote links are checked again after a day. An upgrade refreshes older motion projections without resetting the index or its page cursors. Failed refreshes retain the published generation and saved outcomes. Source gaps remain distinct from a motion being rejected or awaiting a vote.

## Saved examples and supporting data

`server/fixtures` contains bounded public API responses and public OEIL HTML for tests. Each example retains source attribution or provenance. Public API records can contain identifiers named `notation_codictPersonId` or similar; these are fields returned by the open API, not calls to another service.

Committee labels come from the public corporate-bodies API. Country terminology comes from the Publications Office’s public authority scheme. Map geometry is Natural Earth public-domain data, simplified locally; it makes no runtime map request. Word filtering uses MIT-licensed stopword lists and app-owned parliamentary exclusions.

Production caches, activity databases, recording catalogues, user following lists and private hosting configuration are not included in the repository.

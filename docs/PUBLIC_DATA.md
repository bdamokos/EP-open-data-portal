# Public data sources

| Source | Use | Acquisition |
| --- | --- | --- |
| [European Parliament Open Data API v2](https://data.europarl.europa.eu/en/developer-corner/opendata-api) | Current MEPs, memberships, activities, questions, answers, speech text, agendas, procedures and named votes | Anonymous JSON-LD, Atom and XML requests to `data.europarl.europa.eu/api/v2` |
| [Parliament’s public website](https://www.europarl.europa.eu/) | Portraits, published activity RSS and original document links | Validated official portrait and RSS paths; document downloads only from API-supplied official distributions |
| [Legislative Observatory](https://oeil.europarl.europa.eu/oeil/en/find-out-more) | Dossier stages and document summaries | Anonymous HTML parsing of exact procedure-file and document-summary pages; English and French where supplied |
| [Publications Office knowledge graph](https://op.europa.eu/en/web/cellar/cellar-data/metadata/knowledge-graph) | EuroVoc concepts, country terminology and legislative topic timelines | Anonymous SPARQL GET to `publications.europa.eu/webapi/rdf/sparql` |
| [Parliament Multimedia Centre](https://multimedia.europarl.europa.eu/) | Recording identity, coverage and official embeds | Anonymous public-site recording metadata, with a separately retained public-source recording catalogue |
| [Parliament’s published player](https://webstreaming.europarl.europa.eu/) | Available interpretation tracks and playback | Public player metadata and the official iframe, created only after Play |

The Open Data API uses [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/); attribution is retained. Website text, images and recordings have their own institutional terms. A public URL does not give this application additional redistribution rights.

## Transparent website processing

Portraits use only the public `https://www.europarl.europa.eu/mepphoto/{photo-id}.jpg` URL supplied by the exact member profile (or its existing member-ID fallback). They are fetched anonymously on demand, with redirects disabled. With `ODP_CACHE_DIR` configured, each saved binary record retains the exact member ID, source URL, retrieval timestamp, MIME type and a SHA-256 integrity checksum. Portraits have no language variant. Saved images are fresh for seven days; an expired image remains visible while one background refresh runs and if that refresh fails. Failures back off for five minutes and never become empty image records. The cache retains at most 128 MiB including record metadata and 2,048 records; it prunes by oldest save time and does not download the roster in advance. Each download is bounded to 2 MiB while streaming. The browser's existing six-hour private cache remains in place. Cached portraits stay outside Git and retain the source website's image terms.

OEIL summaries are parsed from visible HTML, linked through the exact procedure reference returned by the API. The adapter records the source page, retrieval date, language and summary stage. It does not invent a summary when none is supplied.

Parliamentary documents are read from official distributions linked by the Open Data API. DOCX is processed locally with bounded decompression; there is no document conversion service. Speaker headers, cover pages and document bodies remain distinguishable.

The public Multimedia Centre site uses `https://api.multimedia.europarl.europa.eu/o/epmp-frontend-rest/v1.0/media/{recording-id}`. The official player uses `wss://websockets.services.eup.glcloud.eu/content-manager/api/v1/socket.io/?EIO=4&transport=websocket`, namespace `/content`, event `join:event`, with the recording’s public `commonId`. These interfaces are exposed by the public website and are undocumented. The adapter sends no password, cookie, authorization header or forged Origin. It accepts only `PUBLISHED` content matching the recording identity and times.

The client verifies the requested audio representation before playback. Missing, ambiguous or mismatched tracks leave the player closed. The adapter downloads metadata, not video segments or an audiovisual archive. Automatic recording-catalogue search is unavailable; a catalogue needs source-page URLs and retrieval dates. Missing catalogue coverage is shown explicitly.

## Derived views

Question topics use titles and bounded already-cached English bodies. Repeated phrases remain together; routine parliamentary terms are filtered. Counts deduplicate questions and co-authors. Country vocabulary comparisons use the same question selection and retain coverage and sample-size limits.

Speech clouds use supplied body text in the selected language. Counts describe distinct speeches mentioning a term; a single-speech cloud uses occurrences. Clicking a term opens exact source IDs and highlights literal whole words or phrases without rewriting the text. Machine translations are labelled. Absent translations are not generated.

Plenary participation uses actual named voters and exact speech-parent links. Unavailable observations are null rather than fabricated zeroes. Whole-sitting pagination compares unique IDs with declared totals and reports partial coverage for overlaps or missing records.

## Saved examples and supporting data

`server/fixtures` contains bounded public API responses and public OEIL HTML for tests. Each example retains source attribution or provenance. Public API records can contain identifiers named `notation_codictPersonId` or similar; these are fields returned by the open API, not calls to another service.

Committee labels come from the public corporate-bodies API. Country terminology comes from the Publications Office’s public authority scheme. Map geometry is Natural Earth public-domain data, simplified locally; it makes no runtime map request. Word filtering uses MIT-licensed stopword lists and app-owned parliamentary exclusions.

Production caches, activity databases, recording catalogues, user following lists and private hosting configuration are not included in the repository.

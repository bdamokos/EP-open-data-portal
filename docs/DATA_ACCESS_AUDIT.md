# Data access audit

The standalone application has no credential-dependent parliamentary data adapter. All external information reads use the public sources listed in [Public data sources](PUBLIC_DATA.md).

The extraction excludes authenticated CODICT SOAP access, CMS database exports and their fallback rosters/profiles/news, NewsHub integration, local exhibition media, and the UDP display bridge. Their configuration, credentials, export scripts, routes, assets and dependencies are absent. The frontend has one application entry and no link to another application.

The API exposes read-only explorer routes. Requests cannot select an arbitrary upstream host. The adapter constructs fixed official endpoints and validates document, recording, portrait and source identities. Outgoing requests set content negotiation and a user agent; they do not forward the caller’s cookies or authorization. Configuration contains local server, cache and index settings, without external service credentials.

Anonymous checks on 15 October 2026 returned public content from the MEP API, OEIL procedure and first-reading summary pages, Publications Office SPARQL, Multimedia Centre recording metadata and the published player code. The public player’s metadata connection returned a matching `PUBLISHED` recording and its language map without authentication. These checks establish access to the sampled records; they do not promise permanent endpoint availability or complete archives. The machine-readable dated observations are in `public-source-checks.json`.

Generic interface labels are app-owned; country and language display names use the browser’s internationalization data. Portrait and favicon fallbacks are app-owned SVGs. The application uses system fonts and carries no inherited institutional font binaries or copied dataset assets.

No production cache or database was copied into the initial repository. Git history starts with the standalone source. Hosting access controls and private Git authentication are separate from parliamentary data acquisition and remain outside source control.

`npm test` checks the read-only routing boundary, allowed configuration and absence of authenticated data adapters. Future sources must document their public acquisition path here before being added. Failed public access must remain a reported gap; it must not trigger use of internal credentials or protection bypasses.

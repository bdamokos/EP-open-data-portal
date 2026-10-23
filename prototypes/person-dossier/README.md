# Person on a dossier prototype

An isolated, static proposal. It does not add application routes, APIs or following storage. The same person scope is reachable from a dossier participant list and a member’s Dossiers section. Press remains dossier context. Following belongs to the full dossier and is reserved for the following feature.

The builder reads public API observation envelopes (`url`, `fetchedAt`, `payload` or `error`) and API-linked DOCX files from an external directory. Exact procedure, document, agenda, participation and decision identifiers establish relationships. Amendment proposers reuse the existing full-name and dated-mandate resolver. Exact procedure tabling events date amendment entries; DOCX and API document dates remain separate, with discrepancies visible. A missing or conflicting tabling date never becomes a tabling claim. Role activity dates remain recorded-role dates; document dates never establish appointments. Votes preserve unavailable positions and separate declared intentions from recorded choices. Joint-debate speeches retain that scope.

Integration should reuse `FollowDossierButton`, the canonical-reference identity and `dossierHref` from the dossier-following feature. Following and update acknowledgements remain dossier-wide when a person is selected; the preview creates no competing persistent store.

```sh
npm ci
node prototypes/person-dossier/build.mjs /tmp/public-observations /tmp/person-dossier-site
node --test prototypes/person-dossier/model.test.mjs
```

The bounded examples use procedures `2025-0176`, `2025-0407` and `2025-0233`. Keep source observations, generated HTML/data, screenshots and review notes outside Git. The public-source rules in `docs/PUBLIC_DATA.md` apply. The builder makes no network requests and starts no source or index writer.

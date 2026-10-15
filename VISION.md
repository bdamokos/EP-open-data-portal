# Project vision

Parliament explorer is a proof-of-concept application for discovering what becomes possible when open data from different domains is brought together. Its starting point is the European Parliament’s existing open data APIs: connecting people, questions, speeches, votes, documents and legislative procedures to uncover new insights and engaging ways to explore them.

The aim is to have fun, experiment and make data that can feel dry or difficult to navigate accessible and interesting. Exploring the activity of Members of the European Parliament is a way into understanding the work of Parliament and, more broadly, the European Union.

## Explore connections

The application should test new and unusual ways of presenting data, helping people follow their curiosity from one record to another. Experiments might connect a member’s questions and speeches around a topic, trace a legislative dossier through its participants and stages, or show how themes develop over time. These are directions to explore, rather than a fixed feature list.

Other open APIs can enrich parliamentary data and reveal connections across domains. Each connection must have a documented basis: exact identifiers, explicit source links or a relationship established in a public source. Similar titles, names or vote totals alone are insufficient to establish that two records correspond.

## Process public data into useful forms

Server-based processing is part of the approach. Data and documents received from public APIs may need parsing, extraction, conversion or indexing before they become useful for exploration. This can include turning difficult-to-read PDFs, XML files and other published documents into searchable text or structured formats.

Derived data should remain traceable to its sources. Preserve source identifiers, URLs, retrieval dates and languages, and explain the transformations used. Show gaps and incomplete coverage explicitly; an unavailable observation must remain distinct from zero.

## Use scraping deliberately to close gaps

APIs are the preferred source. In limited cases, deliberate scraping of publicly accessible websites can fill a gap where an API is absent or omits a needed relationship. For example, establishing the correspondence between item A and item B may require reading a public webpage that explicitly links them. That relationship can be extracted and retained with its source.

Scraping must collect only public information and use ordinary public access. It must never bypass authentication, access controls or other security protections, or undermine the security of EU websites. Authenticated institutional services, private exports and internal credentials are outside the project’s data sources. Failed public access remains a reported gap.

Document each external source and its acquisition and processing method in [Public data sources](docs/PUBLIC_DATA.md), and keep the [Data access audit](docs/DATA_ACCESS_AUDIT.md) accurate as the application evolves.

## Phase two: AI enrichment

A later phase may explore local or publicly available AI models to further analyse and enrich the public data. The initial proof of concept focuses on discovering useful connections and presentation ideas through APIs and transparent data processing. AI enrichment belongs to phase two, with any model-derived analysis clearly distinguished from source facts and linked back to the underlying material.

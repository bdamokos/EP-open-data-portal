// Keep each held snapshot's provenance; title matching still uses its English source.
export function countryLabelSourceFor(snapshot){
 return {url:snapshot.sourceUrl,scheme:snapshot.scheme,fetchedAt:snapshot.fetchedAt,...(snapshot.version?{version:snapshot.version}:{}),count:Array.isArray(snapshot.labels)?snapshot.labels.length:Object.keys(snapshot.labels).length};
}

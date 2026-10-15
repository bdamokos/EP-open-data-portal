// Resolve identifiers from accepted publication deep links. This supplies a
// source ID only: rapporteur/shadow and institutional/individual roles still
// come from API evidence, never the GUID prefix.
export function activitySourceId(value) {
  const raw=String(value || '');
  if(raw.length>250)return null;
  const speech=raw.match(/CRE-(\d+)-(\d{4}-\d{2}-\d{2})-(?:INT|OTH)-(\d+)/);
  if(speech)return `MTG-PL-${speech[2]}-OTH-${speech[3]}`;
  const video=raw.match(/^VD-ORAPL_(\d+)_(\d{4})(\d{2})(\d{2})\d{4}(?:_[A-Z]{2})?$/);
  if(video)return `MTG-PL-${video[2]}-${video[3]}-${video[4]}-OTH-${video[1]}`;
  const stable=raw.includes(':')?raw.split(':').at(-1):raw;
  if(/^MTG-PL-\d{4}-\d{2}-\d{2}-OTH-\d+$/.test(stable))return stable;
  const match=stable.match(/^(?:[A-Z][A-Z0-9-]*_)?((?:[A-Z]+-\d+-\d{4}-\d+(?:-ASW)?|[A-Z]{3,5}-(?:AD|AL|AM|PA|PR)-\d+(?:-\d+)*))(?:_[A-Z]{2})?$/);
  return match?.[1] || null;
}

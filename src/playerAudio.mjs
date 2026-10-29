export function validAudioMapping(mapping) {
  if (mapping?.schemaVersion !== 1 || !Array.isArray(mapping.channels) || !mapping.channels.length || mapping.channels.length > 32) return false;
  const slots=new Set(), codes=new Set(), languages=new Set();
  return mapping.channels.every(c => {
    if (!Number.isInteger(c.slot) || c.slot < 0 || c.slot >= 32 || !/^[a-z]{2}$/.test(c.language) || !/^q[a-z]{2}$/.test(c.providerCode) || slots.has(c.slot) || codes.has(c.providerCode) || languages.has(c.language)) return false;
    slots.add(c.slot);codes.add(c.providerCode);languages.add(c.language);return true;
  });
}

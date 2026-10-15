// Use the EU country identifier in shared filters; the directory uses ISO GR.
export const filterCountry = code => code === 'GR' ? 'EL' : code || '';
export const matchesCountry = (selected, memberCountry) => !selected || filterCountry(selected) === filterCountry(memberCountry);

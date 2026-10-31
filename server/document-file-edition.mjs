export function documentFileEdition(manifestation) {
  const size=manifestation?.byteSize,issued=manifestation?.issued;
  return {byteSize:(typeof size==='number'||typeof size==='string'&&/^\d+$/.test(size))&&Number.isSafeInteger(Number(size))&&Number(size)>=0?Number(size):null,
    issued:typeof issued==='string'&&Number.isFinite(Date.parse(issued))?issued:null};
}

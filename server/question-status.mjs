// Add display metadata from already-saved question records, without reindexing.
export function questionStatuses(store,page) {
  const rows=[...page.items,...page.selectedItems];
  const keys=[...new Set(rows.filter(row=>row.recordKind!=='answer'&&['written-questions','oral-questions'].includes(row.category)).map(row=>'/parliamentary-questions/'+row.sourceId))];
  if(!keys.length)return page;
  const records=new Map(store.db.prepare(`SELECT key,body,fetched_at FROM sources WHERE generation=? AND kind='document' AND key IN (${keys.map(()=>'?').join(',')})`).all(store.status().servingGeneration,...keys).map(row=>[row.key,row]));
  function present(row) {
    const record=records.get('/parliamentary-questions/'+row.sourceId);
    if(!record)return row;
    const work=JSON.parse(record.body);
    if(work.identifier!==row.sourceId||!Array.isArray(work.inverse_answers_to))return row;
    const answers=work.inverse_answers_to.map(answer=>answer.identifier||String(answer.id||'').split('/').at(-1)).filter(id=>/^[A-Z0-9-]{1,100}$/.test(id||''));
    if(work.inverse_answers_to.length&&!answers.length)return row;
    return {...row,answerStatus:answers.length?'answered':'awaiting',answerIds:[...new Set(answers)],answerSourceDate:record.fetched_at};
  }
  return {...page,items:page.items.map(present),selectedItems:page.selectedItems.map(present)};
}

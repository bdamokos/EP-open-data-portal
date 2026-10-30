import test from 'node:test';
import assert from 'node:assert/strict';
import {amendmentJustification} from './amendmentJustification.mjs';

test('retained justifications cannot cross source editions or languages',()=>{
  const source={url:'https://data.europarl.europa.eu/list_en.docx',language:'en'};
  const row={language:'en',justification:'First paragraph.\nSecond paragraph.',metadataSource:source};
  assert.equal(amendmentJustification(row).text,row.justification);
  assert.equal(amendmentJustification({...row,fieldSources:{justification:{...source,fetchedAt:'2026-10-16'}}}).language,'en');
  assert.equal(amendmentJustification({...row,language:'fr'}),null);
  assert.equal(amendmentJustification({...row,wordingSource:{...source,language:'fr'}}),null);
  assert.equal(amendmentJustification({...row,listId:'A-10-2026-0254-AM-041-042',metadataSource:{...source,url:'https://data.europarl.europa.eu/distribution/A-10-2026-0254-AM-040-040_en.docx'}}),null);
  assert.equal(amendmentJustification({...row,fieldSources:{justification:null}}),null);
  assert.equal(amendmentJustification({...row,fieldSources:{justification:{...source,url:'https://data.europarl.europa.eu/other-list_en.docx'}}}),null);
  assert.equal(amendmentJustification({...row,metadataSource:{...source,language:null}}).language,null);
  for(const justification of [undefined,null,'',' \n\t '])assert.equal(amendmentJustification({...row,justification}),null);
});

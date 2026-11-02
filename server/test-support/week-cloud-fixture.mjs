import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {CorpusStore} from '../corpus-store.mjs';
import {ActivityStore} from '../activity-index-store.mjs';
import {speechTexts} from '../corpus-worker.mjs';
export function weekCloudFixture(count=1000) {
  const directory=mkdtempSync(path.join(tmpdir(),'week-cloud-')),clock=()=>Date.parse('2026-11-02T09:00:00Z');
  const index=new ActivityStore(path.join(directory,'index'),{clock});index.acquire();index.beginCycle();index.setMembers([{id:'42',name:'Fixture Speaker'}]);
  const store=new CorpusStore(path.join(directory,'corpus'),{clock,indexFile:index.filename});store.acquire();store.db.exec('PRAGMA synchronous=OFF');
  const add=(n,language='en')=>{
    const date='2026-10-'+(19+n%4),id=`MTG-PL-${date}-OTH-${n}`;
    const body='Climate water energy nature protection. '+('Clean Water Act provides energy security for citizens. '.repeat(20))+n;
    const activity={activity_id:id,id:'eli/dl/event/'+id,activity_date:date,had_activity_type:'def/ep-activities/PLENARY_DEBATE_SPEECH',activity_label:{en:'Clean Water Act'},had_participation:[{had_participant_person:['person/42']}],recorded_in_a_realization_of:[{numbering:n,'api:xmlFragment':{[language]:`<oralStatements><speech xml:lang="${language}"><from><person refersTo="person/42">Fixture Speaker</person></from><p>${body}</p></speech></oralStatements>`}}]};
    const url='https://data.europarl.europa.eu/api/v2/speeches',at=new Date(clock()).toISOString(),text=speechTexts(activity,url,at);
    store.putDocument(text.document,text.texts);store.putSpeechMetadata(activity,url,at);return id;
  };
  for(let n=0;n<count;n++)add(n);
  return {store,index,add,directory,clock,dates:['2026-10-19','2026-10-20','2026-10-21','2026-10-22'],close(){store.close();index.close();rmSync(directory,{recursive:true,force:true});}};
}

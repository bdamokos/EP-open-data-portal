import {UiMessage,useUiI18n} from './UiI18nReact';
import {RecordMemberAffiliation} from './components/RecordMemberAffiliation';
import {PersonName,usePersonName} from './PersonName';
import {humanDate,insightMemberHref,roleName} from './InsightShared';
import {useExplorerParam} from './explorerUrl';
import {dossierHref,dossierPeopleCounts,dossierPeopleRows,dossierPeopleSegments,dossierPersonGroup,dossierRoleLines,fullDossierReference} from './dossierActivityModel.mjs';
import {dossierLinkClick} from './dossierJourney';
import type {DossierActivityResponse,DossierParticipant,DossierReference} from './DossierActivityTypes';
import './DossierPeople.css';

type Segment=typeof dossierPeopleSegments[number];
type StageName='committee'|'plenary';
const stageLabel=(stage:StageName,ui:ReturnType<typeof useUiI18n>)=>ui.t((stage==='committee') ? 'dossieractivity.committee' : 'dossieractivity.plenary').toLocaleLowerCase(ui.locale);

export function DossierAmendmentLinks({references,person,language='en',stage,count,complete=false}:{references:Pick<DossierReference,'id'|'reference'>[];person:string|number;language?:string;stage:StageName;count:number;complete?:boolean}) {
  const ui = useUiI18n();
  const exact=references.filter(row=>fullDossierReference(row.reference));
  const stageName=stageLabel(stage,ui);
  const content=<UiMessage id={complete ? 'dossieractivity.exact_stage_amendments' : 'dossieractivity.count_stage_amendments'} values={{count,stage:stageName}}/>;
  const accessible=ui.t(complete ? 'dossieractivity.exact_stage_amendments' : 'dossieractivity.at_least_count_stage_amendments',{count,stage:stageName});
  const link=(row:typeof exact[number])=><a key={row.reference} aria-label={(exact.length>1) ? ui.t("dossieractivity.stage_amendments_reference", {stage: String(((stage==='committee') ? ui.t("dossieractivity.committee") : ui.t("dossieractivity.plenary"))), reference: String(row.reference)}) : accessible} href={dossierHref(row.reference,person,language,location.href,{section:'amendments',stage})} onClick={dossierLinkClick}>{(exact.length>1) ? row.reference : content}</a>;
  return <span className="dossier-amendment-links">{(exact.length===1) ? link(exact[0]) : ((exact.length>1) ? <details><summary aria-label={accessible}><UiMessage id="dossieractivity.count_stage_amendments_choose_a_procedure" values={{count,stage:stageName}}/></summary>{exact.map(link)}</details> : <span aria-label={accessible}>{content}</span>)}</span>;
}

function PersonAmendments({person,reference,procedureId,language,complete}:{person:DossierParticipant;reference:string;procedureId:string;language:string;complete?:DossierActivityResponse['amendmentCountComplete']}) {
  const ui = useUiI18n();
  const counts=(['committee','plenary'] as const).flatMap(stage=>{const count=person.amendmentCounts?.[stage];return count ? [{stage,count,exact:complete?.[stage]===true}] : [];});
  if(counts.length===1)return <DossierAmendmentLinks references={[{id:procedureId,reference}]} person={person.id} language={language} stage={counts[0].stage} count={counts[0].count} complete={counts[0].exact}/>;
  if(!counts.length)return null;
  const [committee,plenary]=counts.map(({stage,count,exact})=><a key={stage} aria-label={ui.t(exact ? 'dossieractivity.exact_stage_amendments' : 'dossieractivity.at_least_count_stage_amendments',{count,stage:stageLabel(stage,ui)})} href={dossierHref(reference,person.id,language,location.href,{section:'amendments',stage})} onClick={dossierLinkClick}><UiMessage id={exact ? 'dossierpeople.stage_count' : 'dossierpeople.stage_count_more'} values={{count,stage:stageLabel(stage,ui)}}/></a>);
  return <span className="dossier-amendment-links"><UiMessage id="dossierpeople.amendments_both" values={{committee,plenary}}/></span>;
}

export function DossierPeople({participants,reference,procedureId,language,complete,showCount=true}:{participants:DossierParticipant[];reference:string;procedureId:string;language:string;complete?:DossierActivityResponse['amendmentCountComplete'];showCount?:boolean}) {
  const ui = useUiI18n(),displayName=usePersonName();
  const [chosen,setSegment]=useExplorerParam<Segment>('dossier-people','lead',dossierPeopleSegments);
  const counts=dossierPeopleCounts(participants);
  // A file with no lead roles yet opens on everyone rather than on an empty list.
  const segment=(chosen==='lead'&&!counts.segments.lead) ? 'all' : chosen;
  const rows=dossierPeopleRows(participants,segment,(person:DossierParticipant)=>displayName(person.id,person.name));
  return <div className="dossier-people">
    {showCount&&<p className="dossier-people-count"><UiMessage id="dossierpeople.count_line" values={{count:counts.total,roles:counts.withRole,others:counts.withoutRole}} counts={{count:counts.total}}/></p>}
    <div className="insight-chart-switch dossier-people-segments" role="group" aria-label={ui.t('dossierpeople.segments')}>{dossierPeopleSegments.map(value=><button type="button" key={value} aria-pressed={segment===value} onClick={()=>setSegment(value)}><UiMessage id={'dossierpeople.segment_'+value} values={{count:counts.segments[value]}}/></button>)}</div>
    {rows.length ? <table className="dossier-people-table"><thead><tr><th scope="col"><UiMessage id="dossierpeople.name"/></th><th scope="col"><UiMessage id="dossierpeople.role"/></th><th scope="col"><UiMessage id="legislation.amendments.900866"/></th><th scope="col"><UiMessage id="dossieractivity.speeches"/></th><th scope="col" aria-label={ui.t('dossieractivity.work_on_this_dossier')}/></tr></thead>
      <tbody>{rows.map(person=>{
        const speeches=person.speeches?.length||0,amendments=(person.amendmentCounts?.committee||0)+(person.amendmentCounts?.plenary||0);
        return <tr key={person.id} data-has-counts={(speeches>0||amendments>0) ? 'true' : undefined}>
          <th scope="row"><a href={insightMemberHref(person.id,language)} onClick={dossierLinkClick}><PersonName id={person.id} label={person.name} fallback={ui.t('insightshared.name_unavailable')}/></a><RecordMemberAffiliation id={person.id} datedGroup={dossierPersonGroup(person)} language={language}/></th>
          <td className="dossier-people-roles">{dossierRoleLines(person.roles).map(role=><span key={role.id}>{[roleName(role.role,ui),role.committee,role.date&&humanDate(role.date,language),role.dateBasis==='document'&&role.date&&ui.t('dossieractivity.document_date'),role.stage&&(({RDG1:ui.t('dossieractivity.first_reading'),RDG2:ui.t('dossieractivity.second_reading'),RDG3:ui.t('dossieractivity.third_reading')} as Record<string,string>)[role.stage]||role.stage)].filter(Boolean).join(' · ')}</span>)}</td>
          <td className="dossier-people-amendments">{amendments>0&&<PersonAmendments person={person} reference={reference} procedureId={procedureId} language={language} complete={complete}/>}</td>
          <td className="dossier-people-speeches">{speeches>0&&<a href={dossierHref(reference,person.id,language,location.href,{section:'speeches'})} onClick={dossierLinkClick}><UiMessage id="dossierpeople.speeches" values={{count:speeches}} counts={{count:speeches}}/></a>}</td>
          <td className="dossier-people-work"><a href={dossierHref(reference,person.id,language)} onClick={dossierLinkClick}><UiMessage id="dossieractivity.work_on_this_dossier"/></a></td>
        </tr>;
      })}</tbody></table> : <p><UiMessage id="dossieractivity.no_linked_records"/></p>}
    {segment!=='all'&&<button type="button" className="dossier-people-all" onClick={()=>setSegment('all')}><UiMessage id="dossierpeople.show_all" values={{count:counts.total}}/></button>}
  </div>;
}

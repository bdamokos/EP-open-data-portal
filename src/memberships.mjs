import {defaultUi} from './uiDefault.mjs';
// Official committee-list order: standing committees, subcommittees, special committees.
// https://www.europarl.europa.eu/committees/en/documents/search
export const committeeOrder='AFET SEDE DEVE INTA BUDG CONT ECON EMPL ENVI SANT ITRE IMCO TRAN REGI AGRI PECH CULT JURI LIBE AFCO FEMM PETI DROI FISC EUDS HOUS'.split(' ');
const ranks={CHAIR:0,CHAIR_VICE:1,VICE_CHAIR:1,MEMBER:2,MEMBER_SUBSTITUTE:3};
export function orderedMemberships(memberships=[],committees=[]) {
  const bodies=new Map(committees.map(body=>[body.id,body]));
  const order=id=>{const i=committeeOrder.indexOf(bodies.get(id)?.code);return i<0?999:i;};
  return memberships.filter(m=>m.current&&bodies.has(m.id)).sort((a,b)=>(ranks[a.role]??4)-(ranks[b.role]??4)||order(a.id)-order(b.id)||a.id.localeCompare(b.id));
}
export const ongoingLabels={en:'Present',bg:'до момента',cs:'dosud',da:'nu',de:'heute',el:'σήμερα',es:'actualidad',et:'praeguseni',fi:'nykyhetki',fr:'à ce jour',ga:'go dtí seo',hr:'danas',hu:'jelenleg',it:'oggi',lt:'iki dabar',lv:'pašlaik',mt:'sal-lum',nl:'heden',pl:'obecnie',pt:'presente',ro:'prezent',sk:'doteraz',sl:'danes',sv:'nu'};
export const ongoingLabelsUi = (ui = defaultUi) => ({en:ui.t("memberships.mjs.present"),bg:'до момента',cs:'dosud',da:'nu',de:'heute',el:'σήμερα',es:'actualidad',et:'praeguseni',fi:'nykyhetki',fr:'à ce jour',ga:'go dtí seo',hr:'danas',hu:'jelenleg',it:'oggi',lt:'iki dabar',lv:'pašlaik',mt:'sal-lum',nl:'heden',pl:'obecnie',pt:'presente',ro:'prezent',sk:'doteraz',sl:'danes',sv:'nu'});

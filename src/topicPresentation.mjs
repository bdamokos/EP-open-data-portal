const euPlaces=new Set('AUT BEL BGR HRV CYP CZE DNK EST FIN FRA DEU GRC HUN IRL ITA LVA LTU LUX MLT NLD POL PRT ROU SVK SVN ESP SWE'.split(' '));
export const isEuPlace=iso3=>euPlaces.has(iso3);
export const agendaTitle=title=>String(title||'').replace(/^\d+(?:\.\d+)*\.\s+/,'');
export const point = (item, period) => item?.series?.find(s=>s.period===period) || {};
export const mapCode = iso3 => iso3==='1A0'?'KOS':iso3;
export const quarterBounds = period => {
 if(!/^\d{4}-Q[1-4]$/.test(period||''))return null;
 const year=Number(period.slice(0,4)),month=(Number(period.at(-1))-1)*3;
 return {from:new Date(Date.UTC(year,month,1)).toISOString().slice(0,10),to:new Date(Date.UTC(year,month+3,0)).toISOString().slice(0,10)};
};
export const partialQuarter=(period,partial)=>Boolean(period===partial?.first?.slice(0,4)+'-Q'+Math.ceil(Number(partial?.first?.slice(5,7))/3)||period===partial?.last?.slice(0,4)+'-Q'+Math.ceil(Number(partial?.last?.slice(5,7))/3));
export const lastFullQuarter=data=>[...data.periods].reverse().find(p=>!partialQuarter(p,data.partial))||data.periods[0];
export const placeValue=(s,mode='q',own=true)=>mode==='d'?(s.document||0):own?Math.max(0,(s.question||0)-(s.questionHome||0)):(s.question||0);
export function riser(data,index,mode,own){
 if(index<2||partialQuarter(data.periods[index],data.partial))return null;
 const earlier=data.periods.slice(0,index).filter(p=>!partialQuarter(p,data.partial));if(!earlier.length)return null;
 return data.items.map(item=>{const count=placeValue(point(item,data.periods[index]),mode,own),average=earlier.reduce((n,p)=>n+placeValue(point(item,p),mode,own),0)/earlier.length;return {item,count,ratio:count/Math.max(1,average)};}).filter(r=>r.count>=(mode==='d'?3:8)).sort((a,b)=>b.ratio-a.ratio||b.count-a.count||a.item.key.localeCompare(b.item.key))[0]||null;
}
const PRE=/^((?:SECOND )?REPORT|(?:JOINT )?MOTION FOR A RESOLUTION|RECOMMENDATION|OPINION)\s+(?:on\s+)?(?:the\s+proposal\s+for\s+an?\s+(?:regulation|directive|decision)(?:\s+of\s+the\s+European\s+Parliament\s+and\s+of\s+the\s+Council|\s+of\s+the\s+Council)?\s*)?/i;
export function titleParts(title,language){if(language!=='en')return ['',title];const m=title.match(PRE);let at=m?m[0].length:0;const ar=title.lastIndexOf(' as regards ');if(ar>at)at=ar+12;return [title.slice(0,at),title.slice(at)];}
export function topicsHref(key,filters={}){const q=new URLSearchParams({view:'topics'});q.set(key.startsWith('place:')?'place':'topic',key.replace(/^place:/,''));for(const [k,v] of Object.entries(filters))if(v)q.set(k,String(v));return '?'+q;}
export function legacyTopics(query){if(query.get('view')!=='legislation'||query.get('pl-mode')!=='trends')return null;const raw=query.get('trend-key')||query.get('trend-topic'),id=raw?.replace(/^https?:\/\/eurovoc\.europa\.eu\//,'').replace(/^eurovoc:/,'');return id&&/^(?:\d{1,8}|c_[A-Za-z0-9_]{1,40})$/.test(id)?topicsHref('eurovoc:'+id):'?view=topics';}

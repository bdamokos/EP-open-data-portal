import {XMLParser,XMLValidator} from 'fast-xml-parser';

// Parliament's press RSS feeds announce press releases. The feeds carry no
// procedure or document references, so each announced page is read once: its
// own “Further information” list may link the release's subject. Body text
// links are context mentions. Press-room listings are never crawled.
const WEBSITE='https://www.europarl.europa.eu';
export const PRESS_FEEDS=Object.freeze(['press-releases','press-releases-plenary','press-releases-committees'].map(id=>Object.freeze({id,url:`${WEBSITE}/rss/doc/${id}/en.xml`})));
const REFERENCE=/^\d{4}\/\d{4}[A-Z]?\([A-Z]{2,8}\)$/;
// Single-subject documents only; minutes, agendas and verbatim reports cover many files.
export const DOSSIER_DOCUMENT=/^(?:(?:A|B|RC|TA)-\d{1,2}-\d{4}-\d{4}|[A-Z]{4}-(?:PR|AD|AM|AL|PA)-\d{6}(?:-\d{1,3})?)$/;
const MAX_PAGE_BYTES=2*1024*1024;
const array=value=>value==null?[]:Array.isArray(value)?value:[value];
const text=value=>typeof value==='string'?value:String(value?.['#text']??'');
const named={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' ',rsquo:'’',lsquo:'‘',rdquo:'”',ldquo:'“',ndash:'–',mdash:'—',hellip:'…'};
export function decodeHtml(value) {
  return String(value).replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,8});/gi,(entity,name)=>{
    if(name[0]==='#'){const code=name[1]==='x'||name[1]==='X'?parseInt(name.slice(2),16):Number(name.slice(1));return code>0&&code<=0x10ffff?String.fromCodePoint(code):entity;}
    return named[name.toLowerCase()]??entity;
  });
}
const plain=html=>decodeHtml(String(html).replace(/<[^>]*>/g,' ')).replace(/\s+/g,' ').trim();
const attribute=(tag,name)=>{const match=tag.match(new RegExp(`\\s${name}\\s*=\\s*"([^"]*)"`,'i'));return match?decodeHtml(match[1]).trim():null;};
function websiteUrl(value) {
  let url;
  try{url=new URL(value,WEBSITE);}catch{return null;}
  return url.protocol==='https:'&&!url.username&&!url.password&&!url.port?url:null;
}

export const pressReleaseUrl=id=>`${WEBSITE}/news/en/press-room/${id}/`;
// The English page of a press release, identified by its exact path. Slugs are not identifiers.
export function pressReleaseIdentity(value) {
  const url=websiteUrl(value);
  const id=url?.hostname==='www.europarl.europa.eu'&&url.pathname.match(/^\/news\/en\/press-room\/(\d{8}IPR\d{5})(?:\/[^/]*)?$/)?.[1];
  return id?{id,url:pressReleaseUrl(id)}:null;
}
export function doceoDocument(value) {
  const url=websiteUrl(value);
  const id=url?.hostname==='www.europarl.europa.eu'&&url.pathname.match(/^\/doceo\/document\/([A-Z0-9-]{1,40})_[A-Z]{2}\.(?:html|pdf|docx)$/)?.[1];
  return id&&DOSSIER_DOCUMENT.test(id)?id:null;
}

export function parsePressFeed(xml) {
  if(/<!DOCTYPE|<!ENTITY/i.test(xml)||XMLValidator.validate(xml)!==true)throw new Error('Invalid press feed XML.');
  const root=new XMLParser({ignoreAttributes:false,parseTagValue:false}).parse(xml);
  if(!root.rss?.channel)throw new Error('Parliament returned an invalid press feed.');
  const seen=new Set();
  return array(root.rss.channel.item).flatMap(item=>{
    const identity=pressReleaseIdentity(text(item.link).trim()),published=Date.parse(text(item.pubDate));
    if(!identity||seen.has(identity.id))return [];
    seen.add(identity.id);
    const committees=array(item.category).filter(category=>category?.['@_domain']==='body').map(text).filter(code=>/^[A-Z]{4}$/.test(code));
    return [{...identity,title:decodeHtml(text(item.title)).replace(/^Press release - /,'').trim()||null,publishedAt:Number.isFinite(published)?new Date(published).toISOString():null,committees}];
  });
}

function robots(html) {
  const tag=[...html.matchAll(/<meta\s[^>]*>/gi)].map(match=>match[0]).find(tag=>/\sname\s*=\s*"robots"/i.test(tag));
  const directives=tag?String(attribute(tag,'content')||'').toLowerCase().split(',').map(value=>value.trim()).filter(Boolean):[];
  // A page Parliament keeps out of indexes, or whose links it asks robots not to
  // follow, is not presented or used as a link.
  return {directives,listed:!directives.some(value=>['noindex','nofollow','none'].includes(value))};
}
// OEIL and single-subject Doceo links in the “Further information” list.
// Encoded slashes and stray spaces occur.
export function furtherInformation(html) {
  const heading=html.search(/<span class="ep_name">\s*Further information\s*<\/span>/i);
  if(heading<0)return null;
  const end=html.indexOf('</ul>',heading),list=end<0?'':html.slice(heading,end);
  const links=[],seen=new Set();
  for(const match of list.matchAll(/<a\s[^>]*>([\s\S]*?)<\/a>/gi)) {
    const href=attribute(match[0].slice(0,match[0].indexOf('>')+1),'href')||'',url=websiteUrl(href);
    let link=null;
    if(url?.hostname==='oeil.europarl.europa.eu') {
      if(/^\/oeil\/(?:en|fr)\/procedure-file\/?$/.test(url.pathname)||url.pathname==='/oeil/popups/ficheprocedure.do') {
        const reference=(url.searchParams.get('reference')||'').trim().toUpperCase().replace(/\s+/g,'');
        if(REFERENCE.test(reference))link={kind:'procedure',value:reference};
      } else if(/^\/oeil\/(?:en|fr)\/document-summary\/?$/.test(url.pathname)) {
        const id=(url.searchParams.get('id')||'').trim();
        if(/^\d{1,12}$/.test(id))link={kind:'summary',value:id};
      }
    } else {
      const document=doceoDocument(href);
      if(document)link={kind:'document',value:document};
    }
    if(!link||seen.has(link.kind+':'+link.value))continue;
    seen.add(link.kind+':'+link.value);links.push({...link,label:plain(match[1])||null});
  }
  return links;
}
export function parsePressRelease(html,id) {
  if(typeof html!=='string'||Buffer.byteLength(html)>MAX_PAGE_BYTES||/<!ENTITY/i.test(html))throw new Error('Unreadable Parliament page.');
  const canonical=[...html.matchAll(/<link\s[^>]*>/gi)].map(match=>match[0]).find(tag=>/\srel\s*=\s*"canonical"/i.test(tag));
  if(pressReleaseIdentity(canonical?attribute(canonical,'href')||'':'')?.id!==id)throw new Error('The page does not match the announced press release.');
  const heading=html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1],name=heading?.match(/<span class="ep_name">([\s\S]*?)<\/span>/i)?.[1];
  const ogTitle=[...html.matchAll(/<meta\s[^>]*>/gi)].map(match=>match[0]).find(tag=>/\sproperty\s*=\s*"og:title"/i.test(tag));
  const title=plain(name??heading??'')||String(attribute(ogTitle||'','content')||'').split(' | ')[0].trim()||null;
  const time=html.match(/<time\s[^>]*itemprop\s*=\s*"datePublished"[^>]*>/i)?.[0],local=time&&attribute(time,'datetime');
  const links=furtherInformation(html);
  return {id,title,publishedLocal:/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(local||'')?local:null,robots:robots(html),furtherInformation:links!==null,links:links||[]};
}

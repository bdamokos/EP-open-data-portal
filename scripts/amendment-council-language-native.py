"""Independent, bounded native Word/XHTML assertions for the controlled cohort."""
import collections,hashlib,json,pathlib,re,sys,unicodedata,xml.dom.minidom as D,xml.etree.ElementTree as E,zipfile
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';H='http://www.w3.org/1999/xhtml'
sha=lambda b:hashlib.sha256(b).hexdigest()
def require(ok,reason):
 if not ok:raise ValueError(reason)
def fold(s):return re.sub(r'\s+',' ',unicodedata.normalize('NFC',s)).strip()
def tag(e):return e.localName or e.nodeName
def elements(e):return [c for c in e.childNodes if c.nodeType==c.ELEMENT_NODE]
def descend(e):
 yield e
 for c in elements(e):yield from descend(c)
def raw(e):return ''.join(c.data if c.nodeType in [c.TEXT_NODE,c.CDATA_SECTION_NODE] else raw(c) if c.nodeType==c.ELEMENT_NODE else '' for c in e.childNodes)
def xml(e):return e.toxml()
def children(e,name):return [c for c in elements(e) if tag(c)==name]
def checked(spec):
 b=pathlib.Path(spec['path']).read_bytes();require(len(b)<=8*1024*1024,'native input limit');require(sha(b)==spec['sha256'],'native hash mismatch');return b
def parse_xml(b):
 require(not re.search(br'<!ENTITY',b,re.I),'native entity declaration')
 b=b.replace(b'<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML//EN" "xhtml-strict.dtd">',b'')
 require(b'<!DOCTYPE' not in b.upper(),'unsupported native DTD')
 doc=D.parseString(b);require(len(list(descend(doc.documentElement)))<100000,'native node limit');return doc

def paths(doc,prefix):
 paths={};numeric={}
 root=doc.documentElement
 def walk(e,x,n):
  paths[e]=x;numeric[e]=n;counts=collections.Counter();order=[c for c in e.childNodes if c.nodeType in [c.ELEMENT_NODE,c.TEXT_NODE,c.CDATA_SECTION_NODE]]
  for i,c in enumerate(order):
   if c.nodeType!=c.ELEMENT_NODE:continue
   counts[tag(c)]+=1;walk(c,x+'/'+prefix+':'+tag(c)+'['+str(counts[tag(c)])+']',n+'/'+str(i))
 walk(root,'/'+prefix+':'+tag(root)+'[1]','/1');return paths,numeric

def word(spec):
 b=checked(spec)
 from io import BytesIO
 with zipfile.ZipFile(BytesIO(b)) as z:
  require(len(z.infolist())<256 and sum(i.file_size for i in z.infolist())<=12*1024*1024,'native Word expansion limit')
  require(z.namelist().count('word/document.xml')==1,'native Word part identity');part=z.read('word/document.xml')
 doc=parse_xml(part);root=doc.documentElement;require(root.namespaceURI==W and tag(root)=='document','native Word namespace');pp,_=paths(doc,'w');body=children(root,'body');require(len(body)==1,'native Word body')
 def visible(e):
  if tag(e) in ['del','moveFrom']:return ''
  if tag(e)=='r':
   for p in children(e,'rPr'):
    require(not any(tag(c) in ['vanish','webHidden'] and c.getAttributeNS(W,'val') not in ['0','false','off'] for c in elements(p)),'hidden native run unsupported')
  if tag(e)=='t':return raw(e)
  if tag(e) in ['tab','br','cr']:return ' '
  if tag(e)=='noBreakHyphen':return '\u2011'
  if tag(e)=='softHyphen':return '\u00ad'
  require(tag(e) not in ['drawing','pict','object','oMath','altChunk','footnoteReference','endnoteReference'],'unsupported native Word object')
  return ''.join(visible(c) for c in elements(e))
 current={};result={}
 for e in elements(body[0]):
  if tag(e)=='p':
   t=visible(e);nums=re.findall(r'<NumAm>(\d+)</NumAm>',t)
   if nums:
    n=int(nums[-1])
    if n!=current.get('number'):current={'number':n,'headingPath':pp[e]}
   for field in ['ANo','DocRef','DocAmend','Article']:
    found=re.findall('<'+field+'>(.*?)</'+field+'>',t)
    if found:current[field]=found[-1]
  elif tag(e)=='tbl' and current.get('number'):
   n=current['number'];require(n not in result,'duplicate native amendment');rows=children(e,'tr');require(len(rows)>=3,'native comparison rows');columns=[[],[]];cells=[[],[]]
   for row in rows[2:]:
    cs=children(row,'tc');require(len(cs)==2,'native comparison grid')
    for side,c in enumerate(cs):
     require(not any(tag(x)=='tbl' for x in descend(c)),'nested native Word comparison unsupported')
     ps=[x for x in descend(c) if tag(x)=='p'];columns[side].extend(visible(p) for p in ps);superscripts=[{'path':pp[run],'text':visible(run)} for run in descend(c) if tag(run)=='r' and any(tag(v)=='vertAlign' and v.getAttributeNS(W,'val')=='superscript' for pr in children(run,'rPr') for v in elements(pr))];cells[side].append({'path':pp[c],'paragraphs':[visible(p) for p in ps],'directSuperscripts':superscripts,'xmlSha256':sha(xml(c).encode())})
   result[n]={**current,'tablePath':pp[e],'original':fold(' '.join(columns[0])),'proposed':fold(' '.join(columns[1])),'columns':cells,'xmlSha256':sha(xml(e).encode())}
 require(sorted(result)==list(range(1,9)),'native amendment identities');require(all(a.get('ANo','A10-0175')=='A10-0175' for a in result.values()),'wrong native report')
 require(all('17037/1/2025' in a.get('DocRef','') and '2023/0226(COD)' in a.get('DocRef','') for a in result.values()),'wrong native Council reference')
 return result,sha(part)

def binding(spec):
 rdf='{http://www.w3.org/1999/02/22-rdf-syntax-ns#}';owl='{http://www.w3.org/2002/07/owl#}';cdm='{http://publications.europa.eu/ontology/cdm#}'
 b=checked(spec['rdf']);require(b'<!' not in b,'native RDF declaration');root=E.fromstring(b);triples=collections.defaultdict(set);aliases=collections.defaultdict(set)
 for e in root:
  subject=e.get(rdf+'about')
  if not subject:continue
  for c in e:
   value=c.get(rdf+'resource') or (c.text or '').strip()
   triples[(subject,c.tag)].add(value)
   if c.tag==owl+'sameAs':aliases[subject].add(value);aliases[value].add(subject)
 def closure(s):
  found={s};pending=[s]
  while pending:
   for other in aliases[pending.pop()]-found:found.add(other);pending.append(other)
  return found
 def values(s,p):return set().union(*(triples[(a,cdm+p)] for a in closure(s)))
 bound=spec['binding'];work=bound['workId'];require(work=='http://publications.europa.eu/resource/cellar/94b1ab29-4450-11f1-8095-01aa75ed71a1','wrong native Council work')
 require(values(work,'resource_legal_id_celex')=={'52026AG0006(01)'},'wrong native CELEX');require(values(work,'work_has_resource-type')=={'http://publications.europa.eu/resource/authority/resource-type/POSIT'},'wrong native Council resource type')
 require('http://publications.europa.eu/resource/authority/corporate-body/CONSIL' in values(work,'work_created_by_agent'),'wrong native Council author')
 require('http://publications.europa.eu/resource/consil/ST_17037_2025_REV_1' in values(work,'work_is_another_publication_of_work'),'wrong native Council revision')
 require(any('http://publications.europa.eu/resource/procedure/2023_226' in closure(v) for v in values(work,'work_part_of_dossier')),'wrong native COD owner')
 require(any(v.startswith('http://publications.europa.eu/resource/procedure-event/2023_226.') and v.endswith('_ADP_R1_POS_byCONSIL') for v in values(work,'work_part_of_event_legal')),'wrong native Council reading')
 item=bound['items'][0];expression=item['expressionId'];manifestation=item['manifestationId'];language={'en':'ENG','fr':'FRA','hu':'HUN','pl':'POL','ga':'GLE'}[spec['language']]
 require(values(expression,'expression_uses_language')=={'http://publications.europa.eu/resource/authority/language/'+language},'wrong native expression language')
 require(bool(values(expression,'expression_belongs_to_work')&closure(work)),'wrong native expression owner');require(bool(values(manifestation,'manifestation_manifests_expression')&closure(expression)),'wrong native manifestation owner');require(values(manifestation,'manifestation_type')=={'xhtml'},'wrong native manifestation format');require(bool(values(item['itemId'],'item_belongs_to_manifestation')&closure(manifestation)),'wrong native item owner')
 return {'rdfSha256':spec['rdf']['sha256'],'workId':work,'celex':'52026AG0006(01)','councilReference':'ST_17037_2025_REV_1','procedure':'2023/0226(COD)','itemId':item['itemId'],'expressionId':expression,'manifestationId':manifestation,'language':language}

def edition(spec):
 language=spec['language'];native_binding=binding(spec);require(language in ['en','fr','hu','pl','ga'],'unsupported edition');amendments,part_hash=word(spec['word']);b=checked(spec['xhtml']);doc=parse_xml(b);root=doc.documentElement;require(root.namespaceURI==H,'native XHTML namespace');pp,numeric=paths(doc,'h');allnodes=list(descend(root));ids={}
 for e in allnodes:
  if e.hasAttribute('id'):
   i=e.getAttribute('id');require(i not in ids,'duplicate native XHTML identity');ids[i]=e
 titles=[raw(e) for e in allnodes if tag(e)=='title'];require(len(titles)==1 and re.fullmatch(r'C_202602550'+language.upper()+r'\.000101\.fmx\.xml',titles[0]),'wrong native language/publication')
 def node(i):require(i in ids,'native identity unavailable: '+i);return ids[i]
 def source(e):return {'id':e.getAttribute('id') or None,'path':pp[e],'numericPath':numeric[e],'text':raw(e),'xmlSha256':sha(xml(e).encode()),'xml':xml(e)}
 def leafs(e):
  return [{'path':pp[p],'numericPath':numeric[p],'text':raw(p),'xmlSha256':sha(xml(p).encode())} for p in descend(e) if tag(p)=='p']
 def rendered(e):
  if tag(e)=='a' and e.getAttribute('href').startswith('#ntr'):return ''
  if tag(e)=='br':return '\n'
  require(tag(e) not in ['img','object','svg','math','iframe'],'unsupported native predecessor object')
  return ''.join(c.data if c.nodeType in [c.TEXT_NODE,c.CDATA_SECTION_NODE] else rendered(c) if c.nodeType==c.ELEMENT_NODE else '' for c in e.childNodes)
 def content_rows(e):
  result=[]
  for p in descend(e):
   if tag(p)!='p':continue
   prefix='';anc=p.parentNode
   while anc is not e.parentNode and anc.nodeType==anc.ELEMENT_NODE:
    if tag(anc)=='td' and tag(anc.parentNode)=='tr':
     cs=children(anc.parentNode,'td')
     if len(cs)==2 and re.fullmatch(r'(?:\(\w+\)|\w+[.)])',fold(raw(cs[0]))):
      if anc is cs[0]:prefix=None
      elif next((q for q in descend(cs[1]) if tag(q)=='p'),None) is p:prefix=fold(raw(cs[0]))+' '
      break
    anc=anc.parentNode
   if prefix is None:continue
   result.append({'path':pp[p],'numericPath':numeric[p],'text':fold(prefix+rendered(p)),'xmlSha256':sha(xml(p).encode())})
  require(bool(result),'native content rows unavailable');return result

 rows=[]
 for n,a in amendments.items():
  operation='replace' if a['original'] else 'insert';require(operation==('replace' if n<=3 else 'insert') and bool(a['proposed']),'native operation mismatch')
  r={'key':spec['listId']+':'+str(n)+':'+language,'number':n,'language':language,'operation':operation,'word':a,'wordPartSha256':part_hash}
  if n<=3:
   target=node('rct_'+str({1:34,2:60,3:65}[n]));native=fold(raw(target));legal=fold(a['original']);mapping=[]
   if language=='fr' and n in [1,2]:
    require(len(legal)==len(native),'French source length conflict')
    mapping=[{'offset':i,'word':x,'source':y} for i,(x,y) in enumerate(zip(legal,native)) if x!=y];require(all(m['word']=='’' and m['source']=="'" for m in mapping),'unaccepted French typography difference');legal=legal.replace('’',"'")
   correspondence=legal==native
   if n==3:
    state='typed-note-equivalence-held';cs=a['columns'][0];require(len(cs)==3 and re.fullmatch(r'_+',fold(' '.join(cs[1]['paragraphs']))),'native typed-note divider missing');footer=fold(' '.join(cs[2]['paragraphs']));label=re.match(r'(\d+)\s+',footer);require(label is not None and not correspondence,'native typed-note block missing');body=fold(' '.join(cs[0]['paragraphs']));r['typedNoteScope']={'printedFooterLabel':label[1],'inlineSuperscripts':cs[0]['directSuperscripts'],'inlineMarkerState':'literal-present' if label[1] in body else 'not-attested','formatting': 'directly-attested' if cs[0]['directSuperscripts'] else 'unverified','legalApplication':'held'}
   elif language=='ga' and n==2:state='source-orthography-conflict';require(not correspondence and '\u2011' in a['original'] and 'n ' in native,'missing Irish source conflict')
   else:state='native-correspondence-verified';require(correspondence,'native replacement correspondence conflict')
   r.update({'state':state,'native':source(target),'leafs':leafs(target),'contentRows':content_rows(target),'typographyMappings':mapping,'sameLanguageNativeWordingEqual':correspondence})
  else:
   if n==4:
    predecessor=node('rct_65');following=node('rct_66');owner=predecessor.parentNode;require(following.parentNode is owner and elements(owner).index(following)==elements(owner).index(predecessor)+1,'recital boundary conflict')
   elif n==5:
    predecessor=node('art_4');owner=node('cpt_I');following=node('cpt_II');require(predecessor.parentNode is owner and elements(owner)[-1] is predecessor,'article not at Chapter I end');require(following.parentNode is owner.parentNode and elements(owner.parentNode).index(following)==elements(owner.parentNode).index(owner)+1,'chapter boundary conflict');require(node('art_5').parentNode is following,'Article 5 owner conflict')
   else:
    owner=node({6:'006.003',7:'007.002',8:'009.001'}[n]);require(owner.parentNode is node({6:'art_6',7:'art_7',8:'art_9'}[n]),'wrong native paragraph owner');tables=children(owner,'table');labels=[]
    for t in tables:
     trs=[x for x in descend(t) if tag(x)=='tr'];require(bool(trs),'native list row');cs=children(trs[0],'td');require(len(cs)==2,'native list columns');labels.append(fold(raw(cs[0])))
    require(labels.count('(d)')+labels.count('d)')==1,'native point d identity');at=next(i for i,s in enumerate(labels) if s in ['(d)','d)']);require(at+1<len(tables) and labels[at+1] in ['(e)','e)'],'native following point');predecessor=tables[at];following=tables[at+1];require(elements(owner).index(following)==elements(owner).index(predecessor)+1,'native point adjacency')
    if n in [6,7]:
     nested=[t for t in descend(predecessor) if tag(t)=='table' and t is not predecessor];roman=[]
     for t in nested:
      tr=next((x for x in descend(t) if tag(x)=='tr'),None);cs=children(tr,'td') if tr is not None else [];require(len(cs)==2,'native Roman grid');roman.append(fold(raw(cs[0])).strip('().'))
     require(roman==['i','ii'],'complete Roman predecessor children missing or changed')
    if n==8:
     ps=children(owner,'p');require(len(ps)>=2 and elements(owner).index(ps[1])<elements(owner).index(tables[0]),'second subparagraph owner');r['secondSubparagraphIntroduction']=source(ps[1])
   r.update({'state':'native-boundary-verified','owner':{k:v for k,v in source(owner).items() if k not in ['text','xml']},'predecessor':source(predecessor),'following':source(following),'predecessorLeafs':leafs(predecessor),'followingLeafs':leafs(following),'predecessorRows':content_rows(predecessor),'followingRows':content_rows(following)[:2] if n==5 else content_rows(following)})
  rows.append(r)
 return {'language':language,'nativeBinding':native_binding,'wordSha256':spec['word']['sha256'],'xhtmlSha256':spec['xhtml']['sha256'],'rows':rows}
if __name__=='__main__':
 try:
  value=json.load(sys.stdin);print(json.dumps({'nativeVerifierVersion':1,'editions':[edition(e) for e in value['editions']]},ensure_ascii=False))
 except Exception as e:
  print(str(e),file=sys.stderr);sys.exit(1)

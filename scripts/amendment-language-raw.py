#!/usr/bin/env python3
"""Independent published DOCX observations; no application parser or label tree."""
import io, json, re, sys, zipfile
import xml.etree.ElementTree as E
W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
NAMES = 'Amendment|Изменение|Pozměňovací návrh|Ændringsforslag|Änderungsantrag|Τροπολογία|Enmienda|Muudatusettepanek|Tarkistus|Amendement|Leasú|Amandman|Módosítás|Emendamento|Pakeitimas|Grozījums Nr\\.|Emenda|Poprawka|Alteração|Amendamentul|Pozmeňujúci návrh|Predlog spremembe|Ändringsförslag'

def read_docx(data):
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        info = z.getinfo('word/document.xml')
        if info.file_size > 32 * 1024 * 1024:
            raise ValueError('Raw XML exceeds 32 MiB')
        root = E.fromstring(z.read(info))
    paths = {}
    def walk(node, path):
        paths[id(node)] = path
        counts = {}
        for child in node:
            name = child.tag.replace(W, 'w:') if child.tag.startswith(W) else child.tag.split('}')[-1]
            counts[name] = counts.get(name, 0) + 1
            walk(child, path + '/' + name + '[' + str(counts[name]) + ']')
    walk(root, '/w:document[1]')
    def text(node):
        # Exclude deleted/hidden runs and field instructions; retain visible text.
        if node.tag in [W+'del', W+'moveFrom', W+'instrText']:
            return ''
        if node.tag == W+'r' and node.find(W+'rPr/'+W+'vanish') is not None:
            return ''
        if node.tag == W+'t':
            return node.text or ''
        if node.tag in [W+'tab', W+'br', W+'cr']:
            return ' ' if node.tag == W+'tab' else '\n'
        return ''.join(text(n) for n in node)
    body = root.find(W+'body')
    paragraphs = []
    for p in body.iter(W+'p'):
        value = text(p).strip()
        props = p.find(W+'pPr')
        style = props.find(W+'pStyle') if props is not None else None
        paragraphs.append(dict(path=paths[id(p)], text=value, style=style.get(W+'val') if style is not None else None,
            body=bool(re.fullmatch(r'/w:document\[1\]/w:body\[1\]/w:p\[\d+\]', paths[id(p)])),
            uncertain=any(n.tag in [W+'drawing', W+'object', W+'sym', W+'sdt', W+'altChunk'] or n.tag.endswith('}oMath') for n in p.iter()),
            automatic=props is not None and props.find(W+'numPr') is not None))
    blocks = []; current = None; before = []
    for node in body:
        value = text(node).strip()
        match = re.fullmatch(r'(?:'+NAMES+r')\s*(\d+)', value, re.I) if node.tag == W+'p' else None
        # Template NumAm is explicit identity, independent of localized headings.
        tagged = re.search(r'<NumAm>\s*(\d+)\s*</NumAm>', value) if node.tag == W+'p' else None
        if tagged or match:
            if current is not None and current['number'] == int((tagged or match)[1]) and not current['tables']:
                continue
            if current is not None: blocks.append(current)
            current = dict(number=int((tagged or match)[1]), path=paths[id(node)], tables=[], headings=[])
            before = []
        elif current is not None:
            if node.tag == W+'p' and value:
                before.append(value); current['headings'].append(value)
            if node.tag == W+'tbl':
                rows = []
                for row in node.findall(W+'tr'):
                    cells = row.findall(W+'tc')
                    rows.append([dict(text='\n'.join(text(p).strip() for p in c.findall(W+'p') if text(p).strip()), path=paths[id(c)],
                        nested=c.find('.//'+W+'tbl') is not None,
                        merged=c.find(W+'tcPr/'+W+'vMerge') is not None or c.find(W+'tcPr/'+W+'gridSpan') is not None) for c in cells])
                current['tables'].append(dict(path=paths[id(node)], before=before[:], rows=rows))
                before=[]
    if current is not None: blocks.append(current)
    for b in blocks:
        if len(b['tables']) != 1:
            b['gap']='raw-comparison-count'; continue
        table=b['tables'][0]
        headings='\n'.join(table['before'])
        label=re.findall(r'<Article>([\s\S]*?)</Article>',headings)
        b['targetLabel']='\n'.join(label).strip() if label else (table['before'][-1] if table['before'] else '')
        section=re.findall(r'<DocAmend>([\s\S]*?)</DocAmend>',headings)
        b['section']=section[-1].strip() if section else (table['before'][-2] if len(table['before'])>1 else None)
        rows=[r for r in table['rows'] if any(c['text'] for c in r)]
        if len(rows)<2 or any(len(r)!=2 or any(c['nested'] or c['merged'] for c in r) for r in rows):
            b['gap']='raw-comparison-layout'; continue
        b['originalText']='\n'.join(r[0]['text'] for r in rows[1:]).strip()
        b['proposedText']='\n'.join(r[1]['text'] for r in rows[1:]).strip()
        b['cellPaths']=[[c['path'] for c in r] for r in rows[1:]]
    return dict(paragraphs=paragraphs, amendments=blocks)

if __name__ == '__main__':
    print(json.dumps(read_docx(sys.stdin.buffer.read()), ensure_ascii=False))

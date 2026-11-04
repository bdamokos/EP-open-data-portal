"""Independent native page evidence; no PDF.js or producer imports.

qpdf supplies annotation dictionaries, appearance bytes, tagged object owners and
painted rectangle operators. Poppler supplies visible text independently. This
reader reports evidence, never declares a page complete from its presence alone.
"""
import base64, hashlib, json, pathlib, re, subprocess, sys

def native_pages(pdf):
    data = pathlib.Path(pdf).read_bytes()
    if len(data) > 8 * 1024 * 1024:
        raise ValueError('native-pdf-byte-limit')
    result = subprocess.run(['qpdf', '--json', '--json-stream-data=inline', str(pdf)], capture_output=True, timeout=25, check=True)
    if len(result.stdout) > 32 * 1024 * 1024:
        raise ValueError('native-pdf-object-limit')
    document = json.loads(result.stdout)
    objects = document['qpdf'][1]
    def obj(ref):
        return objects['obj:' + ref] if isinstance(ref, str) and ref.endswith(' R') else {'value': ref}
    def value(ref):
        return obj(ref)['value']
    def stream(ref):
        return base64.b64decode(obj(ref)['stream']['data'])
    owners = {}
    catalog = next(v['value'] for v in objects.values() if isinstance(v.get('value'), dict) and v['value'].get('/Type') == '/Catalog')
    def walk(node, ancestors=()):
        ref = node if isinstance(node, str) else None
        node = value(node)
        if isinstance(node, list):
            for child in node:
                walk(child, ancestors)
        elif isinstance(node, dict):
            if node.get('/Type') == '/OBJR':
                owners.setdefault(node['/Obj'], []).append(ancestors)
            else:
                walk(node.get('/K', []), ancestors + ((ref, node.get('/S')),))
    walk(value(catalog['/StructTreeRoot'])['/K'])
    text = subprocess.run(['pdftotext', '-layout', str(pdf), '-'], capture_output=True, timeout=25, check=True).stdout.decode('utf8').split('\f')
    number = r'[-+]?(?:\d+\.?\d*|\.\d+)'
    rectangle = re.compile(r'(' + number + r')\s+(' + number + r')\s+(' + number + r')\s+(' + number + r')\s+re\s+(f\*?|S|B\*?)(?=\s|$)')
    pages = []
    for i, page in enumerate(document['pages']):
        raw = '\n'.join(stream(ref).decode('latin1') for ref in page['contents'])
        annotations = []
        for ref in value(page['object']).get('/Annots', []):
            note = value(ref)
            appearance = note.get('/AP', {})
            normal = appearance.get('/N')
            appearance_empty = not appearance or set(appearance) == {'/N'} and isinstance(normal, str) and bool(re.fullmatch(rb'\s*q\s+Q\s*', stream(normal)))
            uri = note.get('/A', {}).get('/URI', '').removeprefix('u:')
            annotations.append({'ref': ref, 'subtype': note.get('/Subtype'), 'rect': note.get('/Rect'), 'uri': uri,
                'appearanceEmpty': appearance_empty, 'owners': owners.get(ref, []),
                'uriPrinted': bool(uri and re.sub(r'\s+', '', uri) in re.sub(r'\s+', '', text[i]))})
        pages.append({'page': i + 1, 'images': page['images'], 'rectangles': [{'xywh': [float(v) for v in m.groups()[:4]], 'paint': m[5]} for m in rectangle.finditer(raw)], 'annotations': annotations})
    return {'sha256': hashlib.sha256(data).hexdigest(), 'pages': pages}

if __name__ == '__main__':
    print(json.dumps(native_pages(sys.argv[1]), ensure_ascii=False))

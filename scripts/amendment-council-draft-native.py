"""Independent Council PDF evidence reader. No producer or placer imports.

qpdf supplies native object references; Poppler supplies printed text independently.
The CLI consumes a JSON spec on stdin. It does not acquire sources.
"""
import collections, hashlib, json, pathlib, re, subprocess, sys, tempfile

def require(ok, message):
    if not ok:
        raise ValueError(message)

def native(spec):
    data = pathlib.Path(spec['pdf']).read_bytes()
    require(len(data) <= 8 * 1024 * 1024 and data.startswith(b'%PDF-'), 'native-pdf-limit')
    require(hashlib.sha256(data).hexdigest() == spec['sha256'], 'native-hash-mismatch')
    result = subprocess.run(['qpdf', '--json', spec['pdf']], capture_output=True, timeout=25, check=True)
    require(len(result.stdout) <= 32 * 1024 * 1024, 'native-object-limit')
    document = json.loads(result.stdout)
    objects = document['qpdf'][1]
    lookup = lambda ref: objects['obj:' + ref]['value'] if isinstance(ref, str) and ref.endswith(' R') else ref
    pages = {page['object']: i + 1 for i, page in enumerate(document['pages'])}
    require(len(pages) <= 100, 'native-page-limit')
    catalog = next(v['value'] for v in objects.values() if isinstance(v, dict) and isinstance(v.get('value'), dict) and v['value'].get('/Type') == '/Catalog')
    root = lookup(catalog['/StructTreeRoot'])
    roles = lookup(root.get('/RoleMap', {}))
    blocks = []
    seen = set()
    def walk(value, page=None, ancestors=()):
        if isinstance(value, list):
            return sum((walk(v, page, ancestors) for v in value), [])
        if isinstance(value, int):
            require(page in pages, 'native-mcid-page')
            return [{'page': pages[page], 'mcid': value}]
        ref = value if isinstance(value, str) else None
        if ref:
            require(ref not in seen, 'native-tree-cycle')
            seen.add(ref)
        node = lookup(value)
        require(isinstance(node, dict), 'native-tree-kid')
        page = node.get('/Pg', page)
        if node.get('/Type') == '/MCR':
            require('/Stm' not in node, 'native-stream-mcid-unsupported')
            return walk(node['/MCID'], page, ancestors)
        if node.get('/Type') == '/OBJR':
            return [{'object': node.get('/Obj'), 'page': pages.get(page)}]
        role = roles.get(node.get('/S'), node.get('/S'))
        children = walk(node.get('/K', []), page, ancestors + ((ref, role),))
        if role in ['/P', '/LBody', '/Note', '/Figure', '/Table']:
            blocks.append({'ref': ref, 'role': role, 'ancestors': ancestors, 'content': children})
        return children
    walk(root['/K'])
    text = subprocess.run(['pdftotext', '-layout', spec['pdf'], '-'], capture_output=True, timeout=25, check=True).stdout.decode('utf8')
    number, year = str(int(spec['number'])), str(spec['year'])
    require(re.search(r'(?<!\d)' + number + '/' + re.escape(year[-2:]) + r'(?!\d)', text), 'native-st-mismatch')
    require(re.sub(r'\s+', '', spec['procedure']) in re.sub(r'\s+', '', text), 'native-procedure-mismatch')
    return {'sha256': spec['sha256'], 'pages': len(pages), 'blocks': blocks, 'textPages': text.split('\f'), 'images': [{'page': i + 1, 'images': p['images']} for i, p in enumerate(document['pages']) if p['images']]}

if __name__ == '__main__':
    print(json.dumps(native(json.load(sys.stdin)), ensure_ascii=False))

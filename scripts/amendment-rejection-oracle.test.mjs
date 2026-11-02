import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyRejection,nativeRejectionParagraphs} from './amendment-rejection-oracle.mjs';
test('rejection oracle refuses unrelated sources and uncalibrated document operations',()=>{
  assert.equal(verifyRejection({id:'A-10-2025-0158-AM-422',language:'en',buffer:Buffer.from('unrelated')} ).status,'failed');
  assert.equal(verifyRejection({id:'unknown',language:'en',placement:{status:'document-operation'}}).status,'unverified');
  assert.equal(verifyRejection({id:'unknown',language:'en',placement:{status:'unresolved'}}),null);
});

import {execFileSync} from 'node:child_process';
import {mkdtempSync,readdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
test('large native XML reads use bounded file input and remove temporary bytes on success and failure',t=>{
  const temporaryRoot=mkdtempSync(join(tmpdir(),'rejection-transport-test-'));t.after(()=>rmSync(temporaryRoot,{recursive:true,force:true}));
  const buffer=execFileSync('python3',['-c',`import io,sys,zipfile
body='<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>'+('A'*262144)+'</w:t></w:r></w:p><w:p><w:r><w:t>Native paragraph.</w:t></w:r></w:p></w:body></w:document>'
out=io.BytesIO()
with zipfile.ZipFile(out,'w',compression=zipfile.ZIP_STORED) as source: source.writestr('word/document.xml',body)
sys.stdout.buffer.write(out.getvalue())`],{maxBuffer:1024*1024,timeout:30_000,stdio:['ignore','pipe','pipe']});
  assert.ok(buffer.length>64*1024);assert.deepEqual(nativeRejectionParagraphs(buffer,{temporaryRoot}),['A'.repeat(262144),'Native paragraph.']);assert.deepEqual(readdirSync(temporaryRoot),[]);
  assert.throws(()=>nativeRejectionParagraphs(Buffer.from('broken ZIP'),{temporaryRoot}));assert.deepEqual(readdirSync(temporaryRoot),[]);
});

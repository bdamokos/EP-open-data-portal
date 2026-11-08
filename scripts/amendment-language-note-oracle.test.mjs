import test from 'node:test';import assert from 'node:assert/strict';
import {calloutFreeOriginal} from './amendment-language-oracle.mjs';
// Shape of A-10-2025-0150 AM 29 (en): the list prints note 2 fused to the
// cited regulation number and the note text after a rule.
const original='(a)\tthe activities referred to in Regulation (EC) No 1005/20082;\n(b)\toperating without a VMS.”\n_____________________\n2 Council Regulation (EC) No 1005/2008 of 29 September 2008 (OJ L 286, 29.10.2008, p. 1–32)';
test('a dropped note leaves the body without its call-out',()=>{
 assert.equal(calloutFreeOriginal(original,'(a) the activities referred to in Regulation (EC) No 1005/2008;\n(b) operating without a VMS.”'),'(a)\tthe activities referred to in Regulation (EC) No 1005/2008;\n(b)\toperating without a VMS.”');
});
test('the body must otherwise equal the splice',()=>{
 assert.equal(calloutFreeOriginal(original,'(a) the activities referred to in Regulation (EC) No 1005/2009;\n(b) operating without a VMS.”'),null);
 assert.equal(calloutFreeOriginal(original,'(a) the activities referred to in Regulation (EC) No 1005/20082;\n(b) operating without a VMS.”'),null);
 assert.equal(calloutFreeOriginal('(a) No rule here 2.','(a) No rule here .'),null);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {parseProcedureReference} from './procedureReference.mjs';
test('procedure references are normalized from common copied forms',()=>{
 for(const input of ['2025/0407(COD)',' 2025/0407 (cod) ','2025/0407/COD','2025-0407-COD','2025/0407 COD','https://oeil.secure.europarl.europa.eu/oeil/en/procedure-file?reference=2025/0407(COD)'])
   assert.deepEqual(parseProcedureReference(input),{reference:'2025/0407(COD)'},input);
 assert.deepEqual(parseProcedureReference('2024/0001A(NLE)'),{reference:'2024/0001A(NLE)'});
});
test('empty and malformed references explain what to enter',()=>{
 assert.match(parseProcedureReference('').error,/Enter a procedure reference/);
 assert.match(parseProcedureReference('   ').error,/Enter a procedure reference/);
 for(const input of ['2025/0407COD','2025/407(COD)','climate','https://example.org/?q=1'])assert.match(parseProcedureReference(input).error,/2025\/0407\(COD\)/,input);
});

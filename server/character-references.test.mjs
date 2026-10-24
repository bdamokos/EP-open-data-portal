import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeCharacterReferences as decode} from './character-references.mjs';
import {sourceTitle} from './source-titles.mjs';
import {decodeHtml} from './press-releases-model.mjs';

const policies=['source-title','vote-reference','press-html','split-xml'];

test('named sets retain case sensitivity and distinct nonbreaking-space handling',()=>{
  const input='&amp; &lt; &gt; &quot; &apos; &AMP; &nbsp; &NBSP; &eacute; &Eacute; &rsquo; &MDASH;';
  const xml='& < > " \' &AMP; &nbsp; &NBSP; &eacute; &Eacute; &rsquo; &MDASH;';
  assert.equal(decode(input,'source-title'),'& < > " \' & \u00a0 &NBSP; é É ’ &MDASH;');
  assert.equal(decode(input,'vote-reference'),xml);
  assert.equal(decode(input,'split-xml'),xml);
  assert.equal(decode(input,'press-html'),'& < > " \' &     &eacute; &Eacute; ’ —');
  assert.equal(decode('&lsquo;&rsquo;&ldquo;&rdquo;&ndash;&mdash;&hellip;','press-html'),'‘’“”–—…');
  for(const policy of policies)assert.equal(decode('&constructor; &toString; &__proto__; &NotEqualTilde;',policy),'&constructor; &toString; &__proto__; &NotEqualTilde;');
});

test('numeric recognition keeps hex case and press digit limits, including leading zeros',()=>{
  const input='&#38; &#x26; &#X26; &#0000038; &#00000038; &#x000026; &#x0000026;';
  for(const policy of ['source-title','split-xml'])assert.equal(decode(input,policy),'& & & & & & &');
  assert.equal(decode(input,'vote-reference'),'& & &#X26; & & & &');
  assert.equal(decode(input,'press-html'),'& & & & &#00000038; & &#x0000026;');
});

test('numeric boundaries preserve each adapter policy rather than applying HTML error recovery',()=>{
  const cases=[
    [0,null,null,null,null],
    [1,'\u0001',null,'\u0001',null],
    [8,'\b',null,'\b',null],
    [9,'\t','\t','\t','\t'],[10,'\n','\n','\n','\n'],[13,'\r','\r','\r','\r'],
    [11,'\v',null,'\v',null],[31,'\u001f',null,'\u001f',null],
    [32,' ',' ',' ',' '],
    [0x80,'\u0080','\u0080','\u0080','\u0080'],
    [0xd7ff,'\ud7ff','\ud7ff','\ud7ff','\ud7ff'],
    [0xd800,null,null,'\ud800',null],[0xdfff,null,null,'\udfff',null],
    [0xe000,'\ue000','\ue000','\ue000','\ue000'],
    [0xfffd,'\ufffd','\ufffd','\ufffd','\ufffd'],
    [0xfffe,'\ufffe',null,'\ufffe','\ufffe'],[0xffff,'\uffff',null,'\uffff','\uffff'],
    [0x1fffe,'\u{1fffe}','\u{1fffe}','\u{1fffe}','\u{1fffe}'],
    [0x10ffff,'\u{10ffff}','\u{10ffff}','\u{10ffff}','\u{10ffff}'],
    [0x110000,null,null,null,null],
  ];
  for(const [point,...expected] of cases)for(const token of [`&#${point};`,`&#x${point.toString(16)};`])
    policies.forEach((policy,index)=>assert.equal(decode(token,policy),expected[index]??token,`${policy}: ${token}`));
  for(const policy of policies)assert.equal(decode('&#999999999999999999999999999999999999; &#xFFFFFFFFFFFFFFFFFFFF;',policy),'&#999999999999999999999999999999999999; &#xFFFFFFFFFFFFFFFFFFFF;');
});

test('each invocation decodes one layer without interpreting tags, URLs or whitespace',()=>{
  for(const policy of policies){
    assert.equal(decode('  &amp;lt; &#38;lt; &#x26;amp;\n',policy),'  &lt; &lt; &amp;\n');
    assert.equal(decode('&lt;img src=x&gt; <b>literal</b> 10%20 %26 A+B',policy),'<img src=x> <b>literal</b> 10%20 %26 A+B');
    assert.equal(decode('&amp;&amp;&amp;',policy),'&&&');
    assert.equal(decode('&amp;',policy),'&','global matching state never leaks between calls');
  }
});

test('malformed and incomplete references remain literal by default',()=>{
  for(const policy of policies)for(const input of ['R&D','&amp','& copy;','&;','&#;','&#x;','&#xZZ;','&#x41oops;','&#12oops;','&#-1;','&#+38;','&# 38;'])
    assert.equal(decode(input,policy),input,`${policy}: ${input}`);
});

test('split callbacks distinguish unsupported whole tokens from invalid numeric points',()=>{
  for(const [input,reason] of [['&nbsp;','unsupported'],['&AMP;','unsupported'],['&#x41oops;','unsupported'],['&#-1;','unsupported'],['&#0;','invalid-point'],['&#xD800;','invalid-point'],['&#1114112;','invalid-point']]){
    const calls=[];
    assert.equal(decode(input,'split-xml',(token,kind)=>{calls.push([token,kind]);return '[invalid]';}),'[invalid]');
    assert.deepEqual(calls,[[input,reason]]);
  }
  assert.throws(()=>decode('&#0;','split-xml',()=>{throw new Error('Domain failure');}),/Domain failure/);
});

test('wrappers retain source passthrough and press string coercion',()=>{
  for(const value of [null,undefined,0,false,{title:'&amp;'}])assert.equal(sourceTitle(value),value);
  assert.equal(decodeHtml(null),'null');assert.equal(decodeHtml(undefined),'undefined');assert.equal(decodeHtml(38),'38');
  assert.equal(decodeHtml({toString:()=> '&amp;nbsp;'}),'&nbsp;');
  assert.throws(()=>decode('&amp;','constructor'),/Unknown character-reference policy/);
});

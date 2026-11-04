import test from 'node:test';import assert from 'node:assert/strict';
import {hasCouncilQuotation} from './report-council-quotation.mjs';
for(const raw of ['Text proposed by the Council','Znění navržené Radou','Texto del Consejo','Rådets tekst'])test(`explicit native Council comparison heading: ${raw}`,()=>{
 const source={conflicted:false,headings:[{left:{raw}}]};assert(hasCouncilQuotation({baselineSource:source}));assert(!hasCouncilQuotation({baselineSource:{...source,conflicted:true}}));assert(!hasCouncilQuotation({baselineSource:{...source,headings:[...source.headings,{left:{raw:'Present text'}}]}}));
});

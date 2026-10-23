import {CorpusReader} from '../corpus-reader.mjs';

// Integration assertions concern retained data, not worker startup speed. Keep
// a finite hang guard while allowing the full suite to compete for CPU and I/O.
export const readerTimeoutMs=120_000;
export function allowSlowCorpusReaders(t) {
  const query=CorpusReader.prototype.query;
  t.mock.method(CorpusReader.prototype,'query',function(...args) {
    this.timeoutMs=readerTimeoutMs;
    this.statusTimeoutMs=readerTimeoutMs;
    return query.apply(this,args);
  });
}

import {sharedRequest,waitForRequest} from './request-budget.mjs';
// One worker at a time, bounded waiting, and one delivery of shared facts even
// when several languages or concurrent visitors ask for the same week.
export class SerialFactReads {
  constructor({maxPending=8}={}){this.maxPending=maxPending;this.pending=new Map();this.tail=Promise.resolve();}
  read(key,load) {
    if(this.pending.has(key))return waitForRequest(this.pending.get(key));
    if(this.pending.size>=this.maxPending)return Promise.reject(new Error('Week fact reader queue is full'));
    const promise=this.tail.catch(()=>{}).then(()=>sharedRequest(load)).finally(()=>this.pending.delete(key));
    this.tail=promise;this.pending.set(key,promise);
    return waitForRequest(promise);
  }
}

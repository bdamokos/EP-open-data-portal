import {act} from 'react';
/** Resume an overdue read; timer scheduling is covered separately with a fake clock. */
export async function automaticRecovery(t) {
 const clock=Date.now.bind(Date);
 const mocked=t.mock.method(Date,'now',()=>clock()+600000);
 await act(async()=>{window.dispatchEvent(new window.Event('online'));mocked.mock.restore();});
 await act(async()=>new Promise(resolve=>setTimeout(resolve,20)));
}

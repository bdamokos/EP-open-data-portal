import {createHash} from 'node:crypto';
export const baseSourceKey=(url,request={})=>createHash('sha256').update(JSON.stringify([url,request.accept??null,request.language??null])).digest('hex');

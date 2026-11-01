// start is the first body paragraph's index in the supplied list; exact is false when cleaning changed characters.
export function publicationBody(paragraphs:string[],documentId:string,language:string|null|undefined):{paragraphs:string[];header:string[];start:number;exact:boolean;coverLogoParagraph?:number|null};

export function publicationHasMissingContent(text:unknown,body:{start:number;coverLogoParagraph?:number|null},logo?:{paragraph:number;offset:number}|null):boolean;

export function publicationCoverLogo(text:unknown,documentId:string,language:string|null|undefined):{paragraph:number;offset:number}|null;

export function withoutSubmittedLine<T extends {paragraphs:string[];header:string[]}>(body:T,documentId:string,language:string|null|undefined,shownDate:string|null|undefined):{body:T;trailer:string[]};

export type SearchReference=
  |{kind:'dossier';process:string;type:string|null}
  |{kind:'document';id:string;keys:string[]}
  |{kind:'commission';key:string;label:string}
  |{kind:'member';id:string;explicit:boolean};
export function searchReference(text:string):SearchReference|null;

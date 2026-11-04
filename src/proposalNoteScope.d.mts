import type {WordingFormat} from './components/WordingFormatting';
type Column={body:string;notes:string;bodyFormatting:WordingFormat[];notesFormatting:WordingFormat[]};
export function proposalNoteComparison(wording:{originalText:string|null;proposedText:string|null;originalFormatting?:WordingFormat[];proposedFormatting?:WordingFormat[]},scope:{kind:'word-footnotes'|'pdf-footnotes';originalBodyEnd:number;proposedBodyEnd:number}):{original:Column;proposed:Column}|null;

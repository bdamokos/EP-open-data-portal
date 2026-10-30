import type {DocumentImageAssets,DocumentImageReference} from './DocumentImage';
import type { DocumentNote, NoteAnchor, DocumentLink } from './explorerTypes'

export type ProposalUnitKind = 'frontmatter' | 'memorandum' | 'preamble' | 'body' | 'signature' | 'financial-statement' | 'title' | 'citation' | 'recital' | 'enacting-formula' | 'chapter' | 'section' | 'article' | 'annex' | 'paragraph' | 'subparagraph' | 'point' | 'indent' | 'quotation' | 'table'
export interface ProposalPathSegment {
  kind: string
  value: string
  number?: number | null
  suffix?: string
  base?: string
  negative?: boolean
  isNew?: boolean
  /** Repeated source labels are distinct, but cannot be uniquely addressed. */
  occurrence?: number
  raw?: string
  sourceValue?: string
  unavailable?: boolean
  prefix?: string
  level?: number
  numbering?: ProposalNumbering
  hierarchyAmbiguous?: boolean
}
export type MathMLTag = 'math' | 'mrow' | 'mi' | 'mn' | 'mo' | 'mtext' | 'mfrac' | 'msub' | 'msup' | 'msubsup' | 'msqrt' | 'mroot' | 'munder' | 'mover' | 'munderover' | 'mtable' | 'mtr' | 'mtd'
export interface MathMLNode { tag: MathMLTag; children: Array<MathMLNode | string>; attributes?: { accent?: 'true'; accentunder?: 'true'; mathvariant?: string } }
export interface ProposalObject {
  image?:DocumentImageReference;
  kind: 'math' | 'drawing' | 'object' | 'symbol' | 'unsupported'
  status: 'mapped' | 'converted' | 'unresolved'
  paragraph: number
  offset: number
  path: string
  sourcePart?: string
  note?: string
  paragraphOffset?: number
  replacement: string
  complete: boolean
  sourceUrl: string | null
  math?: MathMLNode | null
  unsupported?: string[]
}
export interface ProposalNote extends DocumentNote {
  source?: { part: string; path: string }
  extractionComplete?: boolean
  complete: boolean
  objects: ProposalObject[]
}
export interface ProposalNumbering { id: string; abstractId: string; level: number; format: string }
export interface ProposalParagraph {
  index: number
  text: string
  complete: boolean
  source: { path: string; ordinal: number; container: string; containerPath: string; segment: number; complete: boolean } | null
  properties: { styleId: string | null; numberingLabel: string; numberingComplete: boolean; notesComplete: boolean; annotationsComplete?: boolean; numbering?: ProposalNumbering } | null
  objects: ProposalObject[]
}
export interface ProposalTable {
  anchor?: number
  sourcePath: string
  paragraphs: number[]
  complete: boolean
  rows: Array<{ cells: Array<{ sourcePath: string; paragraphs: number[]; colSpan: number; verticalMerge: 'start' | 'continue' | null; horizontalMerge?: 'start' | 'continue' | null; complete: boolean }> }>
  nestedTables?: ProposalTable[]
}
export interface ProposalUnit {
  id: string
  kind: ProposalUnitKind
  label?: ProposalPathSegment
  path: ProposalPathSegment[]
  scope: 'proposal' | 'quoted'
  normative: boolean
  /** Half-open indices into ProposalDocument.paragraphs, including descendants. */
  extent: { start: number; end: number }
  /** Paragraphs owned directly by this unit. Descendants retain their own refs. */
  content: number[]
  /** Exact text slices; inline replacements may share a paragraph with their instruction. */
  spans: Array<{ paragraph: number; start: number; end: number }>
  children: ProposalUnit[]
  complete: boolean
  implicit?: boolean
  pathConflict: boolean
  instructionPath?: ProposalPathSegment[]
  boundaryBasis?: 'quotation-mark' | 'replacement-instruction'
  boundaryAmbiguous?: boolean
  closingBoundaryBasis?: 'instruction-style' | 'source-heading'
  underlyingPath?: ProposalPathSegment[]
  instruction?: { operation: 'amend' | 'replace' | 'insert' | 'delete' | 'unknown'; raw: string; underlyingTargets: ProposalPathSegment[] }
  table?: ProposalTable
}
export interface ProposalDocument {
  imageAssets?:DocumentImageAssets;
  parserVersion: string
  language: string
  item: 'act' | 'annex'
  identity: unknown
  sourceUrl: string | null
  sourceHash: string
  sourceKind: string
  numberingMode: string
  complete: boolean
  contentComplete: boolean
  structureComplete: boolean
  paragraphs: ProposalParagraph[]
  units: ProposalUnit[]
  objects: ProposalObject[]
  notes: ProposalNote[]
  anchors: NoteAnchor[]
  links: DocumentLink[]
  gaps: Array<{ code: string; message: string; paragraph?: number; note?: string; sourcePath?: string; sourcePart?: string; offset?: number; limit?: number; retained?: number; total?: number; omitted?: number; path?: ProposalPathSegment[] }>
}
export interface ProposalTargetPath {
  language: string
  raw: string
  segments: ProposalPathSegment[]
  complete: boolean
  unparsed: string[]
  underlyingLabel: string | null
}

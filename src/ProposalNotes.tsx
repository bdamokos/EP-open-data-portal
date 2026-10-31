import {DocumentImage,type DocumentImageAssets} from './DocumentImage';
import { Fragment } from 'react'
import { DocumentNotes, ReferenceText } from './References'
import { SourceLink } from './SourceLink'
import { ProposalMath } from './ProposalMath'
import type { ProposalNote } from './proposalTypes'

/** The shared note list keeps its anchors and links; only object text differs. */
export function ProposalNotes({ notes, prefix, assets }: { notes: ProposalNote[]; prefix: string; assets?:DocumentImageAssets }) {
  return <DocumentNotes notes={notes} prefix={prefix} renderText={note => {
    const objects = (note as ProposalNote).objects.slice().sort((a, b) => a.offset - b.offset)
    let offset = 0
    const text = (start: number, end: number) => <ReferenceText text={note.text.slice(start, end)} start={start}
      links={(note.linkSpans ?? []).map(link => ({ ...link, start: Math.max(start, link.start), end: Math.min(end, link.end) })).filter(link => link.end > link.start)} linkify />
    const parts = objects.map((object, index) => {
      if (!Number.isInteger(object.offset) || object.offset < offset || !object.replacement || note.text.slice(object.offset, object.offset + object.replacement.length) !== object.replacement) return null
      const before = text(offset, object.offset)
      offset = object.offset + object.replacement.length
      const linkUrl = (note.linkSpans ?? []).find(link => link.start <= object.offset && link.end >= offset)?.url
      const content = object.image ? <DocumentImage image={object.image} assets={assets}/> : object.kind === 'symbol' && object.status === 'mapped' && object.complete
        ? linkUrl ? <SourceLink url={linkUrl} compact>{object.replacement}</SourceLink> : object.replacement
        : <ProposalMath object={object} linkUrl={linkUrl} />
      return <Fragment key={index}>{before}{content}</Fragment>
    })
    return <>{parts}{text(offset, note.text.length)}</>
  }} />
}

import { Fragment } from 'react'
import { DocumentNotes, ReferenceText } from './References'
import { ProposalMath } from './ProposalMath'
import type { ProposalNote } from './proposalTypes'

/** The shared note list keeps its anchors and links; only object text differs. */
export function ProposalNotes({ notes, prefix }: { notes: ProposalNote[]; prefix: string }) {
  return <DocumentNotes notes={notes} prefix={prefix} renderText={note => {
    const objects = (note as ProposalNote).objects.slice().sort((a, b) => a.offset - b.offset)
    let offset = 0
    const text = (start: number, end: number) => <ReferenceText text={note.text.slice(start, end)} start={start}
      links={(note.linkSpans ?? []).map(link => ({ ...link, start: Math.max(start, link.start), end: Math.min(end, link.end) })).filter(link => link.end > link.start)} linkify />
    const parts = objects.map((object, index) => {
      if (!Number.isInteger(object.offset) || object.offset < offset || !object.replacement || note.text.slice(object.offset, object.offset + object.replacement.length) !== object.replacement) return null
      const before = text(offset, object.offset)
      offset = object.offset + object.replacement.length
      return <Fragment key={index}>{before}{object.kind === 'symbol' && object.status === 'mapped' && object.complete ? object.replacement : <ProposalMath object={object} />}</Fragment>
    })
    return <>{parts}{text(offset, note.text.length)}</>
  }} />
}

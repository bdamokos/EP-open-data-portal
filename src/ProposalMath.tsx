import {UiMessage, useUiI18n} from './UiI18nReact';
import { createElement, type ReactNode } from 'react'
import { SourceLink } from './SourceLink'
import './ProposalMath.css'
import type { MathMLNode, ProposalObject } from './proposalTypes'

const allowed = new Set(['math', 'mrow', 'mi', 'mn', 'mo', 'mtext', 'mfrac', 'msub', 'msup', 'msubsup', 'msqrt', 'mroot', 'munder', 'mover', 'munderover', 'mtable', 'mtr', 'mtd'])
function safeTree(tree: unknown): tree is MathMLNode {
  let count = 0, characters = 0
  function visit(value: unknown, depth: number): boolean {
    if (depth > 64 || ++count > 20000) return false
    if (typeof value === 'string') { characters += value.length; return characters <= 100000 }
    if (!value || typeof value !== 'object') return false
    const node = value as MathMLNode
    const attributes = node.attributes
    const safeAttributes = attributes === undefined || attributes && typeof attributes === 'object' && Object.keys(attributes).length === 1 &&
      (node.tag === 'mover' && Object.keys(attributes)[0] === 'accent' && attributes.accent === 'true' || node.tag === 'munder' && Object.keys(attributes)[0] === 'accentunder' && attributes.accentunder === 'true' || node.tag === 'mi' && Object.keys(attributes)[0] === 'mathvariant' && attributes.mathvariant === 'normal')
    return !!safeAttributes && allowed.has(node.tag) && Object.keys(node).every(key => key === 'tag' || key === 'children' || key === 'attributes') && Array.isArray(node.children) && node.children.every(child => visit(child, depth + 1))
  }
  return visit(tree, 0) && (tree as MathMLNode)?.tag === 'math'
}
function renderNode(node: MathMLNode | string, key: number): ReactNode {
  if (typeof node === 'string') return node
  return createElement(node.tag, { key, ...node.attributes }, node.children.map(renderNode))
}
function sourceLink(value: string | null): string | null {
  try {
    const url = new URL(value ?? '')
    return (((((url.protocol === 'https:') && (!url.username)) && (!url.password)) && (!url.port)) && ['publications.europa.eu', 'eur-lex.europa.eu', 'data.europarl.europa.eu', 'redmapl3.europarl.europa.eu'].includes(url.hostname)) ? url.href : null
  } catch { return null }
}
/** Renders JSON elements and text through React. Upstream markup is never inserted. */
export function ProposalMath({ object, linkUrl }: { object: ProposalObject; linkUrl?: string }) {
  const ui = useUiI18n();
  const linked = (content: ReactNode) => linkUrl ? <SourceLink url={linkUrl} compact>{content}</SourceLink> : content
  if (object.kind === 'math' && object.complete && object.status === 'converted' && safeTree(object.math)) return <span className="proposal-math-scroll"><span className="proposal-math-content">{linked(renderNode(object.math, 0))}</span></span>
  const href = sourceLink(object.sourceUrl)
  return <span className="proposal-object" role="note">{linked(ui.t("proposalmath.equation_unavailable"))}{href && <> <a href={href} target="_blank" rel="noopener noreferrer"><UiMessage id="proposalmath.view_official_document"/></a></>}</span>
}

// A quoted resolution original can print each source note as a superscript
// number plus a detached payload after a rule. It still names the addressed
// provision when its body, every note position and every note text agree.
const compact = value => value.normalize('NFC').replace(/\s/gu, '');

export function resolutionFootnoteMatch(text, start, end, original, formatting) {
  const divider = /\n_{5,}\s*\n/u.exec(original ?? '') || /\n(?=\s*[1-9]\d*\.\s+\S)/u.exec(original ?? '');
  if (!divider || text?.notesStatus !== 'extracted') return false;
  const rows = text.paragraphs.slice(start, end + 1);
  if (!rows.length || /\n_{5,}\s*\n/u.test(rows.join('\n'))) return false;
  const body = original.slice(0, divider.index);
  const lines = original.slice(divider.index + divider[0].length).split(/\n+/u).filter(line => line.trim());
  const marks = (formatting ?? []).filter(mark => mark.kind === 'superscript' && mark.end <= body.length).sort((a, b) => a.start - b.start);
  if (!marks.length || marks.length !== lines.length) return false;
  let clean = '', last = 0;
  const positions = [];
  for (const mark of marks) {
    if (mark.start < last || mark.end <= mark.start || !/^\d+$/u.test(body.slice(mark.start, mark.end))) return false;
    clean += body.slice(last, mark.start); positions.push(compact(clean).length); last = mark.end;
  }
  clean += body.slice(last);
  if (compact(rows.join('\n')) !== compact(clean)) return false;
  const anchors = (text.noteAnchors ?? []).filter(anchor => anchor.paragraph >= start && anchor.paragraph <= end)
    .sort((a, b) => a.paragraph - b.paragraph || a.offset - b.offset);
  if (anchors.length !== marks.length) return false;
  return anchors.every((anchor, i) => {
    const note = text.notes?.find(candidate => candidate.id === anchor.note), label = body.slice(marks[i].start, marks[i].end);
    const line = /^\s*(\d+)\.?\s+([\s\S]+)$/u.exec(lines[i]);
    if (!line || line[1] !== label || typeof note?.text !== 'string' || !note.text.trim()) return false;
    // A custom note mark repeats its label inside the amendment's payload.
    const payload = [line[2], new RegExp(`^${label}\\s+([\\s\\S]+)$`, 'u').exec(line[2])?.[1]].filter(Boolean);
    const prefix = rows.slice(0, anchor.paragraph - start).join('\n') + '\n' + text.paragraphs[anchor.paragraph].slice(0, anchor.offset);
    return payload.some(value => compact(value) === compact(note.text)) && compact(prefix).length === positions[i];
  });
}

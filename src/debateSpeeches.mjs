// Counts come from the same listed speeches as the speaker list, split by kind.
export function speechPanelCounts(speeches) {
  const spoken=speeches.filter(speech=>speech.kind!=='PLENARY_DEBATE_WRITTEN_STATEMENT');
  return {speeches:spoken.length,statements:speeches.length-spoken.length,speakers:new Set(spoken.flatMap(speech=>speech.people.map(person=>person.id))).size};
}
export function speechPanelDate(speeches) {
  const dates=new Set(speeches.map(speech=>speech.date));
  return dates.size===1&&[...dates][0]?[...dates][0]:null;
}

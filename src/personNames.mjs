// Directory spelling is authoritative only for the same exact person ID.
const personId=value=>/^[1-9]\d*$/.test(String(value))?String(value):null;
export function personNameIndex(members=[]) {
  return new Map(members.flatMap(member=>{
    const id=personId(member.id);
    const given=member.firstName?.trim(),family=member.lastName?.trim();
    return id&&given&&family?[[id,`${given} ${family}`]]:[];
  }));
}
export function personDisplayName(index,id,label) {
  return index.get(personId(id))||label||'';
}

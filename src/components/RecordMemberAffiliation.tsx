import {useDirectoryMember} from '../PersonName';
import {MemberAffiliation} from './MemberAffiliation';

// Historical rows may use only a group already resolved at the record date.
// The directory supplies election country, never its current political group.
export function RecordMemberAffiliation({id,datedGroup,language}:{id:unknown;datedGroup?:string|null;language:string}) {
  const member=useDirectoryMember(id);
  if(!datedGroup&&!member?.countryCode)return null;
  return <>{' '}<MemberAffiliation group={datedGroup} country={member?.countryCode} language={language} variant="tag"/></>;
}

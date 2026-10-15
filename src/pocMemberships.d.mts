import type {Membership,Committee} from './pocTypes';
export const committeeOrder:string[];
export const ongoingLabels:Record<string,string>;
export function orderedMemberships(memberships:Membership[],committees:Committee[]):Membership[];

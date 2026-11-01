// Offline sizing scenario, not a measurement of production sitting sizes.
import {gzipSync} from 'node:zlib';
import {MemberVotes} from '../member-votes.mjs';
import {MemberAttendance} from '../member-attendance.mjs';
import {snapshotFixture,SNAPSHOT_SITTING,SNAPSHOT_NOW} from './sitting-snapshots.mjs';

const fixture=snapshotFixture({decisionCount:400}),clock=()=>SNAPSHOT_NOW;
const votes=new MemberVotes({request:fixture.request,clock,readChairs:async()=>null,snapshots:null});
const budget={bytes:0},catalogue=await votes.catalogue({sitting:SNAPSHOT_SITTING},budget),catalogueBytes=budget.bytes;
const node=catalogue.nodes[0],day=await votes.sitting(node,budget);
const attendance=await new MemberAttendance({request:fixture.request,snapshots:null}).loadInputs(SNAPSHOT_SITTING);
const values={votes:{node,catalogue,catalogueBytes,day,bytes:budget.bytes-catalogueBytes},attendance};
const sizes=Object.fromEntries(Object.entries(values).map(([kind,value])=>{const json=JSON.stringify(value);return [kind,{jsonBytes:Buffer.byteLength(json),gzipBytes:gzipSync(json).length}];}));
const perSittingBytes=sizes.votes.gzipBytes+sizes.attendance.gzipBytes;
console.log(JSON.stringify({scenario:'400 synthetic decisions sharing retained fixture voter/agenda inputs; no chair XML; compression may be optimistic',sizes,perSittingBytes,
  termEstimates:[300,350].map(sittings=>({sittings,compressedMiB:Math.round(sittings*perSittingBytes/1024/1024*100)/100})),
  note:'Planning assumptions of 60–70 sitting days/year over five years. Not a future calendar census. SQLite/WAL, staged pages and varying sources require headroom.'},null,2));

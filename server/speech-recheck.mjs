const DAY=86400_000;
export function speechRecheckCadence(end,today) {
  const months=(Number(today.slice(0,4))-Number(end.slice(0,4)))*12+Number(today.slice(5,7))-Number(end.slice(5,7));
  return months<4?null:months<12?{metadata:30*DAY,verification:90*DAY}:months<24?{metadata:90*DAY,verification:180*DAY}:{metadata:180*DAY,verification:365*DAY};
}

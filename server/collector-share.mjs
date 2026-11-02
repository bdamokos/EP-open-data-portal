import {integerFromEnvironment} from './config.mjs';
// While core indexing is busy, backfill, topic and story collectors share one background
// turn in this many. Their requests still use the shared admission budget and
// pacing, so visitors keep priority and request rates do not change.
export const collectorTurnEvery=integerFromEnvironment('TOPICS_COLLECTOR_TURN_EVERY',6,2,32);

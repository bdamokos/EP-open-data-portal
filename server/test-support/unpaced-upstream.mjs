// Import first in tests that replay recorded upstream responses, before anything loads odp.mjs:
// every upstream queue the process creates then has no start interval. Pacing tests build their own queues.
import {disableUpstreamPacingForTests} from '../upstream-services.mjs';

disableUpstreamPacingForTests();

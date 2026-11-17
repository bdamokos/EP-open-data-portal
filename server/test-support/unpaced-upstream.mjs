// Import first in tests that replay recorded upstream responses, before anything loads odp.mjs:
// the process then shares queues without start intervals. Pacing tests build their own queues.
import {adoptUpstreamServices,createUpstreamServices} from '../upstream-services.mjs';

adoptUpstreamServices(createUpstreamServices({paced:false}));

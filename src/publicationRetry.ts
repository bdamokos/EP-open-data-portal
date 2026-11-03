import {retryableGap,gapRetryAt} from './automaticRetry.mjs';

// selectedText is the publication extractor's progress/deadline observation.
export const publicationRetry={
  retryWhile:(data:{selectedText?:unknown})=>retryableGap(data.selectedText),
  retryAtFor:(data:{selectedText?:unknown})=>gapRetryAt(data.selectedText),
};

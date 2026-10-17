# Parliament explorer

Use only publicly accessible parliamentary data and transparently documented processing of public websites/documents. Do not add authenticated institutional services, private data exports, copied production caches or secrets. Document each external source and its capabilities in docs/PUBLIC_DATA.md.

Preserve exact identifiers, source URLs, retrieval dates, languages and explicit gaps. Do not join records solely by title, tally or name similarity. Keep unavailable observations distinct from zeroes.

Use branches and pull requests for changes. Do not publish the repository, change its visibility or add a source licence without maintainer authorization. Keep cache/index directories and browser following data outside Git.

Keep QA screenshots, browser captures, evidence bundles and agent work logs outside Git. Documentation is guidance for future contributors, not an audit trail: describe current sources, behaviour and rules, and update existing text in place. Do not add dated check logs, sampled API responses, per-change entries or agent-generated research and completion reports; Git history and PRs record what changed. Summarize validation briefly in PR descriptions or comments, and keep required project, public-source and data-access documentation concise and useful.

Use one source writer and one index writer. Keep site-specific routing, service configuration, host addresses, credentials and deployment records outside this repository. A push or health check is not user-visible acceptance. Verify the exact live revision and user path; preserve the accepted runtime and data while testing a candidate.

Run npm test, npm run check and npm run build for structural changes. Verify changed UI flows in the browser at mobile and desktop widths. Avoid cold corpus downloads during tests and preserve incomplete-coverage labels.

## Pull requests and deployment

- Keep the user's personal name out of repository files, commit messages and PR text.
- For this repository, agents have standing authorization to merge and deploy reviewed PRs once required checks are green and actionable review findings are resolved, unless the user explicitly withholds merging or deployment or asks the agent to stop at an earlier stage. Follow project deployment ownership and coordination rules, verify the deployed revision and user-visible outcome, and report the merge commit and deployment result.
- Complete review before treating a PR as ready. Inspect feedback, implement valid fixes, rerun relevant checks, and resolve actionable review threads. A timed-out or quota-skipped bot run does not count as completed review.
- If review bots time out or exhaust quota and cannot complete within a reasonable time, use independent T3 reviewers; for example, switch when quota refill is more than a few hours away. Prefer reviewers from a different lab when subscription quotas and availability allow, such as Anthropic/Claude reviewers for GPT-authored PRs and GPT reviewers for Anthropic/Claude-authored PRs; reviewers from the same lab are acceptable. Discover current models and delegate reviews through T3. Reviewers must not have authored the changes; require completed reviews of the exact current PR head, address their findings, and obtain further review of substantive fixes. Record the fallback reason, reviewed commit and reviewer model IDs in the PR. These reviews replace the unavailable bot review; required CI and branch protection still apply.

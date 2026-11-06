// The MEP overview reads its vote summary beside the page's own requests; page
// fixtures that do not exercise it answer that one read as unavailable.
export const memberOverviewVoteRead=url=>url.pathname.startsWith('/api/member-votes/')&&url.searchParams.get('view')==='summary';
export const memberOverviewVoteUnavailable=()=>Response.json({error:{code:'unavailable'}},{status:404});
export const memberOverviewActivityRead=url=>url.pathname.startsWith('/api/latest-activities/')&&url.searchParams.get('limit')==='1'&&!url.searchParams.has('category')&&!url.searchParams.has('source-id');

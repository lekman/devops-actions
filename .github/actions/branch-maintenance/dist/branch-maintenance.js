/**
 * Copyright (c) Tobias Lekman. All rights reserved.
 *
 * Branch Maintenance — keeps PR branches up to date with their base branch.
 *
 * Scans open PRs across an org (or a single repo), detects stale or
 * conflicted branches, and takes action: auto-updates stale branches
 * (triggering fresh CI) and comments on conflicted ones.
 *
 * Uses the GitHub compare API to detect behind_by count — this works
 * regardless of branch protection settings, unlike mergeable_state which
 * only reports "behind" when "require up to date" is enabled.
 */
// ─── Pure functions ──────────────────────────────────────────────────────
export function classifyBranch(status) {
    if (status.conflicting)
        return "conflicted";
    if (status.behindBy > 0)
        return "updated";
    return "clean";
}
export function formatConflictComment(base) {
    return `⚠️ **Merge conflict detected** — this PR has conflicts with \`${base}\`. Please rebase or merge \`${base}\` into your branch.`;
}
export function summarise(results) {
    const summary = {
        updated: 0,
        conflicted: 0,
        clean: 0,
        "auto-merge": 0,
        errors: 0,
        results,
    };
    for (const r of results) {
        summary[r.action === "error" ? "errors" : r.action]++;
    }
    return summary;
}
// ─── GitHub API helpers ──────────────────────────────────────────────────
const API_BASE = "https://api.github.com";
const API_HEADERS = (token) => ({
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
});
async function ghFetch(path, token, options) {
    return fetch(`${API_BASE}${path}`, {
        ...options,
        headers: { ...API_HEADERS(token), ...(options?.headers ?? {}) },
    });
}
export async function fetchOrgRepos(org, token) {
    const repos = [];
    let page = 1;
    while (true) {
        const res = await ghFetch(`/orgs/${org}/repos?per_page=100&page=${page}`, token);
        if (!res.ok)
            break;
        const data = (await res.json());
        if (data.length === 0)
            break;
        for (const r of data)
            repos.push(r.full_name);
        page++;
    }
    return repos;
}
export async function fetchOpenPRs(repo, token) {
    const res = await ghFetch(`/repos/${repo}/pulls?state=open&per_page=100`, token);
    if (!res.ok)
        return [];
    const data = (await res.json());
    return data.map((pr) => ({
        number: pr.number,
        nodeId: pr.node_id,
        headRefName: pr.head.ref,
        baseRefName: pr.base.ref,
        isDraft: pr.draft,
        autoMergeEnabled: pr.auto_merge !== null,
        mergeable: pr.mergeable_state === "dirty"
            ? "CONFLICTING"
            : pr.mergeable_state === "unknown"
                ? "UNKNOWN"
                : "MERGEABLE",
    }));
}
export async function getBranchStatus(repo, pr, token) {
    const res = await ghFetch(`/repos/${repo}/compare/${pr.baseRefName}...${pr.headRefName}`, token);
    let behindBy = 0;
    if (res.ok) {
        const data = (await res.json());
        behindBy = data.behind_by;
    }
    return {
        repo,
        pr: pr.number,
        head: pr.headRefName,
        base: pr.baseRefName,
        behindBy,
        conflicting: pr.mergeable === "CONFLICTING",
    };
}
export async function updateBranch(repo, prNumber, token) {
    const res = await ghFetch(`/repos/${repo}/pulls/${prNumber}/update-branch`, token, { method: "PUT", body: JSON.stringify({ update_method: "merge" }) });
    return res.ok;
}
export async function commentOnPR(repo, prNumber, body, token) {
    // Try to find and update an existing bot comment to avoid spam
    const commentsRes = await ghFetch(`/repos/${repo}/issues/${prNumber}/comments?per_page=100`, token);
    if (commentsRes.ok) {
        const comments = (await commentsRes.json());
        const existing = comments.find((c) => c.user.type === "Bot" && c.body.includes("Merge conflict detected"));
        if (existing) {
            await ghFetch(`/repos/${repo}/issues/comments/${existing.id}`, token, {
                method: "PATCH",
                body: JSON.stringify({ body }),
            });
            return;
        }
    }
    await ghFetch(`/repos/${repo}/issues/${prNumber}/comments`, token, {
        method: "POST",
        body: JSON.stringify({ body }),
    });
}
export async function enableAutoMerge(nodeId, token) {
    // Auto-merge requires the GraphQL API — REST doesn't support it
    const res = await fetch(`${API_BASE}/graphql`, {
        method: "POST",
        headers: API_HEADERS(token),
        body: JSON.stringify({
            query: `mutation($prId: ID!) {
        enablePullRequestAutoMerge(input: { pullRequestId: $prId, mergeMethod: SQUASH }) {
          pullRequest { autoMergeRequest { enabledAt } }
        }
      }`,
            variables: { prId: nodeId },
        }),
    });
    if (!res.ok)
        return false;
    const data = (await res.json());
    return !data.errors;
}
// ─── Orchestration ───────────────────────────────────────────────────────
export async function processPR(repo, pr, token) {
    try {
        const status = await getBranchStatus(repo, pr, token);
        const action = classifyBranch(status);
        switch (action) {
            case "updated": {
                const ok = await updateBranch(repo, pr.number, token);
                return {
                    repo,
                    pr: pr.number,
                    action: ok ? "updated" : "error",
                    detail: ok
                        ? `${status.behindBy} commit(s) behind — branch updated`
                        : "Update failed",
                };
            }
            case "conflicted": {
                await commentOnPR(repo, pr.number, formatConflictComment(pr.baseRefName), token);
                return {
                    repo,
                    pr: pr.number,
                    action: "conflicted",
                    detail: "Merge conflict — commented on PR",
                };
            }
            default: {
                // Enable auto-merge on clean PRs that don't have it yet
                if (!pr.autoMergeEnabled) {
                    const ok = await enableAutoMerge(pr.nodeId, token);
                    if (ok) {
                        return {
                            repo,
                            pr: pr.number,
                            action: "auto-merge",
                            detail: "Up to date — auto-merge enabled",
                        };
                    }
                }
                return {
                    repo,
                    pr: pr.number,
                    action: "clean",
                    detail: "Up to date",
                };
            }
        }
    }
    catch (err) {
        return {
            repo,
            pr: pr.number,
            action: "error",
            detail: String(err),
        };
    }
}
export async function maintainRepo(repo, token) {
    const prs = await fetchOpenPRs(repo, token);
    const results = [];
    for (const pr of prs) {
        if (pr.isDraft)
            continue;
        results.push(await processPR(repo, pr, token));
        // Rate limit: small delay between API calls
        await new Promise((r) => setTimeout(r, 100));
    }
    return results;
}
export async function maintainOrg(org, token) {
    const repos = await fetchOrgRepos(org, token);
    const allResults = [];
    for (const repo of repos) {
        const results = await maintainRepo(repo, token);
        allResults.push(...results);
    }
    return summarise(allResults);
}
// ─── CLI entrypoint ──────────────────────────────────────────────────────
/* eslint-disable no-console -- CLI entrypoint, console output is intentional */
async function main() {
    const token = process.env.GITHUB_TOKEN;
    const org = process.env.GITHUB_ORG ?? "lekman";
    const repo = process.env.GITHUB_REPOSITORY; // single-repo mode
    if (!token) {
        console.error("Missing GITHUB_TOKEN");
        process.exit(1);
    }
    let summary;
    if (repo && !process.env.SWEEP_ORG) {
        // Single-repo mode (called from CI branch-check)
        const results = await maintainRepo(repo, token);
        summary = summarise(results);
    }
    else {
        // Org sweep mode (called from cron)
        summary = await maintainOrg(org, token);
    }
    for (const r of summary.results) {
        if (r.action !== "clean") {
            console.log(`[${r.repo}#${r.pr}] ${r.action}: ${r.detail}`);
        }
    }
    console.log(`Branch maintenance complete: ${summary.updated} updated, ${summary["auto-merge"]} auto-merge enabled, ${summary.conflicted} conflicted, ${summary.clean} clean, ${summary.errors} errors`);
    // Set GitHub Actions output if available
    const outputFile = process.env.GITHUB_OUTPUT;
    if (outputFile) {
        const { appendFileSync } = await import("node:fs");
        appendFileSync(outputFile, `updated=${summary.updated}\n`);
        appendFileSync(outputFile, `conflicted=${summary.conflicted}\n`);
        appendFileSync(outputFile, `clean=${summary.clean}\n`);
        appendFileSync(outputFile, `errors=${summary.errors}\n`);
    }
}
if (import.meta.main) {
    main().catch((err) => {
        console.error("Branch maintenance error:", err);
        process.exit(1);
    });
}
/* eslint-enable no-console */
//# sourceMappingURL=branch-maintenance.js.map
# Branch Maintenance

Covers the **branch-check** CI job and the scheduled **branch-maintenance** workflow.

The branch-check job runs on PRs to detect merge conflicts and stale branches. The scheduled workflow sweeps the entire org every 15 minutes.

## PR Branch Issues

| Symptom                                    | Cause                                                  | Fix                                                                                    |
| ------------------------------------------ | ------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| PR comment says branch has merge conflicts | Your branch conflicts with the base branch             | Merge or rebase the base branch into your branch locally and resolve conflicts         |
| Branch was auto-updated, CI re-triggered   | Branch was behind the base branch and was auto-updated | Expected behaviour. The auto-update triggers a new CI run on the updated branch        |
| PR comment appears repeatedly              | Branch keeps falling behind as other PRs merge         | This is normal for active repos. The maintenance job updates branches every 15 minutes |
| No auto-update on draft PR                 | Draft PRs are skipped by branch maintenance            | Expected behaviour. Convert to a ready PR to enable auto-updates                       |
| No auto-update on auto-merge PR            | Auto-merge PRs are skipped to avoid interference       | Expected behaviour. GitHub handles updates for auto-merge PRs natively                 |

## Scheduled Org Sweep

The `branch-maintenance.yml` workflow runs every 15 minutes via cron and sweeps all repos in the org.

| Symptom                               | Cause                                                                       | Fix                                                                                                                   |
| ------------------------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Sweep job fails with rate limit error | Too many repos or PRs to process in one run                                 | The GitHub API rate limit is per-token. If this occurs frequently, reduce sweep frequency or use a higher-limit token |
| Sweep skips a repo                    | Repo may not have the automation app installed                              | Ensure the GitHub App (Lekman automation bot) is installed on the target repo                                         |
| Branch updated but CI did not trigger | GitHub does not trigger workflows for pushes made by GitHub Apps by default | Check the App token has `workflows: write` permission                                                                 |

## How Branch Classification Works

The TypeScript module (`packages/devops-actions/src/branch-maintenance.ts`) classifies branches using the GitHub Compare API:

| Status                     | Action                                     |
| -------------------------- | ------------------------------------------ |
| Behind base, no conflicts  | Auto-update (merge base into head)         |
| Behind base, has conflicts | Post conflict comment on PR                |
| Up to date                 | No action (classified as "clean")          |
| Auto-merge enabled         | Skipped (classified as "auto-merge")       |
| API error                  | Logged and skipped (classified as "error") |

The compare API is used instead of the `mergeable_state` GraphQL field because `mergeable_state` requires branch protection's "require up to date" setting to be enabled.
